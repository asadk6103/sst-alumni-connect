import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, INET, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, SoftDelete, Timestamps, UUIDPk


class SystemSetting(Base):
    """Key/value settings groups (general, security, realtime …) — validated by pydantic schemas."""

    __tablename__ = "system_settings"
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class BrandingSetting(Base):
    """Single row. Admins edit the draft (with live preview) and publish it."""

    __tablename__ = "branding_settings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    draft: Mapped[dict] = mapped_column(JSONB, default=dict)
    published: Mapped[dict] = mapped_column(JSONB, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class ModuleSetting(Base):
    __tablename__ = "module_settings"
    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class IntegrationSetting(Base):
    """SMTP / SMS / storage / payment providers. Secrets are Fernet-encrypted and never returned."""

    __tablename__ = "integration_settings"
    kind: Mapped[str] = mapped_column(String(20), primary_key=True)  # email | sms | storage | payment
    provider: Mapped[str] = mapped_column(String(40))
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    secrets_enc: Mapped[str | None] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_test_ok: Mapped[bool | None] = mapped_column(Boolean)
    last_test_message: Mapped[str | None] = mapped_column(String(500))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class FeatureFlag(Base):
    __tablename__ = "feature_flags"
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(String(300), default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Empty = everyone; otherwise only users holding one of these role keys see the feature.
    roles: Mapped[list[str]] = mapped_column(ARRAY(String(60)), default=list)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class MessageTemplate(UUIDPk, Timestamps, Base):
    """Email / SMS / in-app templates with {{placeholders}}; per-language variants."""

    __tablename__ = "message_templates"
    key: Mapped[str] = mapped_column(String(80), index=True)
    channel: Mapped[str] = mapped_column(String(10))  # email | sms | inapp
    language: Mapped[str] = mapped_column(String(10), default="en")
    name: Mapped[str] = mapped_column(String(150))
    subject: Mapped[str | None] = mapped_column(String(250))
    body: Mapped[str] = mapped_column(Text)
    placeholders: Mapped[list[str]] = mapped_column(ARRAY(String(60)), default=list)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class NotificationLog(Base):
    """Delivery log for email / SMS."""

    __tablename__ = "notification_logs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    channel: Mapped[str] = mapped_column(String(10), index=True)
    recipient: Mapped[str] = mapped_column(String(255))
    template: Mapped[str | None] = mapped_column(String(80))
    subject: Mapped[str | None] = mapped_column(String(250))
    status: Mapped[str] = mapped_column(String(20), index=True)  # queued | sent | failed | skipped
    error: Mapped[str | None] = mapped_column(String(500))
    # Rendered message kept until delivered, so the outbox sweep can re-dispatch it.
    payload: Mapped[dict | None] = mapped_column(JSONB)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Media(UUIDPk, SoftDelete, Base):
    __tablename__ = "media_library"
    storage: Mapped[str] = mapped_column(String(20))  # local | s3
    key: Mapped[str] = mapped_column(String(300), unique=True)
    filename: Mapped[str] = mapped_column(String(255))
    mime: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(BigInteger)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    variants: Mapped[dict] = mapped_column(JSONB, default=dict)
    alt: Mapped[str] = mapped_column(String(300), default="")
    folder: Mapped[str] = mapped_column(String(60), default="general", index=True)
    # Private files (verification documents, CVs …) are never served publicly; only via authorised endpoints.
    private: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    action: Mapped[str] = mapped_column(String(60), index=True)
    entity: Mapped[str] = mapped_column(String(60), index=True)
    entity_id: Mapped[str | None] = mapped_column(String(64))
    summary: Mapped[str] = mapped_column(String(300))
    data: Mapped[dict | None] = mapped_column(JSONB)
    ip: Mapped[str | None] = mapped_column(INET)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
