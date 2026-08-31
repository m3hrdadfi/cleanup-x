from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import json
import secrets
import tempfile
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any

import httpx
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response, StreamingResponse
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session, joinedload

from .analytics import build_archive_overview
from .archive import ArchiveError, import_x_archive
from .config import get_settings
from .configuration import configuration_snapshot
from .database import Base, SessionLocal, engine, get_db
from .inventory import visible_results, visible_scans
from .jobs import (
    build_manifest,
    resume_incomplete_jobs,
    schedule_deletion,
    schedule_repost_resolution,
    schedule_scan,
)
from .llm import LLMClient, compile_policy
from .models import (
    AuditEvent,
    Classification,
    DeletionItem,
    DeletionJob,
    IdempotencyRecord,
    ImportJob,
    InventoryRemoval,
    OAuthState,
    Post,
    RepostResolutionJob,
    Scan,
    XConnection,
)
from .schemas import (
    AppRuntimeSettings,
    AppSettingsReset,
    DeletionCreate,
    DeletionOut,
    DeletionRetry,
    LLMSettings,
    LLMSettingsReset,
    LLMSettingsUpdate,
    LocalInventoryRemoval,
    PolicyRequest,
    PostOut,
    RepostResolutionCreate,
    ScanCreate,
    ScanOut,
    SelectionUpdate,
    XStatus,
)
from .security import (
    create_pkce,
    decrypt,
    encrypt,
    new_csrf_token,
    oauth_authorize_url,
    require_csrf,
)
from .semantic import resume_indexes, stop_indexes
from .semantic import router as semantic_router
from .services import (
    audit,
    get_app_runtime_settings,
    get_llm_settings,
    masked_llm_settings,
    reset_app_settings,
    reset_llm_settings_fields,
    save_app_runtime_settings,
    save_llm_settings,
)
from .x_client import XAuthError, connect_identity, exchange_code, sync_posts
from .x_settings import (
    XSettingsReset,
    XSettingsUpdate,
    get_x_settings,
    masked_x_settings,
    reset_x_settings,
    save_x_settings,
    x_configuration_lock,
)

Db = Annotated[Session, Depends(get_db)]
Csrf = Annotated[None, Depends(require_csrf)]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(engine)
    if not get_settings().demo_mode:
        resume_incomplete_jobs()
    resume_indexes()
    try:
        yield
    finally:
        await stop_indexes()


app = FastAPI(title="Cleanup X API", version="0.1.0", lifespan=lifespan)
app.include_router(semantic_router)
settings = get_settings()


@app.exception_handler(RequestValidationError)
async def safe_credentials_validation(request: Request, exc: RequestValidationError):
    if request.url.path in ("/api/settings/x", "/api/settings/x/reset") or request.url.path.startswith("/api/settings/embedding"):
        # Do not reflect submitted credentials in validation errors (including
        # misspelled/extra keys or an invalid callback containing a password).
        return JSONResponse(status_code=422, content={"detail": [
            {key: error[key] for key in ("loc", "type", "msg")} for error in exc.errors()
        ]})
    return await request_validation_exception_handler(request, exc)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def csrf_cookie(request: Request, call_next):  # type: ignore[no-untyped-def]
    response = await call_next(request)
    if not request.cookies.get("cleanup_csrf"):
        response.set_cookie(
            "cleanup_csrf",
            new_csrf_token(),
            httponly=False,
            secure=False,
            samesite="strict",
            max_age=60 * 60 * 24 * 30,
        )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    return response


def _idempotent(db: Session, endpoint: str, key: str | None) -> dict[str, Any] | None:
    if not key:
        raise HTTPException(status_code=400, detail="Idempotency-Key header is required")
    record = db.scalar(
        select(IdempotencyRecord).where(
            IdempotencyRecord.endpoint == endpoint, IdempotencyRecord.key == key
        )
    )
    return json.loads(record.response_json) if record else None


def _remember(db: Session, endpoint: str, key: str, payload: dict[str, Any]) -> None:
    db.add(IdempotencyRecord(endpoint=endpoint, key=key, response_json=json.dumps(payload)))
    db.commit()


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "cleanup-x",
        "version": app.version,
        "demo_mode": get_settings().demo_mode,
    }


def require_live_x() -> None:
    """Prevent every route that can contact or mutate X while serving demo data."""
    if get_settings().demo_mode:
        raise HTTPException(
            status_code=409,
            detail="X connections and writes are disabled while APP_DEMO_MODE is enabled",
        )


@app.get("/api/auth/x/status", response_model=XStatus)
def x_status(db: Db) -> XStatus:
    connection = db.scalar(select(XConnection).order_by(XConnection.created_at.desc()))
    return XStatus(
        configured=bool(get_x_settings(db).x_client_id),
        connected=connection is not None,
        user_id=connection.x_user_id if connection else None,
        username=connection.username if connection else None,
        name=connection.name if connection else None,
    )


