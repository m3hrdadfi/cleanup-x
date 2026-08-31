from datetime import UTC, datetime

import pytest
from app import main
from app.llm import compile_policy
from app.models import Classification, DeletionItem, DeletionJob, Post, Scan
from app.schemas import (
    DeletionCreate,
    DeletionRetry,
    PolicyRequest,
    RepostResolutionCreate,
    ScanCreate,
)
from fastapi import HTTPException
from sqlalchemy import select


@pytest.mark.asyncio
async def test_exact_count_is_required_before_job_creation(db, monkeypatch):
    monkeypatch.setattr(main, "schedule_deletion", lambda _job_id: None)
    post = Post(id="1", text="political text")
    scan = Scan(
        prompt="politics",
        policy_json=compile_policy(PolicyRequest(prompt="politics")).model_dump_json(),
        status="completed",
    )
    db.add_all([post, scan])
    db.flush()
    db.add(
        Classification(
            scan_id=scan.id,
            post_id=post.id,
            matches=True,
            confidence=0.9,
            selected=True,
            cache_key="a" * 64,
        )
    )
    db.commit()
    with pytest.raises(HTTPException, match="exact selected count"):
        await main.create_deletion(
            DeletionCreate(scan_id=scan.id, confirmation_count=0), db, "wrong-count"
        )
    created = await main.create_deletion(
        DeletionCreate(scan_id=scan.id, confirmation_count=1), db, "right-count"
    )
    assert created["total"] == 1


@pytest.mark.asyncio
async def test_history_retry_only_carries_forward_remaining_items(db, monkeypatch):
    monkeypatch.setattr(main, "schedule_deletion", lambda _job_id: None)
    scan = Scan(
        prompt="politics",
        policy_json=compile_policy(PolicyRequest(prompt="politics")).model_dump_json(),
        status="completed",
    )
    posts = [Post(id=str(index), text=f"post {index}") for index in range(1, 4)]
    posts[1].deleted_at = datetime.now(UTC)
    db.add_all([scan, *posts])
    db.flush()
    source = DeletionJob(
        scan_id=scan.id,
        status="completed",
        manifest_json='{"items": []}',
        manifest_sha256="b" * 64,
        total=3,
        processed=2,
        succeeded=1,
        failed=1,
    )
    db.add(source)
    db.flush()
    db.add_all(
        [
            DeletionItem(job_id=source.id, post_id=posts[0].id, status="failed"),
            DeletionItem(job_id=source.id, post_id=posts[1].id, status="deleted"),
            DeletionItem(job_id=source.id, post_id=posts[2].id, status="pending"),
        ]
    )
    db.commit()

    history = main.list_deletions(db, page=1, page_size=25)
    assert history["items"][0]["retryable"] == 2

    with pytest.raises(HTTPException, match="exact retry count"):
        await main.retry_deletion(source.id, DeletionRetry(confirmation_count=1), db, "wrong")
    retried = await main.retry_deletion(
        source.id, DeletionRetry(confirmation_count=2), db, "correct"
    )
    retry_ids = set(
        db.scalars(select(DeletionItem.post_id).where(DeletionItem.job_id == retried["id"])).all()
    )
    assert retry_ids == {posts[0].id, posts[2].id}


@pytest.mark.asyncio
async def test_completed_scan_can_be_run_again(db, monkeypatch):
    scheduled: list[str] = []
    monkeypatch.setattr(main, "schedule_scan", scheduled.append)
    source = Scan(
        prompt="politics",
        policy_json=compile_policy(PolicyRequest(prompt="politics")).model_dump_json(),
        threshold=0.91,
        content_types_json='["post"]',
        languages_json='["en"]',
        max_posts=25,
        status="completed",
    )
    db.add(source)
    db.commit()
    created = await main.rerun_scan(source.id, db, "rerun")
    assert created["id"] != source.id
    assert created["threshold"] == 0.91
    assert created["max_posts"] == 25
    assert scheduled == [created["id"]]


@pytest.mark.asyncio
async def test_new_scan_is_blocked_until_active_scan_is_cancelled(db, monkeypatch):
    monkeypatch.setattr(main, "schedule_scan", lambda _scan_id: None)
    active = Scan(
        prompt="first request",
        policy_json=compile_policy(PolicyRequest(prompt="first request")).model_dump_json(),
        status="running",
    )
    db.add(active)
    db.commit()
    request = ScanCreate(prompt="second request")
    with pytest.raises(HTTPException, match="already running"):
        await main.create_scan(request, db, "second")
    cancelled = main.cancel_scan(active.id, db)
    assert cancelled["status"] == "cancelled"
    created = await main.create_scan(request, db, "after-cancel")
    assert created["prompt"] == "second request"


def test_inventory_scan_views_do_not_combine_classifications(db):
    post_a = Post(id="a", text="AI post", posted_at=datetime(2026, 1, 2, tzinfo=UTC))
    post_b = Post(id="b", text="Political post", posted_at=datetime(2026, 1, 1, tzinfo=UTC))
    ai_scan = Scan(
        prompt="AI posts",
        policy_json=compile_policy(PolicyRequest(prompt="AI posts")).model_dump_json(),
        status="completed",
    )
    political_scan = Scan(
        prompt="Political posts",
        policy_json=compile_policy(PolicyRequest(prompt="Political posts")).model_dump_json(),
        status="completed",
    )
    db.add_all([post_a, post_b, ai_scan, political_scan])
    db.flush()
    db.add_all(
        [
            Classification(
                scan_id=ai_scan.id,
                post_id=post_a.id,
                matches=True,
                confidence=0.95,
                selected=True,
                cache_key="c" * 64,
            ),
            Classification(
                scan_id=political_scan.id,
                post_id=post_b.id,
                matches=True,
                confidence=0.91,
                selected=True,
                cache_key="d" * 64,
            ),
        ]
    )
    db.commit()
    ai_view = main.list_posts(
        db,
        page=1,
        page_size=50,
        search="",
        content_type=None,
        origin=None,
        scan_id=ai_scan.id,
        scan_result=None,
    )
    political_view = main.list_posts(
        db,
        page=1,
        page_size=50,
        search="",
        content_type=None,
        origin=None,
        scan_id=political_scan.id,
        scan_result=None,
    )
    assert [item["id"] for item in ai_view["items"]] == ["a"]
    assert [item["id"] for item in political_view["items"]] == ["b"]
    assert ai_view["items"][0]["classification"]["confidence"] == 0.95


@pytest.mark.asyncio
async def test_repost_resolution_requires_exact_count(db, monkeypatch):
    monkeypatch.setattr(main, "schedule_repost_resolution", lambda _job_id: None)
    post = Post(id="100", text="RT", content_type="repost")
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
        manifest_sha256="c" * 64,
        total=1,
        processed=1,
        failed=1,
    )
    db.add(deletion)
    db.flush()
    db.add(DeletionItem(job_id=deletion.id, post_id=post.id, status="unresolved"))
    db.commit()
    with pytest.raises(HTTPException, match="exact unresolved repost count"):
        await main.resolve_reposts(
            deletion.id, RepostResolutionCreate(confirmation_count=0), db, "wrong-resolution"
        )
    created = await main.resolve_reposts(
        deletion.id, RepostResolutionCreate(confirmation_count=1), db, "right-resolution"
    )
    assert created["total"] == 1
