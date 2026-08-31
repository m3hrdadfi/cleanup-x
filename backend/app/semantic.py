"""Local archive retrieval. This module never calls X or changes scan selections."""

import asyncio
import hashlib
import json
import re
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import SessionLocal, get_db
from .embeddings import (
    EmbeddingClient,
    EmbeddingError,
    EmbeddingReset,
    EmbeddingSettings,
    effective_draft,
    embedding_settings,
    normalize_vector,
    profile,
    public_settings,
    save_settings,
    test_provider,
    tested_dimensions,
)
from .models import EmbeddingJob, Post, PostEmbedding
from .security import require_csrf
from .services import audit


async def mutation_csrf(request: Request):
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        await require_csrf(request)


router = APIRouter(prefix="/api", dependencies=[Depends(mutation_csrf)])
Db = Annotated[Session, Depends(get_db)]
_tasks: dict[str, asyncio.Task] = {}


def corpus(db: Session) -> dict[str, tuple[Post, str, str]]:
    posts = list(db.scalars(select(Post).where(Post.deleted_at.is_(None))))
    by_id = {post.id: post for post in posts}
    result = {}
    for post in posts:
        parts = [post.text, post.source_text or ""]
        quoted = by_id.get(post.quoted_post_id)
        if quoted:
            parts.append(quoted.text)
        content = "\n\n".join(dict.fromkeys(part.strip() for part in parts if part.strip()))
        if content:
            result[post.id] = (post, content, hashlib.sha256(content.encode()).hexdigest())
    return result


def fresh_vectors(db: Session, data: dict, fingerprint: str, dimensions: int | None) -> dict:
    result = {}
    for row in db.scalars(select(PostEmbedding).where(PostEmbedding.profile == fingerprint)):
        if row.post_id not in data or data[row.post_id][2] != row.content_hash:
            continue
        try:
            result[row.post_id] = normalize_vector(json.loads(row.vector_json), dimensions)
        except (ValueError, EmbeddingError):
            continue
    return result


def job_out(job: EmbeddingJob) -> dict:
    return {key: getattr(job, key) for key in ("id", "status", "total", "processed", "indexed", "skipped", "error")}


@router.get("/settings/embedding")
def get_embedding(db: Db):
    return public_settings(db)


@router.put("/settings/embedding")
def put_embedding(body: EmbeddingSettings, db: Db):
    return save_settings(db, body)


@router.post("/settings/embedding/reset")
def reset_embedding(body: EmbeddingReset, db: Db):
    return save_settings(db, reset=body.fields)


@router.post("/settings/embedding/test")
async def test_embedding(body: EmbeddingSettings, db: Db):
    try:
        return await test_provider(db, body)
    except EmbeddingError as exc:
        raise HTTPException(502, str(exc)) from exc


@router.post("/settings/embedding/models")
async def embedding_models(body: EmbeddingSettings, db: Db):
    try:
        return {"models": await EmbeddingClient(effective_draft(db, body)).models()}
    except EmbeddingError as exc:
        raise HTTPException(502, str(exc)) from exc


@router.get("/search/index")
def index_status(db: Db):
    settings = embedding_settings(db)
    public = public_settings(db)
    data = corpus(db)
    indexed = len(fresh_vectors(db, data, profile(settings), public["dimensions"]))
    latest = db.scalar(select(EmbeddingJob).order_by(EmbeddingJob.created_at.desc()).limit(1))
    return {"eligible": len(data), "indexed": indexed, "pending": len(data) - indexed,
            "ready": public["tested"], "model": settings.model, "base_url": settings.base_url,
            "job": job_out(latest) if latest else None}


class IndexRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirmed: Literal[True]


