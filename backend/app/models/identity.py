import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, Index, String, Table, Text, func, text
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, SoftDelete, Timestamps, UUIDPk

role_permissions = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", UUID(as_uuid=True), ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    Column("permission_id", UUID(as_uuid=True), ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True),
)

user_roles = Table(
    "user_roles",
    Base.metadata,
    Column("user_id", UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("role_id", UUID(as_uuid=True), ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True, index=True),
)


class Permission(UUIDPk, Base):
    __tablename__ = "permissions"
    key: Mapped[str] = mapped_column(String(100), unique=True)
    module: Mapped[str] = mapped_column(String(50), index=True)
    action: Mapped[str] = mapped_column(String(30))
    description: Mapped[str] = mapped_column(String(255), default="")


class Role(UUIDPk, Timestamps, Base):
    __tablename__ = "roles"
    key: Mapped[str] = mapped_column(String(60), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(String(255), default="")
    # System roles cannot be deleted or renamed; their permissions can still be adjusted.
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    # Administrative roles may sign in to the administration portal.
    is_staff: Mapped[bool] = mapped_column(Boolean, default=False)
    # Loaded explicitly (selectinload) where needed — never implicitly on every user lookup.
    permissions: Mapped[list[Permission]] = relationship(secondary=role_permissions, lazy="raise")


class User(UUIDPk, Timestamps, SoftDelete, Base):
    __tablename__ = "users"
    email: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(32))
    full_name: Mapped[str] = mapped_column(String(150))
    password_hash: Mapped[str] = mapped_column(String(255))
    # pending (awaiting email verification) | active | deactivated
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    phone_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    totp_secret_enc: Mapped[str | None] = mapped_column(Text)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    recovery_codes: Mapped[list | None] = mapped_column(JSONB)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    language: Mapped[str | None] = mapped_column(String(10))
    roles: Mapped[list[Role]] = relationship(secondary=user_roles, lazy="selectin")

    __table_args__ = (Index("uq_users_email_lower", text("lower(email)"), unique=True, postgresql_where=text("deleted_at IS NULL")),)


class Session(UUIDPk, Base):
    __tablename__ = "sessions"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    refresh_hash: Mapped[str] = mapped_column(String(128), unique=True)
    # The token this one replaced: presenting it again reveals a stolen/replayed refresh token.
    prev_refresh_hash: Mapped[str | None] = mapped_column(String(128), index=True)
    rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    user_agent: Mapped[str | None] = mapped_column(String(300))
    ip: Mapped[str | None] = mapped_column(INET)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    persistent: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))  # "Remember me"


class LoginAttempt(Base):
    __tablename__ = "login_attempts"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    ip: Mapped[str | None] = mapped_column(INET)
    success: Mapped[bool] = mapped_column(Boolean)
    reason: Mapped[str | None] = mapped_column(String(40))
    user_agent: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class UserVerification(UUIDPk, Base):
    """One-time tokens/codes: email verification, mobile OTP, password reset, login 2FA challenge."""

    __tablename__ = "user_verifications"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(30))  # email | phone | password_reset | mfa_challenge
    secret_hash: Mapped[str] = mapped_column(String(128), index=True)
    attempts: Mapped[int] = mapped_column(default=0)
    data: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
