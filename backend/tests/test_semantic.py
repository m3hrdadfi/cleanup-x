import json
from datetime import UTC, datetime

import httpx
import pytest
import respx
from app import embeddings as em
from app import main, security, semantic
from app.config import Settings
from app.models import AppSetting, Classification, DeletionJob, EmbeddingJob, Post, PostEmbedding
from cryptography.fernet import Fernet
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import func, select


@pytest.fixture(autouse=True)
def environment(monkeypatch):
    settings = Settings(_env_file=None, env="test", encryption_key=Fernet.generate_key().decode(),
                        embedding_base_url="http://embeddings.test", embedding_model="multi", embedding_api_key="env-secret",
                        embedding_batch_size=1)
    monkeypatch.setattr(em, "get_settings", lambda: settings)
    monkeypatch.setattr(security, "get_settings", lambda: settings)
    return settings


def ready(db):
    config = em.embedding_settings(db)
    em.store(db, "embedding_test", {"key": em.test_key(config), "dimensions": 2})
    return config


def add_vector(db, config, post_id, vector):
    data = semantic.corpus(db)
    db.add(PostEmbedding(profile=em.profile(config), post_id=post_id, content_hash=data[post_id][2], vector_json=json.dumps(vector)))
    db.commit()


@pytest.mark.parametrize("vector", [[], [0, 0], [True, 1], [float("nan"), 1], [float("inf"), 1], ["1", 1], None])
def test_reject_invalid_vectors(vector):
    with pytest.raises(em.EmbeddingError):
        em.normalize_vector(vector)


@pytest.mark.asyncio
@respx.mock
async def test_adapters_use_exact_url_auth_order_and_no_truncation():
    native = respx.post("http://embeddings.test/api/embed").mock(return_value=httpx.Response(200, json={"embeddings": [[3, 4], [1, 0]]}))
    settings = em.EmbeddingSettings(base_url="http://embeddings.test", model="multi", api_key="secret")
    assert await em.EmbeddingClient(settings).embed(["Hello", "سلام"]) == [[.6, .8], [1., 0.]]
    assert native.calls[0].request.headers["Authorization"] == "Bearer secret"
    assert json.loads(native.calls[0].request.content)["truncate"] is False
    compatible = respx.post("http://embeddings.test/custom/v1/embeddings").mock(return_value=httpx.Response(200, json={"data": [{"index": 1, "embedding": [0, 2]}, {"index": 0, "embedding": [2, 0]}]}))
    settings.provider, settings.base_url = "openai_compatible", "http://embeddings.test/custom/v1"
    assert await em.EmbeddingClient(settings).embed(["one", "two"]) == [[1., 0.], [0., 1.]]
    assert compatible.call_count == 1


@pytest.mark.parametrize("payload", [{"embeddings": [[1, 0]]}, {"embeddings": [[1, 0], [1, 0, 0]]}, {"data": [{"index": 0, "embedding": [1, 0]}, {"index": 0, "embedding": [1, 0]}]}])
async def test_adapter_rejects_missing_duplicate_and_inconsistent_vectors(payload, monkeypatch):
    async def request(*args):
        return payload
    monkeypatch.setattr(em.EmbeddingClient, "request", request)
    client = em.EmbeddingClient(em.EmbeddingSettings(model="test", provider="openai_compatible" if "data" in payload else "ollama"))
    with pytest.raises(em.EmbeddingError):
        await client.embed(["one", "two"])


@pytest.mark.parametrize("status", [401, 403, 404, 429, 500])
@respx.mock
async def test_provider_errors_do_not_expose_response_or_credentials(status):
    respx.post("http://embeddings.test/api/embed").mock(return_value=httpx.Response(status, text="private-response-secret"))
    with pytest.raises(em.EmbeddingError) as exc:
        await em.EmbeddingClient(em.EmbeddingSettings(base_url="http://embeddings.test", model="test", api_key="private-api-key")).embed(["text"])
    assert str(status) in str(exc.value)
    assert "private" not in str(exc.value)


