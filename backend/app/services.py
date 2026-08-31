from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from .config import get_settings
from .models import AppSetting, AuditEvent
from .schemas import AppRuntimeSettings, LLMSettings
from .security import decrypt, encrypt


def audit(
    db: Session, event_type: str, entity_type: str, entity_id: str | None, details: dict[str, Any]
) -> None:
    db.add(
        AuditEvent(
            event_type=event_type,
            entity_type=entity_type,
            entity_id=entity_id,
            details_json=json.dumps(details, ensure_ascii=False),
        )
    )
    db.commit()


def _stored_llm_settings(db: Session) -> tuple[LLMSettings | None, set[str]]:
    item = db.get(AppSetting, "llm")
    if not item:
        return None, set()
    raw = json.loads(decrypt(item.value_encrypted))
    if isinstance(raw, dict) and "values" in raw:
        valid_fields = set(LLMSettings.model_fields)
        environment_fields = set(raw.get("environment_fields", [])) & valid_fields
        return LLMSettings.model_validate(raw["values"]), environment_fields
    return LLMSettings.model_validate(raw), set()


def get_llm_settings(db: Session) -> LLMSettings:
    stored, environment_fields = _stored_llm_settings(db)
    environment = environment_llm_settings()
    if stored is None:
        return environment
    active = stored.model_copy()
    for field in environment_fields:
        setattr(active, field, getattr(environment, field))
    return active


def environment_llm_settings() -> LLMSettings:
    settings = get_settings()
    return LLMSettings(
        provider=settings.llm_provider,
        base_url=settings.llm_base_url,
        model=settings.llm_model,
        api_key=settings.llm_api_key,
        timeout_seconds=settings.llm_timeout_seconds,
        batch_size=settings.llm_batch_size,
        vision_enabled=settings.llm_vision_enabled,
    )


def save_llm_settings(
    db: Session, settings: LLMSettings, environment_fields: set[str] | None = None
) -> LLMSettings:
    item = db.get(AppSetting, "llm")
    if not item:
        item = AppSetting(key="llm", value_encrypted="")
        db.add(item)
    item.value_encrypted = encrypt(
        json.dumps(
            {
                "values": settings.model_dump(),
                "environment_fields": sorted(environment_fields or set()),
            }
        )
    )
    db.commit()
    audit(
        db,
        "settings.llm.updated",
        "settings",
        "llm",
        {"provider": settings.provider, "model": settings.model},
    )
    return settings


def masked_llm_settings(db: Session) -> dict[str, Any]:
    active = get_llm_settings(db)
    environment = environment_llm_settings()
    stored, environment_fields = _stored_llm_settings(db)
    if stored is None:
        environment_fields = set(LLMSettings.model_fields)
    response = active.model_dump()
    response["api_key"] = "********" if active.api_key else ""
    response["sources"] = {
        field: "environment" if field in environment_fields else "saved"
        for field in type(active).model_fields
    }
    response["environment_fields"] = sorted(environment_fields)
    response["environment"] = {
        "provider": environment.provider,
        "base_url": environment.base_url,
        "model": environment.model,
        "api_key_configured": bool(environment.api_key),
        "timeout_seconds": environment.timeout_seconds,
        "batch_size": environment.batch_size,
        "vision_enabled": environment.vision_enabled,
    }
    return response


def reset_llm_settings_fields(db: Session, fields: list[str]) -> LLMSettings:
    stored, environment_fields = _stored_llm_settings(db)
    if stored is None:
        stored = LLMSettings()
        environment_fields = set(LLMSettings.model_fields)
    defaults = LLMSettings()
    for field in fields:
        environment_fields.add(field)
        setattr(stored, field, getattr(defaults, field))
    if environment_fields == set(LLMSettings.model_fields):
        item = db.get(AppSetting, "llm")
        if item:
            db.delete(item)
            db.commit()
    else:
        save_llm_settings(db, stored, environment_fields)
    audit(db, "settings.llm.reset_to_environment", "settings", "llm", {"fields": fields})
    return get_llm_settings(db)


def environment_app_settings() -> AppRuntimeSettings:
    settings = get_settings()
    return AppRuntimeSettings(**{
        key: getattr(settings, key, field.default)
        for key, field in AppRuntimeSettings.model_fields.items()
    })


def get_app_runtime_settings(db: Session) -> AppRuntimeSettings:
    item = db.get(AppSetting, "app")
    stored = json.loads(decrypt(item.value_encrypted)) if item else {}
    return AppRuntimeSettings.model_validate({**environment_app_settings().model_dump(), **stored})


def save_app_runtime_settings(db: Session, settings: AppRuntimeSettings) -> AppRuntimeSettings:
    item = db.get(AppSetting, "app")
    if not item:
        item = AppSetting(key="app", value_encrypted="")
        db.add(item)
    stored = json.loads(decrypt(item.value_encrypted)) if item.value_encrypted else {}
    stored.update(settings.model_dump(exclude_unset=True))
    item.value_encrypted = encrypt(json.dumps(stored))
    db.commit()
    audit(
        db,
        "settings.app.updated",
        "settings",
        "app",
        settings.model_dump(exclude_unset=True),
    )
    return get_app_runtime_settings(db)


def reset_app_settings(db: Session, fields: list[str]) -> AppRuntimeSettings:
    item = db.get(AppSetting, "app")
    if item:
        stored = json.loads(decrypt(item.value_encrypted))
        for field in fields:
            stored.pop(field, None)
        item.value_encrypted = encrypt(json.dumps(stored))
        db.commit()
    audit(db, "settings.app.reset_to_environment", "settings", "app", {"fields": fields})
    return get_app_runtime_settings(db)
