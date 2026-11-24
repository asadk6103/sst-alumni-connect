"""Integration settings (email, SMS, storage, payment): config in JSON, secrets encrypted at rest.

Secrets are never returned by the API — only which secret fields are set (masked) — and an empty
value in an update keeps the stored secret.
"""

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from ..core import settings_store
from ..core.config import infra
from ..core.security import decrypt, encrypt
from ..models import IntegrationSetting

Kind = Literal["email", "sms", "storage", "payment"]


class SmtpConfig(BaseModel):
    host: str = Field(..., min_length=1, max_length=255)
    port: int = Field(587, ge=1, le=65535)
    encryption: Literal["none", "starttls", "ssl"] = "starttls"
    username: str | None = Field(None, max_length=255)
    sender_name: str = Field("SST Alumni Connect", max_length=100)
    sender_email: EmailStr
    reply_to: EmailStr | None = None


class SmsConfig(BaseModel):
    """Generic HTTP SMS provider: works with most REST SMS gateways."""

    endpoint: str = Field(..., pattern=r"^https?://", max_length=500)
    method: Literal["POST", "GET"] = "POST"
    sender_id: str | None = Field(None, max_length=40)
    account_id: str | None = Field(None, max_length=120)
    # How the API key is sent
    auth_style: Literal["bearer", "header", "query", "body"] = "bearer"
    auth_field: str = Field("api_key", max_length=60)
    content_type: Literal["json", "form"] = "json"
    # Request template; placeholders {{to}} {{message}} {{sender_id}} {{account_id}} {{api_key}}
    body_template: str = Field('{"to": "{{to}}", "message": "{{message}}", "sender": "{{sender_id}}"}', max_length=2000)
    extra_params: dict[str, str] = Field(default_factory=dict)
    success_codes: list[int] = Field(default_factory=lambda: [200, 201, 202])


class StorageConfig(BaseModel):
    endpoint: str | None = Field(None, max_length=255)  # host[:port] for MinIO / S3-compatible; None for AWS
    bucket: str | None = Field(None, min_length=3, max_length=63, pattern=r"^[a-z0-9][a-z0-9.\-]+$")
    region: str | None = Field(None, max_length=40)
    secure: bool = True
    public_url: str | None = Field(None, max_length=255)  # base URL that serves public objects
    access: Literal["public", "private"] = "public"


PROVIDERS: dict[str, dict[str, tuple[type[BaseModel] | None, list[str]]]] = {
    "email": {"smtp": (SmtpConfig, ["password"])},
    "sms": {"http": (SmsConfig, ["api_key"])},
    "storage": {"local": (None, []), "minio": (StorageConfig, ["access_key", "secret_key"]),
                "s3": (StorageConfig, ["access_key", "secret_key"])},
    "payment": {},  # adapters added when payment providers are introduced
}


@dataclass
class Integration:
    kind: str
    provider: str
    config: dict
    secrets: dict[str, str]
    enabled: bool


async def load(db: AsyncSession, kind: str) -> Integration | None:
    row = await db.get(IntegrationSetting, kind)
    if not row:
        return None
    secrets = json.loads(decrypt(row.secrets_enc) or "{}") if row.secrets_enc else {}
    return Integration(kind, row.provider, dict(row.config or {}), secrets, row.enabled)


def public_view(row: IntegrationSetting | None, kind: str) -> dict:
    if not row:
        return {"kind": kind, "provider": None, "config": {}, "secrets": {}, "enabled": False, "last_test": None}
    stored = json.loads(decrypt(row.secrets_enc) or "{}") if row.secrets_enc else {}
    fields = PROVIDERS.get(kind, {}).get(row.provider, (None, []))[1]
    return {
        "kind": kind,
        "provider": row.provider,
        "config": row.config,
        # never the values — only whether each secret is set
        "secrets": {f: ("••••••••" if stored.get(f) else "") for f in fields},
        "enabled": row.enabled,
        "last_test": {"at": row.last_tested_at, "ok": row.last_test_ok, "message": row.last_test_message}
        if row.last_tested_at else None,
        "updated_at": row.updated_at,
    }


class IntegrationUpdate(BaseModel):
    provider: str
    config: dict = Field(default_factory=dict)
    secrets: dict[str, str] = Field(default_factory=dict)
    enabled: bool = False

    @field_validator("secrets")
    @classmethod
    def _strip(cls, v: dict[str, str]) -> dict[str, str]:
        return {k: s for k, s in v.items() if s and "•" not in s}


async def save(db: AsyncSession, kind: str, upd: IntegrationUpdate, actor) -> IntegrationSetting:
    from ..core.errors import bad_request

    providers = PROVIDERS.get(kind)
    if providers is None or upd.provider not in providers:
        raise bad_request("UNKNOWN_PROVIDER", f"Unsupported provider for {kind}: {upd.provider}")
    model, secret_fields = providers[upd.provider]
    config = model.model_validate(upd.config).model_dump(mode="json") if model else {}
    row = await db.get(IntegrationSetting, kind)
    stored = json.loads(decrypt(row.secrets_enc) or "{}") if row and row.secrets_enc and row.provider == upd.provider else {}
    merged = {f: upd.secrets.get(f) or stored.get(f) for f in secret_fields}
    merged = {k: v for k, v in merged.items() if v}
    enc = encrypt(json.dumps(merged)) if merged else None
    if row:
        provider_changed = row.provider != upd.provider or row.config != config
        row.provider, row.config, row.secrets_enc, row.enabled, row.updated_by = upd.provider, config, enc, upd.enabled, actor
        if provider_changed or upd.secrets:
            row.last_tested_at = row.last_test_ok = row.last_test_message = None
    else:
        row = IntegrationSetting(kind=kind, provider=upd.provider, config=config, secrets_enc=enc,
                                 enabled=upd.enabled, updated_by=actor)
        db.add(row)
    await db.flush()
    await db.refresh(row)
    await settings_store.changed()
    return row


async def record_test(db: AsyncSession, kind: str, ok: bool, message: str) -> None:
    row = await db.get(IntegrationSetting, kind)
    if row:
        row.last_tested_at, row.last_test_ok, row.last_test_message = datetime.now(UTC), ok, message[:500]
        await db.flush()


def bundled_minio_defaults() -> dict | None:
    s = infra()
    if not (s.minio_endpoint and s.minio_access_key and s.minio_secret_key):
        return None
    return {"endpoint": s.minio_endpoint, "public_url": s.minio_public_url, "secure": False}
