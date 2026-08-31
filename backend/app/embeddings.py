"""Embedding protocol adapters and encrypted settings. No X or chat API calls."""

import hashlib
import json
import math
import time
from typing import Literal
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .models import AppSetting, EmbeddingJob
from .security import decrypt, encrypt
from .services import audit


class EmbeddingSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Literal["ollama", "openai_compatible"] = "ollama"
    base_url: str = "http://127.0.0.1:11434"
    model: str = Field(default="", max_length=256)
    api_key: SecretStr = SecretStr("")
    timeout_seconds: int = Field(default=120, ge=5, le=600)
    batch_size: int = Field(default=16, ge=1, le=64)
    query_prefix: str = Field(default="", max_length=1000)
    document_prefix: str = Field(default="", max_length=1000)

    @field_validator("base_url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        try:
            url = urlsplit(value)
            valid = (url.scheme in ("http", "https") and url.hostname and url.port != 0
                     and not url.username and not url.password and not url.query and not url.fragment
                     and not any(char.isspace() for char in value))
        except ValueError:
            valid = False
        if not valid:
            raise ValueError("Use an HTTP(S) base URL without credentials, query or fragment")
        return value


EmbeddingField = Literal["provider", "base_url", "model", "api_key", "timeout_seconds", "batch_size", "query_prefix", "document_prefix"]


class EmbeddingReset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fields: list[EmbeddingField] = Field(min_length=1, max_length=8)


def values(settings: EmbeddingSettings) -> dict:
    return {**settings.model_dump(), "api_key": settings.api_key.get_secret_value()}


def stored(db: Session, key: str) -> dict:
    row = db.get(AppSetting, key)
    return json.loads(decrypt(row.value_encrypted)) if row else {}


def store(db: Session, key: str, value: dict) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        row = AppSetting(key=key, value_encrypted="")
        db.add(row)
    row.value_encrypted = encrypt(json.dumps(value))
    db.commit()


def embedding_settings(db: Session) -> EmbeddingSettings:
    env = get_settings()
    defaults = {key: getattr(env, f"embedding_{key}") for key in EmbeddingSettings.model_fields}
    return EmbeddingSettings(**{**defaults, **stored(db, "embedding")})


def profile(settings: EmbeddingSettings) -> str:
    data = {key: value for key, value in values(settings).items() if key not in ("api_key", "timeout_seconds", "batch_size")}
    return hashlib.sha256(json.dumps({"version": 1, **data}, sort_keys=True).encode()).hexdigest()


def test_key(settings: EmbeddingSettings) -> str:
    return hashlib.sha256(json.dumps(values(settings), sort_keys=True).encode()).hexdigest()


def tested_dimensions(db: Session, settings: EmbeddingSettings) -> int:
    test = stored(db, "embedding_test")
    if test.get("key") != test_key(settings):
        raise HTTPException(409, "Save and test the embedding provider before indexing or searching")
    return test["dimensions"]


def public_settings(db: Session) -> dict:
    settings = embedding_settings(db)
    test = stored(db, "embedding_test")
    ready = test.get("key") == test_key(settings)
    return {**settings.model_dump(exclude={"api_key"}), "api_key_configured": bool(settings.api_key.get_secret_value()),
            "sources": {key: "saved" if key in stored(db, "embedding") else "environment" for key in EmbeddingSettings.model_fields},
            "tested": ready, "dimensions": test.get("dimensions") if ready else None}


def effective_draft(db: Session, draft: EmbeddingSettings) -> EmbeddingSettings:
    changes = draft.model_dump(exclude_unset=True)
    changes.pop("api_key", None)
    existing = values(embedding_settings(db))
    key = draft.api_key.get_secret_value().strip()
    # Do not silently forward a saved secret to a newly entered endpoint.
    if key or ("base_url" in changes and changes["base_url"] != existing["base_url"]):
        changes["api_key"] = key
    return EmbeddingSettings(**{**existing, **changes})


def save_settings(db: Session, draft: EmbeddingSettings | None = None, reset: list[str] | None = None) -> dict:
    if db.scalar(select(EmbeddingJob.id).where(EmbeddingJob.status.in_(["pending", "running"])).limit(1)):
        raise HTTPException(409, "Pause or cancel indexing before changing embedding settings")
    overrides = stored(db, "embedding")
    if reset:
        overrides = {key: value for key, value in overrides.items() if key not in reset}
        if "base_url" in reset and "api_key" not in reset and get_settings().embedding_base_url.rstrip("/") != embedding_settings(db).base_url:
            overrides["api_key"] = ""
    elif draft is not None:
        effective = values(effective_draft(db, draft))
        fields = set(draft.model_fields_set)
        if not draft.api_key.get_secret_value().strip():
            fields.discard("api_key")
        if "base_url" in fields and effective["base_url"] != embedding_settings(db).base_url:
            fields.add("api_key")
        overrides.update({key: effective[key] for key in fields})
    store(db, "embedding", overrides)
    audit(db, "settings.embedding.updated", "settings", "embedding", {"fields": reset or sorted(draft.model_fields_set if draft else [])})
    return public_settings(db)


class EmbeddingError(RuntimeError):
    pass


def normalize_vector(vector: object, dimensions: int | None = None) -> list[float]:
    if not isinstance(vector, list) or not 1 <= len(vector) <= 16384:
        raise EmbeddingError("Invalid embedding vector size")
    if dimensions is not None and len(vector) != dimensions:
        raise EmbeddingError("Embedding dimensions changed; use a versioned model and rebuild its index")
    if any(type(value) not in (int, float) or not math.isfinite(value) for value in vector):
        raise EmbeddingError("Embedding contains invalid numbers")
    norm = math.hypot(*vector)
    if not math.isfinite(norm) or norm == 0:
        raise EmbeddingError("Embedding vector has invalid magnitude")
    return [value / norm for value in vector]


class EmbeddingClient:
    def __init__(self, settings: EmbeddingSettings):
        self.settings = settings

    async def request(self, method: str, path: str, body: dict | None = None) -> dict:
        key = self.settings.api_key.get_secret_value()
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        try:
            async with httpx.AsyncClient(timeout=self.settings.timeout_seconds, follow_redirects=False) as client:
                response = await client.request(method, self.settings.base_url + path, headers=headers, json=body)
                if not 200 <= response.status_code < 300:
                    raise EmbeddingError(f"Embedding provider returned HTTP {response.status_code}; check endpoint, model and credentials")
                payload = response.json()
                if not isinstance(payload, dict):
                    raise TypeError()
                return payload
        except httpx.TimeoutException as exc:
            raise EmbeddingError("Embedding provider timed out") from exc
        except httpx.RequestError as exc:
            raise EmbeddingError("Could not reach the provider") from exc
        except (ValueError, TypeError) as exc:
            raise EmbeddingError("Embedding provider returned invalid JSON") from exc

    async def embed(self, texts: list[str], dimensions: int | None = None) -> list[list[float]]:
        if not self.settings.model.strip():
            raise EmbeddingError("Choose an embedding model first")
        body = {"model": self.settings.model, "input": texts}
        if self.settings.provider == "ollama":
            payload = await self.request("POST", "/api/embed", {**body, "truncate": False})
            vectors = payload.get("embeddings")
        else:
            payload = await self.request("POST", "/embeddings", {**body, "encoding_format": "float"})
            items = payload.get("data")
            if not isinstance(items, list) or len(items) != len(texts) or any(not isinstance(item, dict) or type(item.get("index")) is not int for item in items):
                raise EmbeddingError("Embedding provider returned invalid item indexes")
            if sorted(item["index"] for item in items) != list(range(len(texts))):
                raise EmbeddingError("Embedding provider returned missing or duplicate items")
            vectors = [item.get("embedding") for item in sorted(items, key=lambda item: item["index"])]
        if not isinstance(vectors, list) or len(vectors) != len(texts):
            raise EmbeddingError("Embedding provider returned the wrong number of vectors")
        result = []
        for vector in vectors:
            normalized = normalize_vector(vector, dimensions)
            dimensions = len(normalized)
            result.append(normalized)
        return result

    async def models(self) -> list[str]:
        native = self.settings.provider == "ollama"
        payload = await self.request("GET", "/api/tags" if native else "/models")
        rows = payload.get("models" if native else "data")
        if not isinstance(rows, list):
            raise EmbeddingError("Embedding provider returned an invalid model list")
        return sorted({item.get("name" if native else "id") for item in rows if isinstance(item, dict) and isinstance(item.get("name" if native else "id"), str)})


async def test_provider(db: Session, draft: EmbeddingSettings) -> dict:
    settings = effective_draft(db, draft)
    started = time.monotonic()
    vectors = await EmbeddingClient(settings).embed([
        settings.document_prefix + "A quiet walk in the park.",
        settings.query_prefix + "قدم زدن در پارک",
    ])
    # A draft test does not mark different saved settings as ready.
    if test_key(settings) == test_key(embedding_settings(db)):
        store(db, "embedding_test", {"key": test_key(settings), "dimensions": len(vectors[0])})
    return {"ok": True, "dimensions": len(vectors[0]), "latency_ms": round((time.monotonic() - started) * 1000),
            "saved_settings_tested": test_key(settings) == test_key(embedding_settings(db))}
