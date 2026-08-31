import json
from unittest.mock import AsyncMock

import pytest
from app import jobs, main
from app.models import (
    AuditEvent,
    Classification,
    DeletionItem,
    DeletionJob,
    InventoryRemoval,
    Post,
    Scan,
)
from fastapi.testclient import TestClient
from sqlalchemy import func, select


@pytest.fixture
def inventory_client(db, monkeypatch):
    def test_db():
        yield db

    main.app.dependency_overrides[main.get_db] = test_db
    delete_on_x = AsyncMock(side_effect=AssertionError("Local removal must never call X"))
    monkeypatch.setattr(jobs, "delete_post", delete_on_x)
    # No lifespan: never resume the user's real background jobs in this test.
    client = TestClient(main.app)
    client.get("/api/health")
    client.headers["X-CSRF-Token"] = client.cookies["cleanup_csrf"]
    client.headers["Idempotency-Key"] = "local-removal-test"
    yield client
    delete_on_x.assert_not_called()
    client.close()
    main.app.dependency_overrides.clear()


def seed(db):
    scans = [Scan(id=f"scan-{i}", prompt="Find technology", policy_json="{}", status="completed", total=2, processed=2) for i in range(2)]
    posts = [Post(id=str(i), text=f"Source {i}", from_archive=True) for i in range(2)]
    db.add_all([*scans, *posts])
    db.flush()
    for scan in scans:
        for post in posts:
            db.add(Classification(scan_id=scan.id, post_id=post.id, matches=True, confidence=.95, selected=True, cache_key="a" * 64))
    db.commit()
    return scans


def remove(client, path, body=None):
    return client.request("DELETE", path, json={"confirmed": True} if body is None else body)


def test_item_removal_is_scoped_persistent_and_excluded_from_deletion(db, inventory_client):
    seed(db)
    client = inventory_client
    path = "/api/inventory/sessions/scan-0/items/0"
    assert remove(client, path).json()["local_only"] is True
    db.expire_all()
    assert client.get("/api/posts?scan_id=scan-0").json()["total"] == 1
    assert client.get("/api/posts?scan_id=scan-1").json()["total"] == 2
    assert client.get("/api/posts").json()["total"] == 2
    assert client.get("/api/scans/scan-0/results").json()["total"] == 1
    assert client.get("/api/scans/scan-0").json()["counts"]["selected"] == 1
    # A stale UI cannot reselect a removed item.
    assert client.post("/api/scans/scan-0/selection", json={"post_ids": ["0"], "selected": True}).json()["updated"] == 0
    assert [row.post_id for row in jobs.build_manifest(db, "scan-0")[2]] == ["1"]
    assert db.get(Post, "0").deleted_at is None
    assert db.scalar(select(func.count()).select_from(Classification)) == 4
    # Retry the same request and then a fresh key: one tombstone and one removal audit.
    assert remove(client, path).status_code == 200
    client.headers["Idempotency-Key"] = "second-key"
    assert remove(client, path).status_code == 200
    assert db.scalar(select(func.count()).select_from(InventoryRemoval)) == 1
    assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.event_type == "inventory.item.removed")) == 1


def test_session_removal_keeps_posts_other_sessions_and_deletion_history(db, inventory_client):
    seed(db)
    job = DeletionJob(id="old-job", scan_id="scan-0", status="completed", manifest_json='{"items":[]}', manifest_sha256="a" * 64)
    db.add(job)
    db.flush()
    db.add(DeletionItem(job_id=job.id, post_id="0", status="failed"))
    db.commit()
    original_manifest = job.manifest_json
    assert remove(inventory_client, "/api/inventory/sessions/scan-0").status_code == 200
    db.expire_all()
    assert [item["id"] for item in inventory_client.get("/api/scans").json()["items"]] == ["scan-1"]
    assert inventory_client.get("/api/posts?scan_id=scan-0").status_code == 404
    assert inventory_client.get("/api/posts").json()["total"] == 2
    assert db.get(DeletionJob, job.id).manifest_json == original_manifest
    assert db.scalar(select(func.count()).select_from(DeletionItem)) == 1
    assert jobs.build_manifest(db, "scan-0")[2] == []
    assert inventory_client.get("/api/overview").json()["latest_scan"]["id"] == "scan-1"
    assert inventory_client.get(f"/api/deletion-jobs/{job.id}").status_code == 200
    event = db.scalar(select(AuditEvent).where(AuditEvent.event_type == "inventory.session.removed"))
    assert json.loads(event.details_json)["local_only"] is True


@pytest.mark.parametrize("status", ["pending", "running", "paused", "rate_limited", "reauth_required"])
def test_active_deletion_jobs_block_removal(db, inventory_client, status):
    seed(db)
    db.add(DeletionJob(scan_id="scan-0", status=status, manifest_json="{}", manifest_sha256="a" * 64))
    db.commit()
    for suffix in ("", "/items/0"):
        assert remove(inventory_client, f"/api/inventory/sessions/scan-0{suffix}").status_code == 409
    assert db.scalar(select(func.count()).select_from(InventoryRemoval)) == 0


@pytest.mark.parametrize("status", ["pending", "running"])
def test_active_scan_blocks_removal(db, inventory_client, status):
    scans = seed(db)
    scans[0].status = status
    db.commit()
    assert remove(inventory_client, "/api/inventory/sessions/scan-0").status_code == 409
    assert remove(inventory_client, "/api/inventory/sessions/scan-0/items/0").status_code == 409


def test_requires_confirmation_csrf_idempotency_and_exact_target(db, inventory_client):
    seed(db)
    client = inventory_client
    path = "/api/inventory/sessions/scan-0"
    assert remove(client, path, {"confirmed": False}).status_code == 422
    assert remove(client, path, {}).status_code == 422
    assert remove(client, "/api/inventory/sessions/missing").status_code == 404
    assert remove(client, path + "/items/missing").status_code == 404
    del client.headers["Idempotency-Key"]
    assert remove(client, path).status_code == 400
    del client.headers["X-CSRF-Token"]
    assert remove(client, path).status_code == 403
    assert db.scalar(select(func.count()).select_from(InventoryRemoval)) == 0