@respx.mock
async def test_model_discovery_and_timeout():
    respx.get("http://embeddings.test/v1/models").respond(200, json={"data": [{"id": "multi"}, {"id": "multi"}]})
    client = em.EmbeddingClient(em.EmbeddingSettings(provider="openai_compatible", base_url="http://embeddings.test/v1", model="multi"))
    assert await client.models() == ["multi"]
    respx.post("http://embeddings.test/v1/embeddings").mock(side_effect=httpx.ReadTimeout("private-timeout-message"))
    with pytest.raises(em.EmbeddingError, match="timed out"):
        await client.embed(["test"])


def test_settings_mask_encrypt_keep_reset_and_do_not_forward_secret(db):
    result = em.save_settings(db, em.EmbeddingSettings(api_key="new-secret", model="custom"))
    assert result["api_key_configured"] and "new-secret" not in json.dumps(result)
    assert "new-secret" not in db.get(AppSetting, "embedding").value_encrypted
    em.save_settings(db, em.EmbeddingSettings(api_key="", batch_size=4))
    assert em.embedding_settings(db).api_key.get_secret_value() == "new-secret"
    draft = em.effective_draft(db, em.EmbeddingSettings(base_url="http://another.test"))
    assert draft.api_key.get_secret_value() == ""
    em.save_settings(db, em.EmbeddingSettings(base_url="http://another.test", api_key="another-key"))
    em.save_settings(db, reset=["base_url"])
    assert em.embedding_settings(db).api_key.get_secret_value() == ""
    em.save_settings(db, reset=["api_key", "model"])
    assert em.embedding_settings(db).api_key.get_secret_value() == "env-secret"
    assert em.embedding_settings(db).model == "multi"


async def test_only_saved_test_marks_settings_ready(db, monkeypatch):
    async def embed(self, texts, dimensions=None):
        assert len(texts) == 2
        return [[1, 0], [0, 1]]
    monkeypatch.setattr(em.EmbeddingClient, "embed", embed)
    assert not (await em.test_provider(db, em.EmbeddingSettings(model="draft")))["saved_settings_tested"]
    assert not em.public_settings(db)["tested"]
    assert (await em.test_provider(db, em.EmbeddingSettings()))["saved_settings_tested"]
    assert em.public_settings(db)["tested"]
    em.save_settings(db, em.EmbeddingSettings(model="different"))
    assert not em.public_settings(db)["tested"]


async def test_index_restart_failure_incremental_and_idempotency(session_factory, monkeypatch):
    monkeypatch.setattr(semantic, "SessionLocal", session_factory)
    monkeypatch.setattr(semantic, "schedule", lambda _: None)
    requests = []
    async def embed(self, texts, dimensions=None):
        requests.extend(texts)
        if "second" in texts:
            raise em.EmbeddingError("Embedding provider returned HTTP 429")
        return [[1, 0] for _ in texts]
    monkeypatch.setattr(em.EmbeddingClient, "embed", embed)
    with session_factory() as db:
        db.add_all([Post(id="1", text="first"), Post(id="2", text="second")]); db.commit(); ready(db)
        job = await semantic.start_index(semantic.IndexRequest(confirmed=True), db, "once")
        assert (await semantic.start_index(semantic.IndexRequest(confirmed=True), db, "once"))["id"] == job["id"]
        with pytest.raises(HTTPException):
            em.save_settings(db, em.EmbeddingSettings(model="new"))
    await semantic.run_index(job["id"])
    with session_factory() as db:
        stored_job = db.get(EmbeddingJob, job["id"])
        assert (stored_job.status, stored_job.processed) == ("paused", 1)
        assert db.scalar(select(func.count()).select_from(PostEmbedding)) == 1
        await semantic.control_index(job["id"], "resume", db)
    async def successful(self, texts, dimensions=None):
        requests.extend(texts)
        return [[1, 0] for _ in texts]
    monkeypatch.setattr(em.EmbeddingClient, "embed", successful)
    await semantic.run_index(job["id"])
    assert requests == ["first", "second", "second"]
    with session_factory() as db:
        assert db.get(EmbeddingJob, job["id"]).status == "completed"
        assert semantic.index_status(db)["pending"] == 0
        empty = await semantic.start_index(semantic.IndexRequest(confirmed=True), db, "empty")
    await semantic.run_index(empty["id"])
    with session_factory() as db:
        db.get(Post, "1").text = "edited"; db.commit()
        assert semantic.index_status(db)["pending"] == 1
        changed = await semantic.start_index(semantic.IndexRequest(confirmed=True), db, "edited")
    await semantic.run_index(changed["id"])
    assert requests[-1] == "edited" and requests.count("first") == 1


