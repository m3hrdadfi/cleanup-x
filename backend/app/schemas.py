from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ContentType = Literal["post", "reply", "quote", "repost"]


class OrmModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class LocalInventoryRemoval(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    confirmed: Literal[True]


class LLMSettings(BaseModel):
    provider: Literal["ollama", "openai_compatible"] = "ollama"
    base_url: str = "http://127.0.0.1:11434"
    model: str = "qwen2.5:7b"
    api_key: str = ""
    timeout_seconds: int = Field(default=120, ge=5, le=600)
    batch_size: int = Field(default=10, ge=1, le=50)
    vision_enabled: bool = False


LLMSettingField = Literal[
    "provider",
    "base_url",
    "model",
    "api_key",
    "timeout_seconds",
    "batch_size",
    "vision_enabled",
]


class LLMSettingsReset(BaseModel):
    fields: list[LLMSettingField] = Field(min_length=1)


class LLMSettingsUpdate(LLMSettings):
    environment_fields: list[LLMSettingField] = Field(default_factory=list)


class AppRuntimeSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    api_budget_usd: float = Field(default=25, ge=0, le=100000)
    audit_retention_days: int = Field(default=0, ge=0, le=3650)
    max_archive_mb: int = Field(default=2048, ge=1, le=10240)
    max_archive_files: int = Field(default=20000, ge=10, le=100000)
    delete_unit_cost_usd: float = Field(default=0.01, ge=0, le=100)
    owned_read_unit_cost_usd: float = Field(default=0.001, ge=0, le=100)
    post_lookup_unit_cost_usd: float = Field(default=0.005, ge=0, le=100)


class AppSettingsReset(BaseModel):
    fields: list[Literal[
        "api_budget_usd", "audit_retention_days", "max_archive_mb", "max_archive_files",
        "delete_unit_cost_usd", "owned_read_unit_cost_usd", "post_lookup_unit_cost_usd",
    ]] = Field(min_length=1)


class PolicyRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=4000)
    languages: list[str] = Field(default_factory=lambda: ["en", "fa"])
    content_types: list[ContentType] = Field(
        default_factory=lambda: ["post", "reply", "quote", "repost"]
    )


class CompiledPolicy(BaseModel):
    target_topic: str
    languages: list[str]
    content_types: list[ContentType]
    positive_indicators: list[str]
    positive_indicators_fa: list[str]
    exclusions: list[str]
    exclusions_fa: list[str]
    ambiguity_guidance: str
    ambiguity_guidance_fa: str


class ScanCreate(PolicyRequest):
    policy: CompiledPolicy | None = None
    threshold: float = Field(default=0.85, ge=0, le=1)
    start_date: datetime | None = None
    end_date: datetime | None = None
    max_posts: int = Field(default=0, ge=0, le=1_000_000)


class SelectionUpdate(BaseModel):
    post_ids: list[str]
    selected: bool


class ClassificationOutput(BaseModel):
    post_id: str
    matches: bool
    confidence: float = Field(ge=0, le=1)
    detected_language: str
    topics: list[str]
    reason_en: str
    reason_fa: str


class ClassificationBatch(BaseModel):
    results: list[ClassificationOutput]


class DeletionCreate(BaseModel):
    scan_id: str
    confirmation_count: int = Field(ge=0)


class DeletionRetry(BaseModel):
    confirmation_count: int = Field(ge=0)


class RepostResolutionCreate(BaseModel):
    confirmation_count: int = Field(ge=0)


class PostOut(OrmModel):
    id: str
    text: str
    source_text: str | None
    language: str | None
    posted_at: datetime | None
    content_type: str
    source_post_id: str | None
    from_api: bool
    from_archive: bool
    accessible: bool | None
    deleted_at: datetime | None


class XStatus(BaseModel):
    configured: bool
    connected: bool
    user_id: str | None = None
    username: str | None = None
    name: str | None = None


class ScanOut(OrmModel):
    id: str
    prompt: str
    threshold: float
    max_posts: int
    status: str
    processed: int
    total: int
    error: str | None
    created_at: datetime
    updated_at: datetime


class DeletionOut(OrmModel):
    id: str
    scan_id: str
    status: str
    total: int
    processed: int
    succeeded: int
    failed: int
    manifest_sha256: str
    resume_at: datetime | None
    error: str | None
    created_at: datetime
    updated_at: datetime
