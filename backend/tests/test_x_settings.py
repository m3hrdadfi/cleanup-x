import base64
import json
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
import respx
from app import main, security, x_settings
from app.config import Settings
from app.models import AppSetting, AuditEvent, OAuthState, XConnection
from app.x_client import get_connection_token
from app.x_settings import (
    XSettingsReset,
    XSettingsUpdate,
    get_x_settings,
    reset_x_settings,
    save_x_settings,
)
from cryptography.fernet import Fernet
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select


@pytest.fixture
def env(monkeypatch):
    settings = Settings(_env_file=None, env="development", encryption_key=Fernet.generate_key().decode(),
                        x_client_id="env-id", x_client_secret="env-secret",
                        x_callback_url="http://127.0.0.1:8787/api/auth/x/callback")
    for module in (security, x_settings):
        monkeypatch.setattr(module, "get_settings", lambda: settings)
    return settings


@pytest.fixture
def client(db, env):
    main.app.dependency_overrides[main.get_db] = lambda: db
    # No lifespan: never resume the user's real jobs or open the live database.
    client = TestClient(main.app)
    client.get("/api/health")
    client.headers["X-CSRF-Token"] = client.cookies["cleanup_csrf"]
    yield client
    client.close()
    main.app.dependency_overrides.clear()


def test_credentials_encrypted_masked_and_blank_preserves_defaults(db, env):
    result = save_x_settings(db, XSettingsUpdate(client_id="saved-id", client_secret="saved-secret"))
    assert result["client_id_configured"] and result["client_secret_configured"]
    row = db.get(AppSetting, "x_oauth")
    assert "saved-secret" not in row.value_encrypted
    assert "saved-id" not in json.dumps(result)
    assert "saved-secret" not in repr(XSettingsUpdate(client_secret="saved-secret"))
    save_x_settings(db, XSettingsUpdate(client_id="", client_secret="  ", callback_url="https://app.test/api/auth/x/callback"))
    effective = get_x_settings(db)
    assert effective.x_client_id == "saved-id"
    assert effective.x_client_secret == "saved-secret"
    assert effective.x_callback_url == "https://app.test/api/auth/x/callback"
    audit = json.dumps([entry.details_json for entry in db.scalars(select(AuditEvent))])
    assert "saved-secret" not in audit and "saved-id" not in audit
    reset_x_settings(db, ["client_secret"])
    assert get_x_settings(db).x_client_secret == "env-secret"
    assert get_x_settings(db).x_client_id == "saved-id"
    reset_x_settings(db, ["client_id", "callback_url"])
    save_x_settings(db, XSettingsUpdate(client_id="", client_secret=""))
    assert get_x_settings(db).x_client_id == "env-id"
    assert get_x_settings(db).x_callback_url == env.x_callback_url


def test_cannot_save_or_reset_while_connected(db, env):
    db.add(XConnection(x_user_id="1", username="owner", name="Owner", token_encrypted=security.encrypt("{}")))
    db.commit()
    for operation in (lambda: save_x_settings(db, XSettingsUpdate(client_id="replacement")),
                      lambda: reset_x_settings(db, ["client_id"])):
        with pytest.raises(HTTPException) as error:
            operation()
        assert error.value.status_code == 409
    assert db.get(AppSetting, "x_oauth") is None
    assert db.scalar(select(XConnection)) is not None


def test_api_csrf_validation_and_secret_safe_responses(client, db):
    assert client.get("/api/settings/x").json()["client_id_configured"]
    assert client.put("/api/settings/x", json={"client_secret": "new-secret"}, headers={"X-CSRF-Token": "wrong"}).status_code == 403
    assert client.post("/api/settings/x/reset", json={"fields": ["client_secret"]}, headers={"X-CSRF-Token": "wrong"}).status_code == 403
    for payload in ({"callback_url": "http://user:private-secret@app.test/api/auth/x/callback"},
                    {"callback_url": "https://app.test/api/auth/x/callback?token=private-secret"},
                    {"client_sekret": "private-secret"}, {"client_secret": "x" * 4097}):
        response = client.put("/api/settings/x", json=payload)
        assert response.status_code == 422
        assert "private-secret" not in response.text and "x" * 4097 not in response.text
    assert db.get(AppSetting, "x_oauth") is None
    response = client.put("/api/settings/x", json={"client_secret": "new-secret"})
    assert response.status_code == 200 and "new-secret" not in response.text
    assert response.json()["sources"]["client_secret"] == "saved"
    assert client.post("/api/settings/x/reset", json={"fields": ["client_secret"]}).json()["sources"]["client_secret"] == "environment"