@app.post(
    "/api/auth/x/start",
    dependencies=[Depends(require_csrf), Depends(x_configuration_lock), Depends(require_live_x)],
)
def x_auth_start(db: Db) -> dict[str, str]:
    credentials = get_x_settings(db)
    if not credentials.x_client_id:
        raise HTTPException(status_code=400, detail="APP_X_CLIENT_ID is not configured")
    verifier, challenge = create_pkce()
    state = secrets.token_urlsafe(32)
    db.add(OAuthState(state=state, verifier_encrypted=encrypt(verifier)))
    db.commit()
    return {"authorize_url": oauth_authorize_url(state, challenge, credentials)}


@app.get(
    "/api/auth/x/callback",
    dependencies=[Depends(x_configuration_lock), Depends(require_live_x)],
)
async def x_auth_callback(code: str, state: str, db: Db) -> RedirectResponse:
    saved = db.get(OAuthState, state)
    saved_at = (
        saved.created_at.replace(tzinfo=UTC)
        if saved and saved.created_at.tzinfo is None
        else (saved.created_at if saved else None)
    )
    if (
        not saved
        or saved.consumed
        or not saved_at
        or saved_at < datetime.now(UTC) - timedelta(minutes=10)
    ):
        raise HTTPException(status_code=400, detail="OAuth state is missing or expired")
    try:
        token = await exchange_code(code, decrypt(saved.verifier_encrypted), get_x_settings(db))
        connection = await connect_identity(db, token)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not connect X account: {exc}") from exc
    saved.consumed = True
    db.commit()
    audit(db, "x.connected", "x_account", connection.x_user_id, {"username": connection.username})
    return RedirectResponse(f"{settings.frontend_url}/settings?x=connected#settings-connections")


@app.post("/api/auth/x/disconnect", dependencies=[Depends(require_csrf), Depends(x_configuration_lock)])
def x_disconnect(db: Db) -> dict[str, bool]:
    connections = list(db.scalars(select(XConnection)).all())
    for connection in connections:
        db.delete(connection)
    db.commit()
    audit(db, "x.disconnected", "x_account", None, {})
    return {"disconnected": True}


@app.post("/api/imports/x-archive", dependencies=[Depends(require_csrf)])
async def upload_archive(file: Annotated[UploadFile, File()], db: Db) -> dict[str, Any]:
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Upload the original X archive ZIP file")
    job = ImportJob(filename=Path(file.filename).name)
    db.add(job)
    db.commit()
    db.refresh(job)
    max_bytes = get_app_runtime_settings(db).max_archive_mb * 1024 * 1024
    written = 0
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as temp:
            temp_path = Path(temp.name)
            while chunk := await file.read(1024 * 1024):
                written += len(chunk)
                if written > max_bytes:
                    raise ArchiveError("Archive exceeds the configured upload size limit")
                temp.write(chunk)
        report = import_x_archive(temp_path, db).as_dict()
        job.status = "completed"
        job.report_json = json.dumps(report)
        db.commit()
        audit(db, "archive.imported", "import", job.id, report)
        return {"id": job.id, "status": job.status, "report": report}
    except ArchiveError as exc:
        job.status = "failed"
        job.error = str(exc)
        db.commit()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        if temp_path:
            temp_path.unlink(missing_ok=True)


@app.get("/api/imports/{import_id}")
def get_import(import_id: str, db: Db) -> dict[str, Any]:
    job = db.get(ImportJob, import_id)
    if not job:
        raise HTTPException(status_code=404, detail="Import not found")
    return {
        "id": job.id,
        "filename": job.filename,
        "status": job.status,
        "report": json.loads(job.report_json),
        "error": job.error,
    }


@app.post("/api/sync/x", dependencies=[Depends(require_csrf), Depends(require_live_x)])
async def sync_x(db: Db) -> dict[str, Any]:
    estimated_max = 3200 * get_app_runtime_settings(db).owned_read_unit_cost_usd
    if estimated_max > get_app_runtime_settings(db).api_budget_usd:
        raise HTTPException(
            status_code=409, detail="Configured API budget is below the maximum sync estimate"
        )
    try:
        report = await sync_posts(db)
    except XAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    audit(db, "x.synced", "x_account", None, report)
    return {**report, "estimated_max_cost_usd": estimated_max}


