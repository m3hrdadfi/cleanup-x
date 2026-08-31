"""Explicit, secret-safe configuration view. Never serialize settings wholesale."""

import json
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from .config import get_settings
from .embeddings import public_settings
from .models import AppSetting
from .security import decrypt
from .services import environment_app_settings, get_app_runtime_settings, masked_llm_settings
from .x_settings import get_x_settings, masked_x_settings


def safe_url(value: str) -> str:
    try:
        url = urlsplit(value)
        return urlunsplit((url.scheme, url.netloc.rsplit("@", 1)[-1], url.path, "", ""))
    except ValueError:
        return ""


def configuration_snapshot(db: Session) -> dict[str, Any]:
    settings = get_settings()
    stored = db.get(AppSetting, "app")
    overrides = json.loads(decrypt(stored.value_encrypted)) if stored else {}
    runtime = get_app_runtime_settings(db).model_dump()
    fields: list[dict[str, Any]] = []

    def add(name: str, value: Any, group: str, secret: bool = False) -> None:
        fields.append({"name": name, "group": group, "value": None if secret else value,
                       "secret": secret, "configured": bool(value)})

    add("APP_ENV", settings.env, "deployment")
    add("APP_DEMO_MODE", settings.demo_mode, "deployment")
    # Database URLs can contain credentials and query-string secrets; show only the driver.
    add("APP_DATABASE_URL", make_url(settings.database_url).get_backend_name(), "deployment")
    add("APP_ENCRYPTION_KEY", settings.encryption_key, "deployment", secret=True)
    for field in ("frontend_url", "api_url"):
        add(f"APP_{field.upper()}", safe_url(getattr(settings, field)), "deployment")
    credentials = get_x_settings(db)
    add("APP_X_CLIENT_ID", credentials.x_client_id, "x", secret=True)
    add("APP_X_CLIENT_SECRET", credentials.x_client_secret, "x", secret=True)
    add("APP_X_CALLBACK_URL", safe_url(credentials.x_callback_url), "x")
    llm = masked_llm_settings(db)
    embedding = public_settings(db)
    for field in ("provider", "base_url", "model", "api_key", "timeout_seconds", "batch_size", "query_prefix", "document_prefix"):
        value = embedding["api_key_configured"] if field == "api_key" else embedding[field]
        add(f"APP_EMBEDDING_{field.upper()}", value, "embedding", secret=field == "api_key")
    for field in ("provider", "base_url", "model", "api_key", "timeout_seconds", "batch_size", "vision_enabled"):
        value = safe_url(llm[field]) if field == "base_url" else llm[field]
        add(f"APP_LLM_{field.upper()}", value, "llm", secret=field == "api_key")
    return {
        "fields": fields,
        "x": {**masked_x_settings(db), "callback_url": safe_url(credentials.x_callback_url)},
        "runtime": runtime,
        "environment": environment_app_settings().model_dump(),
        "sources": {key: "saved" if key in overrides else "environment" for key in runtime},
    }
