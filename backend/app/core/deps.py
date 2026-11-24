"""Request dependencies: authenticated principal, permission and module guards, client IP."""

import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Permission, Role, Session, User, role_permissions, user_roles
from . import settings_store
from .config import infra
from .db import get_db
from .errors import AppError, forbidden
from .permissions import SUPER_ADMIN
from .security import decode_access_token

PRINCIPAL_CACHE_SECONDS = 5.0
_principals: dict[uuid.UUID, tuple[float, "Principal"]] = {}


@dataclass
class Principal:
    id: uuid.UUID
    session_id: uuid.UUID
    email: str
    full_name: str
    status: str
    roles: list[str]
    permissions: set[str] = field(default_factory=set)
    is_staff: bool = False
    mfa_enabled: bool = False

    def can(self, perm: str) -> bool:
        return SUPER_ADMIN in self.roles or perm in self.permissions

    @property
    def is_super(self) -> bool:
        return SUPER_ADMIN in self.roles


def forget_principals(user_id: uuid.UUID | None = None) -> None:
    """Drop cached principals (after role/permission/session changes)."""
    if user_id is None:
        _principals.clear()
    else:
        for sid, (_, p) in list(_principals.items()):
            if p.id == user_id:
                _principals.pop(sid, None)


def client_ip(request: Request) -> str | None:
    """Client address as seen by the outermost trusted proxy."""
    hops = infra().trusted_proxies
    fwd = request.headers.get("x-forwarded-for")
    if hops > 0 and fwd:
        parts = [p.strip() for p in fwd.split(",") if p.strip()]
        if len(parts) >= hops:
            return parts[-hops]
    return request.client.host if request.client else None


async def load_principal(db: AsyncSession, token: str) -> Principal | None:
    claims = decode_access_token(token)
    if not claims:
        return None
    try:
        sid, uid = uuid.UUID(claims["sid"]), uuid.UUID(claims["sub"])
    except ValueError:
        return None
    hit = _principals.get(sid)
    if hit and time.monotonic() - hit[0] < PRINCIPAL_CACHE_SECONDS:
        return hit[1]
    row = (await db.execute(
        select(User, Session)
        .join(Session, Session.user_id == User.id)
        .where(Session.id == sid, User.id == uid, User.deleted_at.is_(None))
    )).first()
    if not row:
        return None
    user, session = row
    now = datetime.now(UTC)
    if session.revoked_at or session.expires_at <= now or user.status != "active":
        _principals.pop(sid, None)
        return None
    perm_rows = (await db.execute(
        select(Role.key, Role.is_staff, Permission.key)
        .select_from(user_roles)
        .join(Role, Role.id == user_roles.c.role_id)
        .outerjoin(role_permissions, role_permissions.c.role_id == Role.id)
        .outerjoin(Permission, Permission.id == role_permissions.c.permission_id)
        .where(user_roles.c.user_id == uid)
    )).all()
    roles = sorted({r[0] for r in perm_rows})
    p = Principal(id=user.id, session_id=sid, email=user.email, full_name=user.full_name, status=user.status,
                  roles=roles, permissions={r[2] for r in perm_rows if r[2]}, is_staff=any(r[1] for r in perm_rows),
                  mfa_enabled=user.totp_enabled)
    _principals[sid] = (time.monotonic(), p)
    return p


def _bearer(request: Request) -> str | None:
    h = request.headers.get("authorization", "")
    return h[7:].strip() if h.lower().startswith("bearer ") else None


async def optional_user(request: Request, db: AsyncSession = Depends(get_db)) -> Principal | None:
    token = _bearer(request)
    return await load_principal(db, token) if token else None


async def current_user(request: Request, db: AsyncSession = Depends(get_db)) -> Principal:
    token = _bearer(request)
    p = await load_principal(db, token) if token else None
    if not p:
        raise AppError(401, "UNAUTHENTICATED", "Please sign in.")
    request.state.principal = p
    return p


async def _mfa_gate(db: AsyncSession, p: Principal) -> None:
    """Staff (or everyone) must have two-factor authentication when the security policy says so."""
    if p.mfa_enabled or not (p.is_staff or p.is_super):
        return
    sec = await settings_store.get_group(db, "security")
    if sec.mfa_policy in ("required_staff", "required_all"):
        raise AppError(403, "MFA_SETUP_REQUIRED", "Set up two-factor authentication to use the administration portal.")


def require(*perms: str, any_of: bool = False):
    """Backend permission enforcement: all (default) or any of the given permissions."""

    async def dep(p: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)) -> Principal:
        if any(x.split(".")[0] != "portal" for x in perms):
            await _mfa_gate(db, p)
        ok = any(p.can(x) for x in perms) if any_of else all(p.can(x) for x in perms)
        if not ok:
            raise forbidden()
        return p

    return dep


def require_staff():
    async def dep(p: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)) -> Principal:
        if not (p.is_staff or p.is_super):
            raise forbidden("The administration portal is for staff accounts only.")
        await _mfa_gate(db, p)
        return p

    return dep


def require_module(key: str):
    """Disabled modules keep their data but their endpoints answer 404 MODULE_DISABLED."""

    async def dep(db: AsyncSession = Depends(get_db)) -> None:
        mods = await settings_store.modules(db)
        if not mods.get(key, True):
            raise AppError(404, "MODULE_DISABLED", "This feature is currently not available.")

    return dep
