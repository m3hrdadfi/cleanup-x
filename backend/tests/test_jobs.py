import json
from datetime import UTC, datetime, timedelta

import pytest
from app import jobs
from app.jobs import build_manifest, run_scan
from app.llm import compile_policy
from app.models import (
    Classification,
    DeletionItem,
    DeletionJob,
    Post,
    RepostResolutionJob,
    Scan,
)
from app.schemas import ClassificationBatch, ClassificationOutput, PolicyRequest
from app.x_client import DeleteResult


class FakeClient:
    def __init__(self, _settings):
        pass

    async def classify(self, _policy, posts):
        confidence = {"849": 0.849, "850": 0.85}
        return ClassificationBatch(
            results=[
                ClassificationOutput(
                    post_id=p["post_id"],
                    matches=True,
                    confidence=confidence[p["post_id"]],
                    detected_language="en",
                    topics=["politics"],
                    reason_en="Political",
                    reason_fa="سیاسی",
                )
                for p in posts
            ]
        )


@pytest.mark.asyncio
async def test_threshold_boundary_and_manifest(session_factory, monkeypatch):
    monkeypatch.setattr(jobs, "SessionLocal", session_factory)
    monkeypatch.setattr(jobs, "LLMClient", FakeClient)
    policy = compile_policy(PolicyRequest(prompt="political posts"))
    with session_factory() as db:
        db.add_all(
            [Post(id="849", text="one", language="en"), Post(id="850", text="two", language="en")]
        )
        scan = Scan(prompt="political posts", policy_json=policy.model_dump_json(), threshold=0.85)
        db.add(scan)
        db.commit()
        scan_id = scan.id
    await run_scan(scan_id)
    with session_factory() as db:
        rows = {row.post_id: row for row in db.query(Classification).all()}
        assert rows["849"].selected is False
        assert rows["850"].selected is True
        manifest, digest, selected = build_manifest(db, scan_id)
        assert [row.post_id for row in selected] == ["850"]
        assert len(digest) == 64
        assert json.loads(manifest)["items"][0]["post_id"] == "850"


class BrokenClient(FakeClient):
    async def classify(self, _policy, _posts):
        raise ValueError("invalid JSON")


class LimitClient(FakeClient):
    async def classify(self, _policy, posts):
        return ClassificationBatch(
            results=[
                ClassificationOutput(
                    post_id=post["post_id"],
                    matches=False,
                    confidence=0.7,
                    detected_language="en",
                    topics=[],
                    reason_en="Not selected",
                    reason_fa="انتخاب نشد.",
                )
                for post in posts
            ]
        )


@pytest.mark.asyncio
async def test_scan_limit_uses_newest_eligible_posts(session_factory, monkeypatch):
    monkeypatch.setattr(jobs, "SessionLocal", session_factory)
    monkeypatch.setattr(jobs, "LLMClient", LimitClient)
    policy = compile_policy(PolicyRequest(prompt="politics"))
    now = datetime.now(UTC)
    with session_factory() as db:
        db.add_all(
            [
                Post(id=str(index), text=f"post {index}", posted_at=now - timedelta(days=index))
                for index in range(4)
            ]
        )
        scan = Scan(prompt="politics", policy_json=policy.model_dump_json(), max_posts=2)
        db.add(scan)
        db.commit()
        scan_id = scan.id

    await run_scan(scan_id)

    with session_factory() as db:
        classified_ids = {row.post_id for row in db.query(Classification).all()}
        assert classified_ids == {"0", "1"}
        scan = db.get(Scan, scan_id)
        assert scan.total == 2
        assert scan.processed == 2


@pytest.mark.asyncio
async def test_model_failure_is_never_selected(session_factory, monkeypatch):
    monkeypatch.setattr(jobs, "SessionLocal", session_factory)
    monkeypatch.setattr(jobs, "LLMClient", BrokenClient)
    policy = compile_policy(PolicyRequest(prompt="politics"))
    with session_factory() as db:
        db.add(Post(id="1", text="anything", language="en"))
        scan = Scan(prompt="politics", policy_json=policy.model_dump_json())
        db.add(scan)
        db.commit()
        scan_id = scan.id
    await run_scan(scan_id)
    with session_factory() as db:
        result = db.query(Classification).one()
        assert result.status == "failed"
        assert result.selected is False


@pytest.mark.asyncio
async def test_deletion_job_is_persisted_to_completion(session_factory, monkeypatch):
    monkeypatch.setattr(jobs, "SessionLocal", session_factory)

    async def fake_delete(_db, _post):
        return DeleteResult("deleted")

    monkeypatch.setattr(jobs, "delete_post", fake_delete)
    with session_factory() as db:
        db.add(Post(id="delete-me", text="text"))
        scan = Scan(
            prompt="politics",
            policy_json=compile_policy(PolicyRequest(prompt="politics")).model_dump_json(),
            status="completed",
        )
        db.add(scan)
        db.flush()
        job = DeletionJob(scan_id=scan.id, manifest_json="{}", manifest_sha256="0" * 64, total=1)
        db.add(job)
        db.flush()
        db.add(DeletionItem(job_id=job.id, post_id="delete-me"))
        db.commit()
        job_id = job.id
    await jobs.run_deletion(job_id)
    with session_factory() as db:
        job = db.get(DeletionJob, job_id)
        assert job.status == "completed"
        assert job.succeeded == 1
        assert db.get(Post, "delete-me").deleted_at is not None


@pytest.mark.asyncio
async def test_repost_resolution_job_checkpoints_source_ids(session_factory, monkeypatch):
    monkeypatch.setattr(jobs, "SessionLocal", session_factory)

    async def fake_resolve(_db, post_ids):
        return {post_id: f"source-{post_id}" for post_id in post_ids}

    monkeypatch.setattr(jobs, "resolve_repost_sources", fake_resolve)
    with session_factory() as db:
        post = Post(id="repost-1", text="RT", content_type="repost")
        scan = Scan(
            prompt="politics",
            policy_json=compile_policy(PolicyRequest(prompt="politics")).model_dump_json(),
            status="completed",
        )
        db.add_all([post, scan])
        db.flush()
        deletion = DeletionJob(
            scan_id=scan.id,
            status="completed",
            manifest_json="{}",
            manifest_sha256="0" * 64,
            total=1,
            processed=1,
            failed=1,
        )
        db.add(deletion)
        db.flush()
        db.add(DeletionItem(job_id=deletion.id, post_id=post.id, status="unresolved"))
        resolution = RepostResolutionJob(deletion_job_id=deletion.id, total=1)
        db.add(resolution)
        db.commit()
        resolution_id = resolution.id
    await jobs.run_repost_resolution(resolution_id)
    with session_factory() as db:
        resolution = db.get(RepostResolutionJob, resolution_id)
        assert resolution.status == "completed"
        assert resolution.resolved == 1
        assert db.get(Post, "repost-1").source_post_id == "source-repost-1"