@pytest.mark.parametrize("action", ["pause", "cancel", "edit", "delete"])
async def test_inflight_changes_do_not_write_stale_embeddings(session_factory, monkeypatch, action):
    monkeypatch.setattr(semantic, "SessionLocal", session_factory)
    monkeypatch.setattr(semantic, "schedule", lambda _: None)
    with session_factory() as db:
        db.add(Post(id="1", text="original")); db.commit(); ready(db)
        job = await semantic.start_index(semantic.IndexRequest(confirmed=True), db, "inflight")
    async def embed(self, texts, dimensions=None):
        with session_factory() as db:
            if action in ("pause", "cancel"):
                await semantic.control_index(job["id"], action, db)
            elif action == "edit":
                db.get(Post, "1").text = "changed"; db.commit()
            else:
                db.get(Post, "1").deleted_at = datetime.now(UTC); db.commit()
        return [[1, 0]]
    monkeypatch.setattr(em.EmbeddingClient, "embed", embed)
    await semantic.run_index(job["id"])
    with session_factory() as db:
        assert db.scalar(select(func.count()).select_from(PostEmbedding)) == 0
        if action in ("pause", "cancel"):
            assert db.get(EmbeddingJob, job["id"]).processed == 0
        else:
            assert db.get(EmbeddingJob, job["id"]).skipped == 1


async def test_multilingual_search_filters_stale_profile_and_read_only(db, monkeypatch):
    db.add_all([Post(id="1", text="یادگیری ماشین", language="fa", content_type="post", posted_at=datetime(2025, 1, 1, tzinfo=UTC)),
                Post(id="2", text="learning to cook", language="en", content_type="reply", posted_at=datetime(2024, 1, 1, tzinfo=UTC)),
                Post(id="3", text="machine learning", language="en", deleted_at=datetime.now(UTC)),
                Post(id="4", text="machine learning archive", language="en")])
    db.commit(); config = ready(db)
    add_vector(db, config, "1", [1, 0]); add_vector(db, config, "2", [0, 1])
    requests = []
    async def embed(self, texts, dimensions=None):
        requests.extend(texts)
        return [[1, 0]]
    monkeypatch.setattr(em.EmbeddingClient, "embed", embed)
    result = await semantic.search(semantic.SearchRequest(query="artificial intelligence", mode="semantic"), db)
    assert [item["id"] for item in result["items"]] == ["1", "2"]
    assert result["items"][0]["similarity"] == 1
    filtered = await semantic.search(semantic.SearchRequest(query="AI", mode="semantic", language="fa", date_from="2025-01-01", date_to="2025-01-01"), db)
    assert [item["id"] for item in filtered["items"]] == ["1"]
    hybrid = await semantic.search(semantic.SearchRequest(query="machine learning", mode="hybrid"), db)
    assert "4" in [item["id"] for item in hybrid["items"]]
    db.get(Post, "1").text = "changed"; db.commit()
    assert semantic.index_status(db)["pending"] == 2
    result = await semantic.search(semantic.SearchRequest(query="AI", mode="semantic"), db)
    assert [item["id"] for item in result["items"]] == ["2"]
    em.save_settings(db, em.EmbeddingSettings(model="different")); ready(db)
    before = len(requests)
    assert (await semantic.search(semantic.SearchRequest(query="AI", mode="semantic"), db))["items"] == []
    assert len(requests) == before
    assert (await semantic.search(semantic.SearchRequest(query="machine", mode="keyword"), db))["items"][0]["id"] == "4"
    assert len(requests) == before
    assert db.scalar(select(func.count()).select_from(Classification)) == 0
    assert db.scalar(select(func.count()).select_from(DeletionJob)) == 0