@app.get("/api/posts")
def list_posts(
    db: Db,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    search: str = Query(default="", max_length=200),
    content_type: str | None = None,
    origin: str | None = None,
    scan_id: str | None = None,
    scan_result: str | None = Query(
        default=None, pattern="^(match|non_match|selected|failed)$"
    ),
) -> dict[str, Any]:
    filters = [Post.deleted_at.is_(None)]
    active_scan = None
    if scan_id:
        active_scan = db.get(Scan, scan_id)
        if not active_scan or db.get(InventoryRemoval, f"session:{scan_id}"):
            raise HTTPException(status_code=404, detail="Scan not found")
        classification_posts = select(Classification.post_id).where(
            Classification.scan_id == scan_id, visible_results()
        )
        if scan_result == "match":
            classification_posts = classification_posts.where(
                Classification.matches.is_(True)
            )
        elif scan_result == "non_match":
            classification_posts = classification_posts.where(
                Classification.matches.is_(False),
                Classification.status == "classified",
            )
        elif scan_result == "selected":
            classification_posts = classification_posts.where(
                Classification.selected.is_(True)
            )
        elif scan_result == "failed":
            classification_posts = classification_posts.where(
                Classification.status == "failed"
            )
        filters.append(Post.id.in_(classification_posts))
    if search:
        filters.append(or_(Post.text.ilike(f"%{search}%"), Post.source_text.ilike(f"%{search}%")))
    if content_type:
        filters.append(Post.content_type == content_type)
    if origin == "api":
        filters.append(Post.from_api.is_(True))
    elif origin == "archive":
        filters.append(Post.from_archive.is_(True))
    total = db.scalar(select(func.count()).select_from(Post).where(*filters)) or 0
    rows = list(
        db.scalars(
            select(Post)
            .where(*filters)
            .order_by(Post.posted_at.desc().nullslast())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    classifications: dict[str, Classification] = {}
    if scan_id and rows:
        classifications = {
            row.post_id: row
            for row in db.scalars(
                select(Classification).where(
                    Classification.scan_id == scan_id,
                    Classification.post_id.in_([post.id for post in rows]),
                )
            ).all()
        }
    coverage = {
        "live_api": db.scalar(select(func.count()).select_from(Post).where(Post.from_api.is_(True)))
        or 0,
        "archive": db.scalar(
            select(func.count()).select_from(Post).where(Post.from_archive.is_(True))
        )
        or 0,
        "archive_only": db.scalar(
            select(func.count())
            .select_from(Post)
            .where(Post.from_archive.is_(True), Post.from_api.is_(False))
        )
        or 0,
        "unresolved_reposts": db.scalar(
            select(func.count())
            .select_from(Post)
            .where(Post.content_type == "repost", Post.source_post_id.is_(None))
        )
        or 0,
    }
    return {
        "items": [
            {
                **PostOut.model_validate(row).model_dump(mode="json"),
                "classification": (
                    {
                        "matches": classifications[row.id].matches,
                        "confidence": classifications[row.id].confidence,
                        "detected_language": classifications[row.id].detected_language,
                        "reason_en": classifications[row.id].reason_en,
                        "selected": classifications[row.id].selected,
                        "status": classifications[row.id].status,
                    }
                    if row.id in classifications
                    else None
                ),
            }
            for row in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
        "coverage": coverage,
        "complete_history": coverage["archive"] > 0,
        "scan": (
            {
                **ScanOut.model_validate(active_scan).model_dump(mode="json"),
                "policy": json.loads(active_scan.policy_json),
            }
            if active_scan
            else None
        ),
    }


@app.get("/api/overview")
def archive_overview(db: Db) -> dict[str, Any]:
    return build_archive_overview(db)


@app.get("/api/posts/{post_id}", response_model=PostOut)
def get_post(post_id: str, db: Db) -> Post:
    post = db.get(Post, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    return post


@app.get("/api/settings/llm")
def llm_settings(db: Db) -> dict[str, Any]:
    return masked_llm_settings(db)


@app.put("/api/settings/llm", dependencies=[Depends(require_csrf)])
def update_llm_settings(payload: LLMSettingsUpdate, db: Db) -> dict[str, Any]:
    if payload.api_key == "********":
        payload.api_key = get_llm_settings(db).api_key
    settings_payload = LLMSettings.model_validate(payload.model_dump())
    save_llm_settings(db, settings_payload, set(payload.environment_fields))
    return masked_llm_settings(db)


@app.post("/api/settings/llm/reset", dependencies=[Depends(require_csrf)])
def reset_llm_settings(payload: LLMSettingsReset, db: Db) -> dict[str, Any]:
    reset_llm_settings_fields(db, payload.fields)
    return masked_llm_settings(db)


@app.post("/api/settings/llm/test", dependencies=[Depends(require_csrf)])
async def test_llm(db: Db, payload: LLMSettings | None = None) -> dict[str, Any]:
    active_settings = payload or get_llm_settings(db)
    if active_settings.api_key == "********":
        active_settings.api_key = get_llm_settings(db).api_key
    try:
        started = time.perf_counter()
        result = await LLMClient(active_settings).test()
        result["latency_ms"] = round((time.perf_counter() - started) * 1000)
        return result
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=502, detail="The provider timed out. The model may still be loading; check the configured timeout and try again.") from exc
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        hint = "Check your API key and permissions." if status in (401, 403) else "Check the base URL, model, and provider availability."
        raise HTTPException(status_code=502, detail=f"Provider returned HTTP {status}. {hint}") from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="Could not reach the provider. Check the base URL and network connection.") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/settings/llm/models", dependencies=[Depends(require_csrf)])
async def list_llm_models(payload: LLMSettings, db: Db) -> dict[str, Any]:
    if payload.api_key == "********":
        payload.api_key = get_llm_settings(db).api_key
    try:
        models = await LLMClient(payload).list_models()
        return {"models": models, "provider": payload.provider}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not load models: {exc}") from exc


@app.get("/api/settings/app")
def app_settings(db: Db) -> dict[str, Any]:
    runtime = get_app_runtime_settings(db)
    credentials = get_x_settings(db)
    return {
        **runtime.model_dump(),
        "x_credentials_configured": bool(credentials.x_client_id and credentials.x_client_secret),
        "encryption_source": "environment" if settings.encryption_key else "local_key_file",
    }


@app.get("/api/settings/configuration")
def configuration_settings(db: Db) -> dict[str, Any]:
    return configuration_snapshot(db)


@app.get("/api/settings/x")
def x_settings_status(db: Db) -> dict[str, Any]:
    return masked_x_settings(db)


@app.put("/api/settings/x", dependencies=[Depends(require_csrf), Depends(x_configuration_lock)])
def update_x_settings(payload: XSettingsUpdate, db: Db) -> dict[str, Any]:
    return save_x_settings(db, payload)


@app.post("/api/settings/x/reset", dependencies=[Depends(require_csrf), Depends(x_configuration_lock)])
def reset_x_oauth_settings(payload: XSettingsReset, db: Db) -> dict[str, Any]:
    return reset_x_settings(db, payload.fields)


@app.put("/api/settings/app", dependencies=[Depends(require_csrf)])
def update_app_settings(payload: AppRuntimeSettings, db: Db) -> dict[str, Any]:
    save_app_runtime_settings(db, payload)
    return app_settings(db)


@app.post("/api/settings/app/reset", dependencies=[Depends(require_csrf)])
def reset_runtime_settings(payload: AppSettingsReset, db: Db) -> dict[str, Any]:
    reset_app_settings(db, payload.fields)
    return app_settings(db)


@app.post("/api/scans/compile", dependencies=[Depends(require_csrf)])
def compile_scan(payload: PolicyRequest) -> dict[str, Any]:
    return compile_policy(payload).model_dump()


@app.post("/api/scans", response_model=ScanOut, dependencies=[Depends(require_csrf)])
async def create_scan(
    payload: ScanCreate,
    db: Db,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> Any:
    cached = _idempotent(db, "POST:/api/scans", idempotency_key)
    if cached:
        return cached
    active_scan = db.scalar(
        select(Scan)
        .where(Scan.status.in_(("pending", "running")))
        .order_by(Scan.created_at.desc())
    )
    if active_scan:
        raise HTTPException(
            status_code=409,
            detail=f"Scan {active_scan.id} is already {active_scan.status}. Finish or cancel it before starting another scan.",
        )
    policy = payload.policy or compile_policy(payload)
    scan = Scan(
        prompt=payload.prompt,
        policy_json=policy.model_dump_json(),
        threshold=payload.threshold,
        content_types_json=json.dumps(payload.content_types),
        languages_json=json.dumps(payload.languages),
        start_date=payload.start_date,
        end_date=payload.end_date,
        max_posts=payload.max_posts,
    )
    db.add(scan)
    db.commit()
    db.refresh(scan)
    response = ScanOut.model_validate(scan).model_dump(mode="json")
    _remember(db, "POST:/api/scans", idempotency_key or "", response)
    audit(
        db,
        "scan.created",
        "scan",
        scan.id,
        {"threshold": scan.threshold, "prompt": scan.prompt, "max_posts": scan.max_posts},
    )
    schedule_scan(scan.id)
    return response


@app.get("/api/scans")
def list_scans(
    db: Db,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
) -> dict[str, Any]:
    total = db.scalar(select(func.count()).select_from(Scan).where(visible_scans())) or 0
    rows = list(
        db.scalars(
            select(Scan)
            .where(visible_scans())
            .order_by(Scan.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    scan_ids = [row.id for row in rows]
    counts = {
        item.scan_id: {
            "matches": item.matches or 0,
            "selected": item.selected or 0,
            "failed": item.failed or 0,
        }
        for item in db.execute(
            select(
                Classification.scan_id,
                func.sum(case((Classification.matches.is_(True), 1), else_=0)).label(
                    "matches"
                ),
                func.sum(case((Classification.selected.is_(True), 1), else_=0)).label(
                    "selected"
                ),
                func.sum(case((Classification.status == "failed", 1), else_=0)).label(
                    "failed"
                ),
            )
            .where(Classification.scan_id.in_(scan_ids), visible_results())
            .group_by(Classification.scan_id)
        )
    } if scan_ids else {}
    return {
        "items": [
            {
                **ScanOut.model_validate(row).model_dump(mode="json"),
                "policy": json.loads(row.policy_json),
                "counts": counts.get(row.id, {"matches": 0, "selected": 0, "failed": 0}),
            }
            for row in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def _remove_inventory_entry(
    db: Session, scan_id: str, post_id: str | None, key: str | None
) -> dict[str, Any]:
    entry_id = f"item:{scan_id}:{post_id}" if post_id else f"session:{scan_id}"
    endpoint = f"DELETE:/api/inventory/{entry_id}"
    cached = _idempotent(db, endpoint, key)
    if cached:
        return cached
    scan = db.get(Scan, scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    response = {"scan_id": scan_id, "post_id": post_id, "removed": True, "local_only": True}
    if db.get(InventoryRemoval, entry_id):
        return response
    if scan.status in ("pending", "running") or db.scalar(
        select(DeletionJob.id).where(
            DeletionJob.scan_id == scan_id,
            DeletionJob.status.not_in(("completed", "cancelled", "failed")),
        ).limit(1)
    ):
        raise HTTPException(status_code=409, detail="Finish or cancel active jobs before removing inventory")
    results = select(Classification).where(Classification.scan_id == scan_id)
    if post_id:
        results = results.where(Classification.post_id == post_id)
    rows = list(db.scalars(results))
    if post_id and not rows:
        raise HTTPException(status_code=404, detail="Item not found in this session")
    for row in rows:
        row.selected = False
    db.add(InventoryRemoval(id=entry_id, scan_id=scan_id, post_id=post_id))
    db.add(AuditEvent(
        event_type="inventory.item.removed" if post_id else "inventory.session.removed",
        entity_type="scan",
        entity_id=scan_id,
        details_json=json.dumps({"post_id": post_id, "local_only": True}),
    ))
    # Visibility, deselection, audit, and idempotency receipt commit together.
    _remember(db, endpoint, key or "", response)
    return response


@app.delete("/api/inventory/sessions/{scan_id}", dependencies=[Depends(require_csrf)])
def remove_inventory_session(
    scan_id: str, payload: LocalInventoryRemoval, db: Db,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> dict[str, Any]:
    return _remove_inventory_entry(db, scan_id, None, idempotency_key)


@app.delete("/api/inventory/sessions/{scan_id}/items/{post_id}", dependencies=[Depends(require_csrf)])
def remove_inventory_item(
    scan_id: str, post_id: str, payload: LocalInventoryRemoval, db: Db,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> dict[str, Any]:
    return _remove_inventory_entry(db, scan_id, post_id, idempotency_key)


@app.post("/api/scans/{scan_id}/cancel", dependencies=[Depends(require_csrf)])
def cancel_scan(scan_id: str, db: Db) -> dict[str, str]:
    scan = db.get(Scan, scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    if scan.status not in ("pending", "running"):
        raise HTTPException(status_code=409, detail="Only an active scan can be cancelled")
    scan.status = "cancelled"
    db.commit()
    audit(db, "scan.cancelled", "scan", scan.id, {"processed": scan.processed})
    return {"id": scan.id, "status": scan.status}


@app.post(
    "/api/scans/{scan_id}/rerun",
    response_model=ScanOut,
    dependencies=[Depends(require_csrf)],
)
async def rerun_scan(
    scan_id: str,
    db: Db,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> Any:
    endpoint = f"POST:/api/scans/{scan_id}/rerun"
    cached = _idempotent(db, endpoint, idempotency_key)
    if cached:
        return cached
    active_scan = db.scalar(
        select(Scan)
        .where(Scan.status.in_(("pending", "running")))
        .order_by(Scan.created_at.desc())
    )
    if active_scan:
        raise HTTPException(
            status_code=409,
            detail=f"Scan {active_scan.id} is already {active_scan.status}. Finish or cancel it before starting another scan.",
        )
    source = db.get(Scan, scan_id)
    if not source or source.status != "completed":
        raise HTTPException(status_code=409, detail="Only a completed scan can be run again")
    scan = Scan(
        prompt=source.prompt,
        policy_json=source.policy_json,
        threshold=source.threshold,
        content_types_json=source.content_types_json,
        languages_json=source.languages_json,
        start_date=source.start_date,
        end_date=source.end_date,
        max_posts=source.max_posts,
    )
    db.add(scan)
    db.commit()
    db.refresh(scan)
    response = ScanOut.model_validate(scan).model_dump(mode="json")
    _remember(db, endpoint, idempotency_key or "", response)
    audit(db, "scan.rerun", "scan", scan.id, {"source_scan_id": source.id})
    schedule_scan(scan.id)
    return response


@app.get("/api/scans/{scan_id}")
def get_scan(scan_id: str, db: Db) -> dict[str, Any]:
    scan = db.get(Scan, scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    counts = dict(
        db.execute(
            select(Classification.status, func.count())
            .where(Classification.scan_id == scan.id, visible_results())
            .group_by(Classification.status)
        ).all()
    )
    selected = (
        db.scalar(
            select(func.count())
            .select_from(Classification)
            .where(Classification.scan_id == scan.id, Classification.selected.is_(True), visible_results())
        )
        or 0
    )
    match_counts = dict(
        db.execute(
            select(Classification.matches, func.count())
            .where(
                Classification.scan_id == scan.id,
                Classification.status == "classified",
                visible_results(),
            )
            .group_by(Classification.matches)
        ).all()
    )
    return {
        **ScanOut.model_validate(scan).model_dump(mode="json"),
        "policy": json.loads(scan.policy_json),
        "counts": {
            **counts,
            "selected": selected,
            "matches": match_counts.get(True, 0),
            "non_matches": match_counts.get(False, 0),
        },
    }


@app.get("/api/scans/{scan_id}/results")
def scan_results(
    scan_id: str,
    db: Db,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    selected: bool | None = None,
) -> dict[str, Any]:
    filters = [Classification.scan_id == scan_id, visible_results()]
    if selected is not None:
        filters.append(Classification.selected.is_(selected))
    total = db.scalar(select(func.count()).select_from(Classification).where(*filters)) or 0
    rows = list(
        db.scalars(
            select(Classification)
            .options(joinedload(Classification.post))
            .where(*filters)
            .order_by(Classification.confidence.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    return {
        "items": [
            {
                "id": row.id,
                "post_id": row.post_id,
                "text": row.post.source_text or row.post.text,
                "content_type": row.post.content_type,
                "posted_at": row.post.posted_at,
                "matches": row.matches,
                "confidence": row.confidence,
                "detected_language": row.detected_language,
                "topics": json.loads(row.topics_json),
                "reason_en": row.reason_en,
                "reason_fa": row.reason_fa,
                "selected": row.selected,
                "status": row.status,
            }
            for row in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@app.post("/api/scans/{scan_id}/selection", dependencies=[Depends(require_csrf)])
def update_selection(scan_id: str, payload: SelectionUpdate, db: Db) -> dict[str, int]:
    rows = list(
        db.scalars(
            select(Classification).where(
                Classification.scan_id == scan_id,
                Classification.post_id.in_(payload.post_ids),
                visible_results(),
            )
        ).all()
    )
    for row in rows:
        row.selected = payload.selected
    db.commit()
    audit(
        db,
        "scan.selection.updated",
        "scan",
        scan_id,
        {"count": len(rows), "selected": payload.selected},
    )
    return {"updated": len(rows)}


@app.post(
    "/api/deletion-jobs",
    response_model=DeletionOut,
    dependencies=[Depends(require_csrf), Depends(require_live_x)],
)
async def create_deletion(
    payload: DeletionCreate,
    db: Db,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> Any:
    cached = _idempotent(db, "POST:/api/deletion-jobs", idempotency_key)
    if cached:
        return cached
    scan = db.get(Scan, payload.scan_id)
    if not scan or scan.status != "completed":
        raise HTTPException(status_code=409, detail="The scan must be complete before deletion")
    manifest, digest, rows = build_manifest(db, scan.id)
    if not rows:
        raise HTTPException(status_code=409, detail="No posts are selected")
    if payload.confirmation_count != len(rows):
        raise HTTPException(status_code=400, detail=f"Type the exact selected count: {len(rows)}")
    estimate = len(rows) * get_app_runtime_settings(db).delete_unit_cost_usd
    if estimate > get_app_runtime_settings(db).api_budget_usd:
        raise HTTPException(
            status_code=409, detail="Deletion estimate exceeds the configured API budget"
        )
    job = DeletionJob(
        scan_id=scan.id,
        manifest_json=manifest,
        manifest_sha256=digest,
        total=len(rows),
    )
    db.add(job)
    db.flush()
    for row in rows:
        db.add(DeletionItem(job_id=job.id, post_id=row.post_id))
    db.commit()
    db.refresh(job)
    response = DeletionOut.model_validate(job).model_dump(mode="json")
    _remember(db, "POST:/api/deletion-jobs", idempotency_key or "", response)
    audit(db, "deletion.created", "deletion_job", job.id, {"total": job.total, "sha256": digest})
    schedule_deletion(job.id)
    return response


TERMINAL_DELETION_STATUSES = ("completed", "cancelled", "failed")


def _retryable_deletion_items(db: Session, job_id: str) -> list[DeletionItem]:
    return list(
        db.scalars(
            select(DeletionItem)
            .join(Post, Post.id == DeletionItem.post_id)
            .where(
                DeletionItem.job_id == job_id,
                or_(
                    DeletionItem.status.in_(("failed", "pending")),
                    and_(
                        DeletionItem.status == "unresolved",
                        Post.source_post_id.is_not(None),
                    ),
                ),
                Post.deleted_at.is_(None),
            )
            .order_by(DeletionItem.created_at)
        ).all()
    )


def _unresolved_repost_items(db: Session, job_id: str) -> list[DeletionItem]:
    return list(
        db.scalars(
            select(DeletionItem)
            .join(Post, Post.id == DeletionItem.post_id)
            .where(
                DeletionItem.job_id == job_id,
                DeletionItem.status == "unresolved",
                Post.content_type == "repost",
                Post.source_post_id.is_(None),
                Post.deleted_at.is_(None),
            )
            .order_by(DeletionItem.created_at)
        ).all()
    )


def _deletion_payload(db: Session, job: DeletionJob) -> dict[str, Any]:
    unresolved_reposts = len(_unresolved_repost_items(db, job.id))
    resolution = db.scalar(
        select(RepostResolutionJob)
        .where(RepostResolutionJob.deletion_job_id == job.id)
        .order_by(RepostResolutionJob.created_at.desc())
    )
    return {
        **DeletionOut.model_validate(job).model_dump(mode="json"),
        "estimated_cost_usd": job.total * get_app_runtime_settings(db).delete_unit_cost_usd,
        "retryable": len(_retryable_deletion_items(db, job.id)),
        "unresolved_reposts": unresolved_reposts,
        "resolution_estimated_cost_usd": unresolved_reposts * get_app_runtime_settings(db).post_lookup_unit_cost_usd,
        "resolution": (
            {
                "id": resolution.id,
                "status": resolution.status,
                "total": resolution.total,
                "processed": resolution.processed,
                "resolved": resolution.resolved,
                "failed": resolution.failed,
                "resume_at": resolution.resume_at,
                "error": resolution.error,
            }
            if resolution
            else None
        ),
    }


@app.get("/api/deletion-jobs")
def list_deletions(
    db: Db,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
) -> dict[str, Any]:
    total = db.scalar(select(func.count()).select_from(DeletionJob)) or 0
    rows = list(
        db.scalars(
            select(DeletionJob)
            .order_by(DeletionJob.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    return {
        "items": [_deletion_payload(db, job) for job in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@app.get("/api/deletion-jobs/{job_id}")
def get_deletion(job_id: str, db: Db) -> dict[str, Any]:
    job = db.get(DeletionJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Deletion job not found")
    failures = list(
        db.execute(
            select(DeletionItem.post_id, DeletionItem.status, DeletionItem.error).where(
                DeletionItem.job_id == job.id, DeletionItem.status.in_(["failed", "unresolved"])
            )
        ).all()
    )
    return {
        **_deletion_payload(db, job),
        "failures": [{"post_id": row[0], "status": row[1], "error": row[2]} for row in failures],
    }


@app.post(
    "/api/deletion-jobs/{job_id}/retry",
    response_model=DeletionOut,
    dependencies=[Depends(require_csrf), Depends(require_live_x)],
)
async def retry_deletion(
    job_id: str,
    payload: DeletionRetry,
    db: Db,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> Any:
    endpoint = f"POST:/api/deletion-jobs/{job_id}/retry"
    cached = _idempotent(db, endpoint, idempotency_key)
    if cached:
        return cached
    source = db.get(DeletionJob, job_id)
    if not source:
        raise HTTPException(status_code=404, detail="Deletion job not found")
    if source.status not in TERMINAL_DELETION_STATUSES:
        raise HTTPException(
            status_code=409,
            detail="Pause, resume, or cancel the active job instead of creating a retry",
        )
    items = _retryable_deletion_items(db, source.id)
    if not items:
        raise HTTPException(status_code=409, detail="This job has no remaining items to retry")
    if payload.confirmation_count != len(items):
        raise HTTPException(status_code=400, detail=f"Type the exact retry count: {len(items)}")
    estimate = len(items) * get_app_runtime_settings(db).delete_unit_cost_usd
    if estimate > get_app_runtime_settings(db).api_budget_usd:
        raise HTTPException(
            status_code=409, detail="Retry estimate exceeds the configured API budget"
        )
    manifest_payload = {
        "version": 1,
        "retry_of": source.id,
        "scan_id": source.scan_id,
        "created_at": datetime.now(UTC).isoformat(),
        "items": [{"post_id": item.post_id, "previous_status": item.status} for item in items],
    }
    manifest = json.dumps(manifest_payload, ensure_ascii=False, sort_keys=True)
    digest = hashlib.sha256(manifest.encode()).hexdigest()
    job = DeletionJob(
        scan_id=source.scan_id,
        manifest_json=manifest,
        manifest_sha256=digest,
        total=len(items),
    )
    db.add(job)
    db.flush()
    for item in items:
        db.add(DeletionItem(job_id=job.id, post_id=item.post_id))
    db.commit()
    db.refresh(job)
    response = DeletionOut.model_validate(job).model_dump(mode="json")
    _remember(db, endpoint, idempotency_key or "", response)
    audit(
        db,
        "deletion.retry.created",
        "deletion_job",
        job.id,
        {"source_job_id": source.id, "total": job.total, "sha256": digest},
    )
    schedule_deletion(job.id)
    return response


@app.post(
    "/api/deletion-jobs/{job_id}/resolve-reposts",
    dependencies=[Depends(require_csrf), Depends(require_live_x)],
)
async def resolve_reposts(
    job_id: str,
    payload: RepostResolutionCreate,
    db: Db,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> dict[str, Any]:
    endpoint = f"POST:/api/deletion-jobs/{job_id}/resolve-reposts"
    cached = _idempotent(db, endpoint, idempotency_key)
    if cached:
        return cached
    source = db.get(DeletionJob, job_id)
    if not source:
        raise HTTPException(status_code=404, detail="Deletion job not found")
    if source.status not in TERMINAL_DELETION_STATUSES:
        raise HTTPException(status_code=409, detail="Wait for the deletion job to finish first")
    items = _unresolved_repost_items(db, source.id)
    if not items:
        raise HTTPException(status_code=409, detail="This job has no unresolved repost IDs")
    if payload.confirmation_count != len(items):
        raise HTTPException(
            status_code=400, detail=f"Type the exact unresolved repost count: {len(items)}"
        )
    estimate = len(items) * get_app_runtime_settings(db).post_lookup_unit_cost_usd
    if estimate > get_app_runtime_settings(db).api_budget_usd:
        raise HTTPException(
            status_code=409, detail="Repost-resolution estimate exceeds the configured API budget"
        )
    active = db.scalar(
        select(RepostResolutionJob).where(
            RepostResolutionJob.deletion_job_id == source.id,
            RepostResolutionJob.status.in_(("pending", "running", "rate_limited")),
        )
    )
    if active:
        raise HTTPException(status_code=409, detail="A repost-resolution job is already active")
    job = RepostResolutionJob(deletion_job_id=source.id, total=len(items))
    db.add(job)
    db.commit()
    db.refresh(job)
    response = {
        "id": job.id,
        "status": job.status,
        "total": job.total,
        "estimated_cost_usd": estimate,
    }
    _remember(db, endpoint, idempotency_key or "", response)
    audit(
        db,
        "repost_resolution.created",
        "repost_resolution_job",
        job.id,
        {"deletion_job_id": source.id, "total": job.total, "estimated_cost_usd": estimate},
    )
    schedule_repost_resolution(job.id)
    return response


def _control_job(job_id: str, action: str, db: Session) -> dict[str, str]:
    job = db.get(DeletionJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Deletion job not found")
    if job.status == "completed":
        raise HTTPException(status_code=409, detail="Completed jobs cannot be changed")
    if action == "resume":
        job.status = "pending"
        job.error = None
    else:
        job.status = action
    db.commit()
    audit(db, f"deletion.{action}", "deletion_job", job.id, {})
    if action == "resume":
        schedule_deletion(job.id)
    return {"status": job.status}


@app.post("/api/deletion-jobs/{job_id}/pause", dependencies=[Depends(require_csrf)])
async def pause_deletion(job_id: str, db: Db) -> dict[str, str]:
    return _control_job(job_id, "paused", db)


@app.post(
    "/api/deletion-jobs/{job_id}/resume",
    dependencies=[Depends(require_csrf), Depends(require_live_x)],
)
async def resume_deletion(job_id: str, db: Db) -> dict[str, str]:
    return _control_job(job_id, "resume", db)


@app.post("/api/deletion-jobs/{job_id}/cancel", dependencies=[Depends(require_csrf)])
async def cancel_deletion(job_id: str, db: Db) -> dict[str, str]:
    return _control_job(job_id, "cancelled", db)


@app.get("/api/jobs/{job_id}/events")
async def job_events(job_id: str):  # type: ignore[no-untyped-def]
    async def events():
        last = ""
        while True:
            with SessionLocal() as db:
                scan = db.get(Scan, job_id)
                job = db.get(DeletionJob, job_id)
                resolution = db.get(RepostResolutionJob, job_id)
                entity = scan or job or resolution
                if not entity:
                    yield f"event: error\ndata: {json.dumps({'detail': 'Job not found'})}\n\n"
                    return
                payload = {
                    "id": entity.id,
                    "status": entity.status,
                    "processed": entity.processed,
                    "total": entity.total,
                    "updated_at": entity.updated_at.isoformat(),
                }
                encoded = json.dumps(payload)
                if encoded != last:
                    yield f"event: progress\ndata: {encoded}\n\n"
                    last = encoded
                if entity.status in ("completed", "failed", "cancelled"):
                    return
            await asyncio.sleep(1)

    return StreamingResponse(
        events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"}
    )


@app.get("/api/audit")
def list_audit(db: Db, limit: int = Query(default=100, ge=1, le=500)) -> dict[str, Any]:
    rows = list(
        db.scalars(select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(limit)).all()
    )
    return {
        "items": [
            {
                "id": row.id,
                "created_at": row.created_at,
                "event_type": row.event_type,
                "entity_type": row.entity_type,
                "entity_id": row.entity_id,
                "details": json.loads(row.details_json),
            }
            for row in rows
        ]
    }


@app.get("/api/exports/{job_id}.{format}")
def export_manifest(job_id: str, format: str, db: Db) -> Response:
    job = db.get(DeletionJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Deletion job not found")
    manifest = json.loads(job.manifest_json)
    if format == "json":
        return Response(
            job.manifest_json,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="cleanup-x-{job.id}.json"'},
        )
    if format == "csv":
        output = io.StringIO()
        writer = csv.DictWriter(
            output, fieldnames=["post_id", "confidence", "reason_en", "reason_fa"]
        )
        writer.writeheader()
        writer.writerows(manifest["items"])
        return Response(
            output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="cleanup-x-{job.id}.csv"'},
        )
    raise HTTPException(status_code=400, detail="Format must be json or csv")
