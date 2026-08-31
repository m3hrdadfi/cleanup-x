from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import or_, select

from .database import SessionLocal
from .inventory import visible_results
from .llm import LLMClient, cache_key
from .models import (
    AuditEvent,
    Classification,
    DeletionItem,
    DeletionJob,
    Post,
    RepostResolutionJob,
    Scan,
)
from .schemas import ClassificationOutput, CompiledPolicy
from .services import audit, get_llm_settings
from .x_client import XAuthError, XRateLimitError, delete_post, resolve_repost_sources

_tasks: dict[str, asyncio.Task[None]] = {}


def _track(job_id: str, coroutine) -> None:  # type: ignore[no-untyped-def]
    current = _tasks.get(job_id)
    if current and not current.done():
        return
    task = asyncio.create_task(coroutine)
    _tasks[job_id] = task
    task.add_done_callback(lambda _task: _tasks.pop(job_id, None))


def schedule_scan(scan_id: str) -> None:
    _track(scan_id, run_scan(scan_id))


def schedule_deletion(job_id: str) -> None:
    _track(job_id, run_deletion(job_id))


def schedule_repost_resolution(job_id: str) -> None:
    _track(job_id, run_repost_resolution(job_id))


def _post_payload(post: Post) -> dict[str, Any]:
    media_urls: list[str] = []
    try:
        media = json.loads(post.media_json)
        for item in media if isinstance(media, list) else []:
            if isinstance(item, dict):
                url = (
                    item.get("url") or item.get("media_url_https") or item.get("preview_image_url")
                )
                media_type = item.get("type", "photo")
                if url and media_type in ("photo", "image"):
                    media_urls.append(str(url))
    except json.JSONDecodeError:
        pass
    return {
        "post_id": post.id,
        "content_type": post.content_type,
        "language_hint": post.language,
        "text": post.source_text or post.text,
        "context_text": post.text if post.source_text else None,
        "media_urls": media_urls[:2],
    }


def _save_result(db, scan: Scan, post: Post, output: ClassificationOutput, key: str) -> None:  # type: ignore[no-untyped-def]
    classification = Classification(
        scan_id=scan.id,
        post_id=post.id,
        matches=output.matches,
        confidence=output.confidence,
        detected_language=output.detected_language,
        topics_json=json.dumps(output.topics, ensure_ascii=False),
        reason_en=output.reason_en,
        reason_fa=output.reason_fa,
        selected=output.matches and output.confidence >= scan.threshold,
        status="classified",
        cache_key=key,
    )
    db.add(classification)


