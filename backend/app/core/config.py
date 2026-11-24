"""Infrastructure configuration (environment variables only).

Everything an administrator may want to change — institution details, branding, security policy,
SMTP/SMS/storage credentials, modules, feature flags — lives in the database and is edited in the
administration portal. Only values needed *before* the application can reach its database belong here.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class InfraSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: Literal["production", "development", "test"] = "production"
    database_url: str = "postgresql+asyncpg://alumni:alumni@localhost:5432/alumni"
    redis_url: str = "redis://localhost:6379/0"
    # Folder holding generated secrets and the first-run setup code (a private volume).
    config_dir: Path = Path("./config")
    # Local file storage (used when the storage provider is "local", and for private files).
    storage_dir: Path = Path("./storage")
    # Bundled MinIO (object storage) — offered as the default S3 provider in the setup wizard.
    minio_endpoint: str | None = None
    minio_public_url: str | None = None
    minio_access_key: str | None = None
    minio_secret_key: str | None = None
    # Number of reverse proxies in front of the API (nginx = 1) — for client IPs and HTTPS detection.
    trusted_proxies: int = 1
    db_pool_size: int = Field(default=10, ge=1, le=200)
    db_max_overflow: int = Field(default=20, ge=0, le=400)
    log_level: str = "INFO"
    # Optional override of the public address (normally set in the setup wizard / configuration).
    public_url: str | None = None

    @property
    def is_dev(self) -> bool:
        return self.environment != "production"


@lru_cache
def infra() -> InfraSettings:
    s = InfraSettings()
    s.config_dir = s.config_dir.resolve()
    s.storage_dir = s.storage_dir.resolve()
    return s
