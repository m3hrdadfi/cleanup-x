import io
import json
import zipfile
from pathlib import Path

import pytest
from app import configuration, embeddings, main, security, services, x_settings
from app.archive import ArchiveError, _safe_members
from app.config import Settings
from app.models import AppSetting, Classification, Post, Scan
from app.schemas import AppRuntimeSettings, DeletionCreate
from cryptography.fernet import Fernet
from fastapi import HTTPException
from pydantic import ValidationError


@pytest.fixture
def config(monkeypatch):
    settings = Settings(
        _env_file=None, encryption_key=Fernet.generate_key().decode(),
        database_url="postgresql://db-user:private-db-password@db.test/db?token=private-query",
        api_url="http://user:private-url-password@api.test/path?token=private-query#private-fragment",
        x_client_id="private-client-id", x_client_secret="private-client-secret",
        llm_api_key="private-model-key", api_budget_usd=31, max_archive_files=1234,
    )
    for module in (configuration, embeddings, services, security, x_settings):
        monkeypatch.setattr(module, "get_settings", lambda: settings)
    monkeypatch.setattr(main, "settings", settings)
    return settings


def test_configuration_covers_example_variables_without_exposing_secrets(db, config):
    snapshot = configuration.configuration_snapshot(db)
    encoded = json.dumps(snapshot)
    for secret in (config.encryption_key, "private-db-password", "db-user", "private-query", "private-fragment", "private-url-password", config.x_client_id, config.x_client_secret, config.llm_api_key):
        assert secret not in encoded
    known = {field["name"] for field in snapshot["fields"]} | {f"APP_{field.upper()}" for field in snapshot["runtime"]}
    example = Path(__file__).resolve().parents[2] / ".env.example"
    variables = {line.split("=", 1)[0] for line in example.read_text().splitlines() if line.startswith("APP_")}
    assert variables <= known
    assert snapshot["runtime"]["max_archive_files"] == 1234


def test_partial_edits_preserve_other_values_and_reset_only_requested_fields(db, config):
    services.save_app_runtime_settings(db, AppRuntimeSettings(max_archive_files=500, delete_unit_cost_usd=.03))
    runtime = services.get_app_runtime_settings(db)
    assert runtime.api_budget_usd == 31
    assert runtime.max_archive_files == 500
    services.save_app_runtime_settings(db, AppRuntimeSettings(api_budget_usd=19))
    assert services.get_app_runtime_settings(db).delete_unit_cost_usd == .03
    services.reset_app_settings(db, ["max_archive_files"])
    runtime = services.get_app_runtime_settings(db)
    assert runtime.max_archive_files == 1234
    assert runtime.api_budget_usd == 19
    assert runtime.delete_unit_cost_usd == .03
    snapshot = configuration.configuration_snapshot(db)
    assert snapshot["sources"]["max_archive_files"] == "environment"
    assert snapshot["sources"]["delete_unit_cost_usd"] == "saved"


def test_legacy_saved_settings_inherit_new_fields_from_environment(db, config):
    db.add(AppSetting(key="app", value_encrypted=security.encrypt('{"api_budget_usd":12,"audit_retention_days":9}')))
    db.commit()
    runtime = services.get_app_runtime_settings(db)
    assert runtime.max_archive_files == 1234
    assert runtime.api_budget_usd == 12
    assert runtime.audit_retention_days == 9


def test_saved_archive_limits_are_enforced(db, config):
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as archive:
        for index in range(11):
            archive.writestr(f"file-{index}.txt", "example")
    services.save_app_runtime_settings(db, AppRuntimeSettings(max_archive_files=10))
    with zipfile.ZipFile(data) as archive, pytest.raises(ArchiveError, match="too many files"):
        _safe_members(archive, services.get_app_runtime_settings(db))
    services.reset_app_settings(db, ["max_archive_files"])
    with zipfile.ZipFile(data) as archive:
        assert len(_safe_members(archive, services.get_app_runtime_settings(db))) == 11


def test_runtime_limits_reject_invalid_values():
    for values in ({"max_archive_files": 1}, {"max_archive_mb": 10241}, {"delete_unit_cost_usd": -1}, {"post_lookup_unit_cost_usd": float("inf")}):
        with pytest.raises(ValidationError):
            AppRuntimeSettings(**values)


@pytest.mark.asyncio
async def test_saved_prices_enforce_deletion_budget_without_scheduling(db, config, monkeypatch):
    monkeypatch.setattr(main, "schedule_deletion", lambda _: pytest.fail("Budget must block deletion"))
    db.add_all([Post(id="1", text="Sample"), Scan(id="scan", prompt="Sample", policy_json="{}", status="completed")])
    db.flush()
    db.add(Classification(scan_id="scan", post_id="1", matches=True, selected=True, confidence=.99, cache_key="a" * 64))
    db.commit()
    services.save_app_runtime_settings(db, AppRuntimeSettings(api_budget_usd=.01, delete_unit_cost_usd=.5))
    with pytest.raises(HTTPException, match="configured API budget"):
        await main.create_deletion(DeletionCreate(scan_id="scan", confirmation_count=1), db, "new-price-check")