def test_http_csrf_validation_redaction_and_readiness(db, monkeypatch, environment):
    environment.env = "development"
    main.app.dependency_overrides[main.get_db] = lambda: db
    try:
        client = TestClient(main.app)
        assert client.get("/api/settings/embedding").status_code == 200
        assert client.post("/api/search", json={"query": "AI"}).status_code == 403
        client.cookies.set("cleanup_csrf", "token")
        headers = {"X-CSRF-Token": "token"}
        response = client.put("/api/settings/embedding", headers=headers, json={"api_key": "private-secret", "base_url": "http://user:private-secret@test"})
        assert response.status_code == 422 and "private-secret" not in response.text
        assert client.post("/api/search", headers=headers, json={"query": "AI"}).status_code == 409
        assert client.post("/api/search", headers=headers, json={"query": "AI", "mode": "keyword"}).status_code == 200
        assert client.post("/api/search/index", headers={**headers, "Idempotency-Key": "confirm"}, json={"confirmed": False}).status_code == 422
    finally:
        main.app.dependency_overrides.clear()


def test_startup_only_resumes_unfinished_active_jobs(session_factory, monkeypatch):
    monkeypatch.setattr(semantic, "SessionLocal", session_factory)
    scheduled = []
    monkeypatch.setattr(semantic, "schedule", scheduled.append)
    with session_factory() as db:
        for status in ("pending", "running", "paused", "cancelled", "completed"):
            db.add(EmbeddingJob(id=status, request_key=status, profile="profile", items_json="[]", status=status))
        db.commit()
    semantic.resume_indexes()
    assert set(scheduled) == {"pending", "running"}


def test_dimensions_and_repost_quote_changes_invalidate_cached_vectors(db):
    db.add_all([Post(id="quote", text="original quoted text"), Post(id="1", text="my comment", quoted_post_id="quote"),
                Post(id="2", text="RT truncated", source_text="full original repost")])
    db.commit(); config = ready(db)
    assert "original quoted text" in semantic.corpus(db)["1"][1]
    assert "full original repost" in semantic.corpus(db)["2"][1]
    add_vector(db, config, "1", [1, 0]); add_vector(db, config, "2", [1, 0])
    assert semantic.index_status(db)["indexed"] == 2
    db.get(Post, "quote").text = "edited quoted text"; db.commit()
    assert semantic.index_status(db)["indexed"] == 1
    em.store(db, "embedding_test", {"key": em.test_key(config), "dimensions": 3})
    assert semantic.index_status(db)["indexed"] == 0


async def test_deleted_during_query_is_not_returned(session_factory, monkeypatch):
    with session_factory() as db:
        db.add(Post(id="1", text="hello")); db.commit()
        config = ready(db); add_vector(db, config, "1", [1, 0])
        async def embed(self, texts, dimensions=None):
            with session_factory() as writer:
                writer.get(Post, "1").deleted_at = datetime.now(UTC); writer.commit()
            return [[1, 0]]
        monkeypatch.setattr(em.EmbeddingClient, "embed", embed)
        result = await semantic.search(semantic.SearchRequest(query="hello"), db)
        assert result["items"] == []


def test_migration_creates_schema_without_changing_posts(tmp_path):
    import importlib.util
    from pathlib import Path

    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import create_engine, inspect

    path = Path(__file__).resolve().parents[1] / "alembic/versions/0005_semantic_search.py"
    spec = importlib.util.spec_from_file_location("semantic_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine(f"sqlite:///{tmp_path / 'migration.db'}")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE posts (id VARCHAR(32) PRIMARY KEY)")
        connection.exec_driver_sql("INSERT INTO posts VALUES ('1')")
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade(); migration.upgrade()
            assert {"embedding_jobs", "post_embeddings"} <= set(inspect(connection).get_table_names())
            migration.downgrade()
            assert connection.exec_driver_sql("SELECT id FROM posts").scalar() == "1"