@router.post("/search/index")
async def start_index(body: IndexRequest, db: Db, idempotency_key: Annotated[str, Header(min_length=1, max_length=128)]):
    existing = db.scalar(select(EmbeddingJob).where(EmbeddingJob.request_key == idempotency_key))
    if existing:
        return job_out(existing)
    if db.scalar(select(EmbeddingJob.id).where(EmbeddingJob.status.in_(["pending", "running", "paused"])).limit(1)):
        raise HTTPException(409, "Resume or cancel the existing index job first")
    settings = embedding_settings(db)
    dimensions = tested_dimensions(db, settings)
    data = corpus(db)
    vectors = fresh_vectors(db, data, profile(settings), dimensions)
    items = [{"id": key, "hash": value[2]} for key, value in sorted(data.items()) if key not in vectors]
    job = EmbeddingJob(request_key=idempotency_key, profile=profile(settings), items_json=json.dumps(items), total=len(items))
    db.add(job)
    db.commit()
    audit(db, "embedding.index.started", "embedding_job", job.id, {"total": len(items)})
    schedule(job.id)
    return job_out(job)


@router.post("/search/index/{job_id}/{action}")
async def control_index(job_id: str, action: Literal["pause", "resume", "cancel"], db: Db):
    job = db.get(EmbeddingJob, job_id)
    if not job:
        raise HTTPException(404, "Index job not found")
    if job.status in ("completed", "cancelled"):
        return job_out(job)
    if action == "resume":
        settings = embedding_settings(db)
        tested_dimensions(db, settings)
        if job.profile != profile(settings):
            raise HTTPException(409, "Provider changed. Cancel this job and build the current index")
        job.status, job.error = "pending", None
    else:
        job.status = "paused" if action == "pause" else "cancelled"
    db.commit()
    audit(db, f"embedding.index.{action}", "embedding_job", job.id, {})
    if action == "resume":
        schedule(job.id)
    return job_out(job)


def schedule(job_id: str):
    if job_id not in _tasks:
        task = asyncio.create_task(run_index(job_id))
        _tasks[job_id] = task

        def finished(completed):
            _tasks.pop(job_id, None)
            if not completed.cancelled():
                with SessionLocal() as db:
                    job = db.get(EmbeddingJob, job_id)
                    if job and job.status == "pending":
                        schedule(job_id)

        task.add_done_callback(finished)


def resume_indexes():
    with SessionLocal() as db:
        for job_id in db.scalars(select(EmbeddingJob.id).where(EmbeddingJob.status.in_(["pending", "running"]))):
            schedule(job_id)


async def stop_indexes():
    tasks = list(_tasks.values())
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


async def run_index(job_id: str):
    try:
        while True:
            with SessionLocal() as db:
                job = db.get(EmbeddingJob, job_id)
                if not job or job.status not in ("pending", "running"):
                    return
                settings = embedding_settings(db)
                dimensions = tested_dimensions(db, settings)
                if job.profile != profile(settings):
                    raise EmbeddingError("Provider changed; cancel this job and rebuild")
                job.status = "running"
                db.commit()
                items = json.loads(job.items_json)[job.processed:job.processed + settings.batch_size]
                if not items:
                    job.status = "completed"
                    db.commit()
                    audit(db, "embedding.index.completed", "embedding_job", job.id, {"indexed": job.indexed, "skipped": job.skipped})
                    return
                data = corpus(db)
                valid = [item for item in items if item["id"] in data and data[item["id"]][2] == item["hash"]]
                texts = [settings.document_prefix + data[item["id"]][1] for item in valid]
            vectors = await EmbeddingClient(settings).embed(texts, dimensions) if texts else []
            with SessionLocal() as db:
                job = db.get(EmbeddingJob, job_id)
                # In-flight requests may finish after pause/cancel. Do not advance their checkpoint.
                if not job or job.status not in ("pending", "running"):
                    return
                data = corpus(db)
                indexed = 0
                for item, vector in zip(valid, vectors, strict=True):
                    if item["id"] not in data or data[item["id"]][2] != item["hash"]:
                        continue
                    row = db.get(PostEmbedding, (job.profile, item["id"]))
                    if not row:
                        row = PostEmbedding(profile=job.profile, post_id=item["id"], content_hash=item["hash"], vector_json="[]")
                        db.add(row)
                    row.content_hash, row.vector_json = item["hash"], json.dumps(vector)
                    indexed += 1
                job.processed += len(items)
                job.indexed += indexed
                job.skipped += len(items) - indexed
                db.commit()  # Vectors and checkpoint are atomic.
            await asyncio.sleep(0)
    except (EmbeddingError, HTTPException) as exc:
        with SessionLocal() as db:
            job = db.get(EmbeddingJob, job_id)
            if job and job.status in ("pending", "running"):
                job.status, job.error = "paused", str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
                db.commit()
    except Exception:  # noqa: BLE001 -- Persist a safe failure without leaking provider payloads.
        # Never expose provider payloads or credentials in operational logs.
        with SessionLocal() as db:
            job = db.get(EmbeddingJob, job_id)
            if job and job.status in ("pending", "running"):
                job.status, job.error = "paused", "Indexing stopped unexpectedly; retry or check local storage"
                db.commit()


class SearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: str = Field(min_length=1, max_length=2000)
    mode: Literal["semantic", "hybrid", "keyword"] = "hybrid"
    limit: int = Field(default=25, ge=1, le=100)
    content_type: Literal["post", "reply", "quote", "repost"] | None = None
    language: str | None = Field(default=None, max_length=20)
    date_from: date | None = None
    date_to: date | None = None

    @model_validator(mode="after")
    def validate_request(self):
        if not self.query.strip():
            raise ValueError("Enter a search query")
        if self.date_from and self.date_to and self.date_from > self.date_to:
            raise ValueError("Start date must not be after end date")
        return self


@router.post("/search")
async def search(body: SearchRequest, db: Db):
    data = corpus(db)
    data = {key: value for key, value in data.items() if
            (not body.content_type or value[0].content_type == body.content_type)
            and (not body.language or value[0].language == body.language)
            and (not body.date_from or value[0].posted_at and value[0].posted_at.date() >= body.date_from)
            and (not body.date_to or value[0].posted_at and value[0].posted_at.date() <= body.date_to)}
    tokens = set(re.findall(r"\w+", body.query.casefold()))
    keywords = {key: len(tokens.intersection(re.findall(r"\w+", value[1].casefold()))) / max(len(tokens), 1) for key, value in data.items()}
    similarities = {}
    if body.mode != "keyword":
        settings = embedding_settings(db)
        dimensions = tested_dimensions(db, settings)
        vectors = fresh_vectors(db, data, profile(settings), dimensions)
        if vectors:
            db.rollback()  # Do not hold a database snapshot across the provider request.
            try:
                query = (await EmbeddingClient(settings).embed([settings.query_prefix + body.query], dimensions))[0]
            except EmbeddingError as exc:
                raise HTTPException(502, str(exc)) from exc
            current = corpus(db)
            data = {key: value for key, value in data.items() if key in current and current[key][2] == value[2]}
            keywords = {key: value for key, value in keywords.items() if key in data}
            vectors = {key: value for key, value in vectors.items() if key in data}
            similarities = {key: max(-1., min(1., sum(a * b for a, b in zip(query, vector, strict=True)))) for key, vector in vectors.items()}
    keyword_order = sorted((key for key in keywords if keywords[key] > 0), key=lambda key: (-keywords[key], key))
    semantic_order = sorted(similarities, key=lambda key: (-similarities[key], key))
    if body.mode == "keyword":
        ranked = keyword_order
    elif body.mode == "semantic":
        ranked = semantic_order
    else:
        # Reciprocal rank fusion: keyword-only posts can appear even before indexing.
        scores: dict[str, float] = {}
        for order in (keyword_order, semantic_order):
            for rank, key in enumerate(order, 1):
                scores[key] = scores.get(key, 0) + 1 / (60 + rank)
        ranked = sorted(scores, key=lambda key: (-scores[key], key))
    return {"mode": body.mode, "candidates": len(data), "indexed_candidates": len(similarities), "total": len(ranked),
            "items": [{"id": key, "text": data[key][0].text, "context": data[key][1], "language": data[key][0].language,
                       "content_type": data[key][0].content_type, "posted_at": data[key][0].posted_at,
                       "similarity": similarities.get(key)} for key in ranked[:body.limit]]}