@pytest.mark.parametrize("callback", ["", "file:///api/auth/x/callback", "http://[bad", "https://app.test/elsewhere", "https://app.test:0/api/auth/x/callback"])
def test_invalid_callback_rejected(callback):
    with pytest.raises(ValueError):
        XSettingsUpdate(callback_url=callback)
    with pytest.raises(ValueError):
        XSettingsReset(fields=["other"])


@respx.mock
def test_oauth_uses_saved_credentials_and_invalidates_old_links(client, db):
    old_url = client.post("/api/auth/x/start").json()["authorize_url"]
    old_state = parse_qs(urlsplit(old_url).query)["state"][0]
    client.put("/api/settings/x", json={"client_id": "new-id", "client_secret": "new-secret", "callback_url": "https://app.test/api/auth/x/callback"})
    assert db.get(OAuthState, old_state).consumed
    assert client.get("/api/auth/x/callback", params={"state": old_state, "code": "old-code"}).status_code == 400
    authorize = client.post("/api/auth/x/start").json()["authorize_url"]
    params = parse_qs(urlsplit(authorize).query)
    assert params["client_id"] == ["new-id"]
    assert params["redirect_uri"] == ["https://app.test/api/auth/x/callback"]
    assert "new-secret" not in authorize
    token = respx.post("https://api.x.com/2/oauth2/token").mock(return_value=httpx.Response(200, json={"access_token": "mock-token", "refresh_token": "mock-refresh"}))
    respx.get("https://api.x.com/2/users/me").mock(return_value=httpx.Response(200, json={"data": {"id": "42", "username": "test", "name": "Test"}}))
    callback = client.get("/api/auth/x/callback", params={"state": params["state"][0], "code": "mock-code"}, follow_redirects=False)
    assert callback.status_code == 307
    assert callback.headers["location"].endswith("/settings?x=connected#settings-connections")
    request = token.calls.last.request
    assert parse_qs(request.content.decode())["client_id"] == ["new-id"]
    assert parse_qs(request.content.decode())["redirect_uri"] == params["redirect_uri"]
    assert request.headers["Authorization"] == "Basic " + base64.b64encode(b"new-id:new-secret").decode()
    assert client.put("/api/settings/x", json={"client_id": "different"}).status_code == 409
    assert client.post("/api/settings/x/reset", json={"fields": ["client_id"]}).status_code == 409


@pytest.mark.asyncio
@respx.mock
async def test_expired_token_refresh_uses_saved_credentials(db, env):
    save_x_settings(db, XSettingsUpdate(client_id="new-id", client_secret="new-secret"))
    token = {"access_token": "old-token", "refresh_token": "old-refresh", "expires_at": (datetime.now(UTC) - timedelta(minutes=1)).isoformat()}
    db.add(XConnection(x_user_id="42", username="test", name="Test", token_encrypted=security.encrypt(json.dumps(token))))
    db.commit()
    route = respx.post("https://api.x.com/2/oauth2/token").mock(return_value=httpx.Response(200, json={"access_token": "fresh-token"}))
    _, refreshed = await get_connection_token(db)
    assert refreshed["access_token"] == "fresh-token"
    assert refreshed["refresh_token"] == "old-refresh"
    assert parse_qs(route.calls.last.request.content.decode())["client_id"] == ["new-id"]
    assert route.calls.last.request.headers["Authorization"] == "Basic " + base64.b64encode(b"new-id:new-secret").decode()
