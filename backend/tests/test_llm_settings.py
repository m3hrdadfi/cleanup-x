from types import SimpleNamespace

from app import services
from app.schemas import LLMSettings


def environment_settings(**overrides):
    values = {
        "llm_provider": "openai_compatible",
        "llm_base_url": "http://gateway.test/v1",
        "llm_model": "env-model",
        "llm_api_key": "environment-secret",
        "llm_timeout_seconds": 90,
        "llm_batch_size": 6,
        "llm_vision_enabled": False,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_environment_llm_secret_is_masked(db, monkeypatch):
    monkeypatch.setattr(services, "get_settings", lambda: environment_settings())

    response = services.masked_llm_settings(db)

    assert response["base_url"] == "http://gateway.test/v1"
    assert response["api_key"] == "********"
    assert response["environment"]["api_key_configured"] is True
    assert "environment-secret" not in repr(response)
    assert response["sources"]["api_key"] == "environment"


def test_saved_fields_can_reset_to_environment(db, monkeypatch):
    active_environment = [environment_settings()]
    monkeypatch.setattr(services, "get_settings", lambda: active_environment[0])
    services.save_llm_settings(
        db,
        LLMSettings(
            provider="openai_compatible",
            base_url="http://saved.test",
            model="saved-model",
            api_key="saved-secret",
        ),
    )

    before = services.masked_llm_settings(db)
    assert before["sources"]["base_url"] == "saved"
    assert before["sources"]["api_key"] == "saved"

    services.reset_llm_settings_fields(db, ["base_url", "api_key"])
    after = services.masked_llm_settings(db)
    assert after["base_url"] == "http://gateway.test/v1"
    assert after["api_key"] == "********"
    assert after["sources"]["base_url"] == "environment"
    assert after["sources"]["api_key"] == "environment"
    assert "environment-secret" not in repr(after)

    active_environment[0] = environment_settings(
        llm_base_url="http://new-env.test/v1", llm_api_key="new-environment-secret"
    )
    refreshed = services.masked_llm_settings(db)
    assert refreshed["base_url"] == "http://new-env.test/v1"
    assert refreshed["api_key"] == "********"
    assert "new-environment-secret" not in repr(refreshed)
