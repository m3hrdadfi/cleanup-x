from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_id() -> str:
    return str(uuid4())


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class XConnection(Base, TimestampMixin):
    __tablename__ = "x_connections"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    x_user_id: Mapped[str] = mapped_column(String(32), unique=True)
    username: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(128), default="")
    token_encrypted: Mapped[str] = mapped_column(Text)


class OAuthState(Base, TimestampMixin):
    __tablename__ = "oauth_states"
    state: Mapped[str] = mapped_column(String(128), primary_key=True)
    verifier_encrypted: Mapped[str] = mapped_column(Text)
    consumed: Mapped[bool] = mapped_column(Boolean, default=False)


class AppSetting(Base, TimestampMixin):
    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value_encrypted: Mapped[str] = mapped_column(Text)


class Post(Base, TimestampMixin):
    __tablename__ = "posts"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    text: Mapped[str] = mapped_column(Text, default="")
    source_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    content_type: Mapped[str] = mapped_column(String(16), default="post")
    source_post_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    quoted_post_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    media_json: Mapped[str] = mapped_column(Text, default="[]")
    raw_json: Mapped[str] = mapped_column(Text, default="{}")
    from_api: Mapped[bool] = mapped_column(Boolean, default=False)
    from_archive: Mapped[bool] = mapped_column(Boolean, default=False)
    accessible: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ImportJob(Base, TimestampMixin):
    __tablename__ = "import_jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    filename: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(24), default="running")
    report_json: Mapped[str] = mapped_column(Text, default="{}")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class Scan(Base, TimestampMixin):
    __tablename__ = "scans"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    prompt: Mapped[str] = mapped_column(Text)
    policy_json: Mapped[str] = mapped_column(Text)
    threshold: Mapped[float] = mapped_column(Float, default=0.85)
    content_types_json: Mapped[str] = mapped_column(
        Text, default='["post","reply","quote","repost"]'
    )
    languages_json: Mapped[str] = mapped_column(Text, default='["en","fa"]')
    start_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    max_posts: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(24), default="pending")
    processed: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    results: Mapped[list[Classification]] = relationship(
        back_populates="scan", cascade="all, delete-orphan"
    )


class Classification(Base, TimestampMixin):
    __tablename__ = "classifications"
    __table_args__ = (UniqueConstraint("scan_id", "post_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    scan_id: Mapped[str] = mapped_column(ForeignKey("scans.id", ondelete="CASCADE"))
    post_id: Mapped[str] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"))
    matches: Mapped[bool] = mapped_column(Boolean, default=False)
    confidence: Mapped[float] = mapped_column(Float, default=0)
    detected_language: Mapped[str] = mapped_column(String(16), default="unknown")
    topics_json: Mapped[str] = mapped_column(Text, default="[]")
    reason_en: Mapped[str] = mapped_column(Text, default="")
    reason_fa: Mapped[str] = mapped_column(Text, default="")
    selected: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(24), default="classified")
    cache_key: Mapped[str] = mapped_column(String(64), index=True)
    scan: Mapped[Scan] = relationship(back_populates="results")
    post: Mapped[Post] = relationship()


class InventoryRemoval(Base, TimestampMixin):
    """Local visibility tombstones; source data and operational history stay intact."""

    __tablename__ = "inventory_removals"
    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    scan_id: Mapped[str] = mapped_column(ForeignKey("scans.id", ondelete="CASCADE"), index=True)
    post_id: Mapped[str | None] = mapped_column(
        ForeignKey("posts.id", ondelete="CASCADE"), nullable=True
    )


class DeletionJob(Base, TimestampMixin):
    __tablename__ = "deletion_jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    scan_id: Mapped[str] = mapped_column(ForeignKey("scans.id"))
    status: Mapped[str] = mapped_column(String(24), default="pending")
    manifest_json: Mapped[str] = mapped_column(Text)
    manifest_sha256: Mapped[str] = mapped_column(String(64))
    total: Mapped[int] = mapped_column(Integer, default=0)
    processed: Mapped[int] = mapped_column(Integer, default=0)
    succeeded: Mapped[int] = mapped_column(Integer, default=0)
    failed: Mapped[int] = mapped_column(Integer, default=0)
    resume_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    items: Mapped[list[DeletionItem]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )


class DeletionItem(Base, TimestampMixin):
    __tablename__ = "deletion_items"
    __table_args__ = (UniqueConstraint("job_id", "post_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    job_id: Mapped[str] = mapped_column(ForeignKey("deletion_jobs.id", ondelete="CASCADE"))
    post_id: Mapped[str] = mapped_column(ForeignKey("posts.id"))
    status: Mapped[str] = mapped_column(String(24), default="pending")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    job: Mapped[DeletionJob] = relationship(back_populates="items")
    post: Mapped[Post] = relationship()


class RepostResolutionJob(Base, TimestampMixin):
    __tablename__ = "repost_resolution_jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    deletion_job_id: Mapped[str] = mapped_column(ForeignKey("deletion_jobs.id"), index=True)
    status: Mapped[str] = mapped_column(String(24), default="pending")
    total: Mapped[int] = mapped_column(Integer, default=0)
    processed: Mapped[int] = mapped_column(Integer, default=0)
    resolved: Mapped[int] = mapped_column(Integer, default=0)
    failed: Mapped[int] = mapped_column(Integer, default=0)
    resume_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    entity_type: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    details_json: Mapped[str] = mapped_column(Text, default="{}")


class IdempotencyRecord(Base, TimestampMixin):
    __tablename__ = "idempotency_records"
    __table_args__ = (UniqueConstraint("endpoint", "key"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    endpoint: Mapped[str] = mapped_column(String(128))
    key: Mapped[str] = mapped_column(String(128))
    response_json: Mapped[str] = mapped_column(Text)


JsonObject = dict[str, Any]


class PostEmbedding(Base, TimestampMixin):
    __tablename__ = "post_embeddings"
    profile: Mapped[str] = mapped_column(String(64), primary_key=True)
    post_id: Mapped[str] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True)
    content_hash: Mapped[str] = mapped_column(String(64))
    vector_json: Mapped[str] = mapped_column(Text)


class EmbeddingJob(Base, TimestampMixin):
    __tablename__ = "embedding_jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    request_key: Mapped[str] = mapped_column(String(128), unique=True)
    profile: Mapped[str] = mapped_column(String(64), index=True)
    items_json: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), default="pending")
    total: Mapped[int] = mapped_column(Integer, default=0)
    processed: Mapped[int] = mapped_column(Integer, default=0)
    indexed: Mapped[int] = mapped_column(Integer, default=0)
    skipped: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
