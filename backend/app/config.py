from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", env_prefix="APP_", extra="ignore")

    env: str = "development"
    demo_mode: bool = False
    database_url: str = f"sqlite:///{ROOT / 'data' / 'cleanup-x.db'}"
    encryption_key: str = ""
    frontend_url: str = "http://127.0.0.1:5173"
    api_url: str = "http://127.0.0.1:8787"
    x_client_id: str = ""
    x_client_secret: str = ""
    x_callback_url: str = "http://127.0.0.1:8787/api/auth/x/callback"
    max_archive_mb: int = Field(default=2048, ge=1, le=10240)
    max_archive_files: int = Field(default=20000, ge=10, le=100000)
    api_budget_usd: float = Field(default=25.0, ge=0)
    delete_unit_cost_usd: float = Field(default=0.01, ge=0)
    owned_read_unit_cost_usd: float = Field(default=0.001, ge=0)
    post_lookup_unit_cost_usd: float = Field(default=0.005, ge=0)
    llm_provider: Literal["ollama", "openai_compatible"] = "ollama"
    llm_base_url: str = "http://127.0.0.1:11434"
    llm_model: str = "qwen2.5:7b"
    llm_api_key: str = ""
    llm_timeout_seconds: int = Field(default=120, ge=5, le=600)
    llm_batch_size: int = Field(default=10, ge=1, le=50)
    llm_vision_enabled: bool = False
    embedding_provider: Literal["ollama", "openai_compatible"] = "ollama"
    embedding_base_url: str = "http://127.0.0.1:11434"
    embedding_model: str = ""
    embedding_api_key: str = ""
    embedding_timeout_seconds: int = Field(default=120, ge=5, le=600)
    embedding_batch_size: int = Field(default=16, ge=1, le=64)
    embedding_query_prefix: str = ""
    embedding_document_prefix: str = ""

    @property
    def is_testing(self) -> bool:
        return self.env == "test"


@lru_cache
def get_settings() -> Settings:
    return Settings()
