"""Encrypted local OAuth overrides; public responses never include credentials."""

import asyncio
import json
from dataclasses import dataclass, field
from typing import Literal
from urllib.parse import urlsplit, urlunsplit

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .models import AppSetting, OAuthState, XConnection
from .security import decrypt, encrypt
from .services import audit

XField = Literal["client_id", "client_secret", "callback_url"]
FIELDS = ("client_id", "client_secret", "callback_url")
_oauth_lock = asyncio.Lock()


async def x_configuration_lock():
    # The local app runs one process. Serialize settings and OAuth handshakes so
    # credentials cannot change while an authorization code is being exchanged.
    async with _oauth_lock:
        yield


class XSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client_id: SecretStr = SecretStr("")
    client_secret: SecretStr = SecretStr("")
    callback_url: str | None = None

    @field_validator("callback_url")
    @classmethod
    def validate_callback(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        try:
            url = urlsplit(value)
            valid = (
                url.scheme in ("http", "https") and url.hostname and url.port != 0
                and not url.username and not url.password and not url.query and not url.fragment
                and url.path.endswith("/api/auth/x/callback") and len(value) <= 2048
            )
        except ValueError:
            valid = False
        if not valid:
            raise ValueError("Use an HTTP(S) URL ending in /api/auth/x/callback without credentials, query or fragment")
        return value


class XSettingsReset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fields: list[XField] = Field(min_length=1, max_length=3)


@dataclass(frozen=True)
class XCredentials:
    x_client_id: str = field(repr=False)
    x_client_secret: str = field(repr=False)
    x_callback_url: str


def _overrides(db: Session) -> dict[str, str]:
    stored = db.get(AppSetting, "x_oauth")
    return json.loads(decrypt(stored.value_encrypted)) if stored else {}


def get_x_settings(db: Session) -> XCredentials:
    settings = get_settings()
    values = _overrides(db)
    return XCredentials(**{f"x_{key}": values.get(key, getattr(settings, f"x_{key}")) for key in FIELDS})


def masked_x_settings(db: Session) -> dict:
    values = get_x_settings(db)
    overrides = _overrides(db)
    # Environment values also pass through the secret-safe display boundary.
    try:
        url = urlsplit(values.x_callback_url)
        callback = urlunsplit((url.scheme, url.netloc.rsplit("@", 1)[-1], url.path, "", ""))
    except ValueError:
        callback = ""
    return {
        "client_id_configured": bool(values.x_client_id),
        "client_secret_configured": bool(values.x_client_secret),
        "callback_url": callback,
        "connected": db.scalar(select(XConnection.id).limit(1)) is not None,
        "sources": {key: "saved" if key in overrides else "environment" for key in FIELDS},
    }


def _ensure_disconnected(db: Session) -> None:
    if db.scalar(select(XConnection.id).limit(1)) is not None:
        raise HTTPException(409, "Disconnect X in Settings before changing OAuth settings")


def _store(db: Session, values: dict[str, str], changed: list[str], event: str) -> dict:
    if changed:
        row = db.get(AppSetting, "x_oauth")
        if row is None:
            row = AppSetting(key="x_oauth", value_encrypted="")
            db.add(row)
        row.value_encrypted = encrypt(json.dumps(values))
        # An abandoned login must not finish with credentials other than those
        # that generated its authorization URL. The route lock covers callbacks.
        for state in db.scalars(select(OAuthState).where(OAuthState.consumed.is_(False))):
            state.consumed = True
        db.commit()
        audit(db, event, "settings", "x_oauth", {"fields": changed})
    return masked_x_settings(db)


def save_x_settings(db: Session, payload: XSettingsUpdate) -> dict:
    _ensure_disconnected(db)
    values = _overrides(db)
    changes: dict[str, str] = {}
    for key in ("client_id", "client_secret"):
        value = getattr(payload, key).get_secret_value().strip()
        if value:
            if len(value) > 4096:
                raise HTTPException(422, "OAuth credentials must be at most 4096 characters")
            changes[key] = value
    if payload.callback_url is not None:
        changes["callback_url"] = payload.callback_url
    changed = [key for key, value in changes.items() if values.get(key) != value]
    return _store(db, {**values, **changes}, changed, "settings.x.updated")


def reset_x_settings(db: Session, fields: list[XField]) -> dict:
    _ensure_disconnected(db)
    values = _overrides(db)
    changed = [key for key in dict.fromkeys(fields) if key in values]
    return _store(db, {key: value for key, value in values.items() if key not in fields}, changed, "settings.x.reset_to_environment")