async def run_scan(scan_id: str) -> None:
    with SessionLocal() as db:
        scan = db.get(Scan, scan_id)
        if not scan or scan.status in ("completed", "cancelled"):
            return
        scan.status = "running"
        db.commit()
        try:
            content_types = json.loads(scan.content_types_json)
            languages = json.loads(scan.languages_json)
            query = select(Post).where(
                Post.deleted_at.is_(None), Post.content_type.in_(content_types)
            )
            if languages:
                query = query.where(or_(Post.language.in_(languages), Post.language.is_(None)))
            if scan.start_date:
                query = query.where(Post.posted_at >= scan.start_date)
            if scan.end_date:
                query = query.where(Post.posted_at <= scan.end_date)
            query = query.order_by(Post.posted_at.desc())
            if scan.max_posts > 0:
                query = query.limit(scan.max_posts)
            posts = list(db.scalars(query).all())
            existing_ids = set(
                db.scalars(select(Classification.post_id).where(Classification.scan_id == scan.id))
            )
            posts = [post for post in posts if post.id not in existing_ids]
            scan.total = len(posts) + len(existing_ids)
            scan.processed = len(existing_ids)
            db.commit()
            settings = get_llm_settings(db)
            client = LLMClient(settings)
            policy = CompiledPolicy.model_validate_json(scan.policy_json)
            for offset in range(0, len(posts), settings.batch_size):
                db.refresh(scan)
                if scan.status == "cancelled":
                    return
                batch_posts = posts[offset : offset + settings.batch_size]
                uncached: list[Post] = []
                keys: dict[str, str] = {}
                for post in batch_posts:
                    key = cache_key(post.source_text or post.text, policy, settings)
                    keys[post.id] = key
                    cached = db.scalar(
                        select(Classification)
                        .where(Classification.cache_key == key, Classification.post_id == post.id)
                        .order_by(Classification.created_at.desc())
                    )
                    if cached:
                        _save_result(
                            db,
                            scan,
                            post,
                            ClassificationOutput(
                                post_id=post.id,
                                matches=cached.matches,
                                confidence=cached.confidence,
                                detected_language=cached.detected_language,
                                topics=json.loads(cached.topics_json),
                                reason_en=cached.reason_en,
                                reason_fa=cached.reason_fa,
                            ),
                            key,
                        )
                    else:
                        uncached.append(post)
                if uncached:
                    try:
                        response = await client.classify(
                            policy, [_post_payload(p) for p in uncached]
                        )
                        db.refresh(scan)
                        if scan.status == "cancelled":
                            return
                        outputs = {item.post_id: item for item in response.results}
                        for post in uncached:
                            _save_result(db, scan, post, outputs[post.id], keys[post.id])
                    # A provider can fail through transport, parsing, or schema validation;
                    # every affected item must remain explicitly non-deletable.
                    except Exception as exc:  # noqa: BLE001
                        for post in uncached:
                            db.add(
                                Classification(
                                    scan_id=scan.id,
                                    post_id=post.id,
                                    matches=False,
                                    confidence=0,
                                    detected_language=post.language or "unknown",
                                    topics_json="[]",
                                    reason_en=f"Classification failed: {str(exc)[:300]}",
                                    reason_fa="طبقه بندی ناموفق بود.",
                                    selected=False,
                                    status="failed",
                                    cache_key=keys[post.id],
                                )
                            )
                    scan.processed += len(batch_posts)
                    db.commit()
                else:
                    scan.processed += len(batch_posts)
                    db.commit()
            db.refresh(scan)
            if scan.status == "cancelled":
                return
            scan.status = "completed"
            audit(db, "scan.completed", "scan", scan.id, {"total": scan.total})
        # The persisted job boundary records any unexpected terminal failure.
        except Exception as exc:  # noqa: BLE001
            scan.status = "failed"
            scan.error = str(exc)[:1000]
            db.commit()
            audit(db, "scan.failed", "scan", scan.id, {"error": scan.error})


def build_manifest(db, scan_id: str) -> tuple[str, str, list[Classification]]:  # type: ignore[no-untyped-def]
    rows = list(
        db.scalars(
            select(Classification)
            .where(Classification.scan_id == scan_id, Classification.selected.is_(True), visible_results())
            .order_by(Classification.post_id)
        ).all()
    )
    payload = {
        "version": 1,
        "scan_id": scan_id,
        "created_at": datetime.now(UTC).isoformat(),
        "items": [
            {
                "post_id": row.post_id,
                "confidence": row.confidence,
                "reason_en": row.reason_en,
                "reason_fa": row.reason_fa,
            }
            for row in rows
        ],
    }
    manifest = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return manifest, hashlib.sha256(manifest.encode()).hexdigest(), rows


async def run_deletion(job_id: str) -> None:
    with SessionLocal() as db:
        job = db.get(DeletionJob, job_id)
        if not job or job.status in ("completed", "cancelled"):
            return
        if job.resume_at:
            resume = job.resume_at
            if resume.tzinfo is None:
                resume = resume.replace(tzinfo=UTC)
            delay = (resume - datetime.now(UTC)).total_seconds()
            if delay > 0:
                job.status = "rate_limited"
                db.commit()
                await asyncio.sleep(delay)
        job.status = "running"
        job.resume_at = None
        db.commit()
        calls_in_window = 0
        items = list(
            db.scalars(
                select(DeletionItem)
                .where(DeletionItem.job_id == job.id, DeletionItem.status == "pending")
                .order_by(DeletionItem.created_at)
            ).all()
        )
        for item in items:
            db.refresh(job)
            if job.status in ("paused", "cancelled"):
                return
            if calls_in_window >= 50:
                job.status = "rate_limited"
                job.resume_at = datetime.now(UTC).replace(microsecond=0) + timedelta(minutes=15)
                db.commit()
                await asyncio.sleep(900)
                calls_in_window = 0
                job.status = "running"
                job.resume_at = None
                db.commit()
            post = db.get(Post, item.post_id)
            if not post:
                item.status = "failed"
                item.error = "Local post record is missing"
                job.failed += 1
                job.processed += 1
                db.commit()
                continue
            while True:
                item.attempts += 1
                try:
                    result = await delete_post(db, post)
                except XAuthError as exc:
                    job.status = "reauth_required"
                    job.error = str(exc)
                    db.commit()
                    return
                calls_in_window += 1
                if result.outcome != "rate_limited":
                    break
                item.attempts -= 1
                job.status = "rate_limited"
                job.resume_at = result.resume_at
                db.commit()
                resume = result.resume_at or datetime.now(UTC) + timedelta(minutes=15)
                await asyncio.sleep(max(1, (resume - datetime.now(UTC)).total_seconds()))
                calls_in_window = 0
                job.status = "running"
                job.resume_at = None
                db.commit()
            if result.outcome in ("deleted", "already_absent"):
                item.status = result.outcome
                post.deleted_at = datetime.now(UTC)
                post.accessible = False
                job.succeeded += 1
                job.processed += 1
            elif result.outcome == "reauth_required":
                item.attempts -= 1
                job.status = "reauth_required"
                job.error = result.error
                db.commit()
                return
            else:
                item.status = result.outcome
                item.error = result.error
                job.failed += 1
                job.processed += 1
            db.add(
                AuditEvent(
                    event_type=f"deletion.item.{item.status}",
                    entity_type="post",
                    entity_id=post.id,
                    details_json=json.dumps({"job_id": job.id, "attempts": item.attempts}),
                )
            )
            db.commit()
        job.status = "completed"
        db.commit()
        audit(
            db,
            "deletion.completed",
            "deletion_job",
            job.id,
            {"total": job.total, "succeeded": job.succeeded, "failed": job.failed},
        )


async def run_repost_resolution(job_id: str) -> None:
    with SessionLocal() as db:
        job = db.get(RepostResolutionJob, job_id)
        if not job or job.status == "completed":
            return
        job.status = "running"
        job.resume_at = None
        db.commit()
        try:
            posts = list(
                db.scalars(
                    select(Post)
                    .join(DeletionItem, DeletionItem.post_id == Post.id)
                    .where(
                        DeletionItem.job_id == job.deletion_job_id,
                        DeletionItem.status == "unresolved",
                        Post.content_type == "repost",
                        Post.source_post_id.is_(None),
                        Post.deleted_at.is_(None),
                    )
                    .order_by(Post.id)
                ).all()
            )
            job.total = len(posts)
            db.commit()
            for offset in range(0, len(posts), 100):
                batch = posts[offset : offset + 100]
                while True:
                    try:
                        resolved = await resolve_repost_sources(db, [post.id for post in batch])
                        break
                    except XRateLimitError as exc:
                        job.status = "rate_limited"
                        job.resume_at = exc.resume_at
                        db.commit()
                        await asyncio.sleep(
                            max(1, (exc.resume_at - datetime.now(UTC)).total_seconds())
                        )
                        job.status = "running"
                        job.resume_at = None
                        db.commit()
                for post in batch:
                    source_id = resolved.get(post.id)
                    if source_id:
                        post.source_post_id = source_id
                        job.resolved += 1
                    else:
                        job.failed += 1
                    job.processed += 1
                db.commit()
            job.status = "completed"
            db.commit()
            audit(
                db,
                "repost_resolution.completed",
                "repost_resolution_job",
                job.id,
                {"total": job.total, "resolved": job.resolved, "failed": job.failed},
            )
        except XAuthError as exc:
            job.status = "reauth_required"
            job.error = str(exc)
            db.commit()
        except Exception as exc:  # noqa: BLE001
            job.status = "failed"
            job.error = str(exc)[:1000]
            db.commit()
            audit(
                db,
                "repost_resolution.failed",
                "repost_resolution_job",
                job.id,
                {"error": job.error},
            )


def resume_incomplete_jobs() -> None:
    with SessionLocal() as db:
        for scan_id in db.scalars(select(Scan.id).where(Scan.status.in_(["pending", "running"]))):
            schedule_scan(scan_id)
        for job_id in db.scalars(
            select(DeletionJob.id).where(
                DeletionJob.status.in_(["pending", "running", "rate_limited"])
            )
        ):
            schedule_deletion(job_id)
        for job_id in db.scalars(
            select(RepostResolutionJob.id).where(
                RepostResolutionJob.status.in_(["pending", "running", "rate_limited"])
            )
        ):
            schedule_repost_resolution(job_id)
