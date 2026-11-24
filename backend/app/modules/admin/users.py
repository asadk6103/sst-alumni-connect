import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.audit import record
from ...core.db import get_db
from ...core.deps import Principal, client_ip, forget_principals, require
from ...core.errors import AppError, conflict, forbidden, not_found
from ...core.pagination import PageParams, csv_response, page_params, paginate
from ...core.permissions import SUPER_ADMIN
from ...core.security import hash_password, random_token, token_hash
from ...core.settings_schemas import password_problems
from ...models import Role, User
from ..auth import service as auth_svc

router = APIRouter(prefix="/api/v1/admin/users", tags=["Admin: users"])


def user_out(u: User) -> dict:
    return {
        "id": str(u.id), "email": u.email, "full_name": u.full_name, "phone": u.phone, "status": u.status,
        "email_verified": bool(u.email_verified_at), "phone_verified": bool(u.phone_verified_at),
        "mfa_enabled": u.totp_enabled, "locked": bool(u.locked_until and u.locked_until > datetime.now(UTC)),
        "roles": [{"key": r.key, "name": r.name} for r in u.roles],
        "last_login_at": u.last_login_at, "created_at": u.created_at,
    }


def _filtered(q: str | None, status: str | None, role: str | None):
    stmt = select(User).where(User.deleted_at.is_(None))
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(User.email).like(like), func.lower(User.full_name).like(like),
                              User.phone.like(like)))
    if status:
        stmt = stmt.where(User.status == status)
    if role:
        stmt = stmt.where(User.roles.any(Role.key == role))
    return stmt


@router.get("", summary="List users")
async def list_users(q: str | None = Query(None, max_length=100), status: str | None = Query(None, max_length=20),
                     role: str | None = Query(None, max_length=60),
                     sort: Literal["name", "-created", "created", "-last_login"] = "-created",
                     p: PageParams = Depends(page_params), _: Principal = Depends(require("users.view")),
                     db: AsyncSession = Depends(get_db)):
    order = {"name": User.full_name.asc(), "-created": User.created_at.desc(), "created": User.created_at.asc(),
             "-last_login": User.last_login_at.desc().nulls_last()}[sort]
    rows, meta = await paginate(db, _filtered(q, status, role).order_by(order, User.id), p)
    return {"data": [user_out(u) for u in rows], "meta": meta}


@router.get("/export", summary="Export users as CSV")
async def export_users(q: str | None = None, status: str | None = None, role: str | None = None,
                       me: Principal = Depends(require("users.export")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(_filtered(q, status, role).order_by(User.full_name))).scalars().all()
    await record(db, actor_id=me.id, action="export", entity="user", summary=f"Exported {len(rows)} users")
    await db.commit()
    return csv_response("users.csv", ["Name", "Email", "Phone", "Status", "Roles", "Last sign-in", "Created"],
                        ([u.full_name, u.email, u.phone or "", u.status, ", ".join(r.name for r in u.roles),
                          u.last_login_at.isoformat() if u.last_login_at else "", u.created_at.isoformat()] for u in rows))


class UserCreate(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=150)
    email: EmailStr
    phone: str | None = Field(None, pattern=r"^\+?[0-9 ()\-]{7,20}$")
    roles: list[str] = Field(..., min_length=1)
    password: str | None = Field(None, max_length=256)  # empty → a set-password link is emailed


class UserUpdate(BaseModel):
    full_name: str | None = Field(None, min_length=2, max_length=150)
    phone: str | None = Field(None, pattern=r"^\+?[0-9 ()\-]{7,20}$")
    roles: list[str] | None = None
    status: Literal["active", "deactivated", "pending"] | None = None


async def _roles(db: AsyncSession, keys: list[str], me: Principal) -> list[Role]:
    roles = (await db.execute(select(Role).where(Role.key.in_(keys)))).scalars().all()
    if len(roles) != len(set(keys)):
        raise AppError(422, "UNKNOWN_ROLE", "One or more roles do not exist.", [{"field": "roles", "message": "Unknown role."}])
    if SUPER_ADMIN in keys and not me.is_super:
        raise forbidden("Only a Super Administrator can grant the Super Administrator role.")
    return list(roles)


async def _super_count(db: AsyncSession) -> int:
    return (await db.execute(select(func.count()).select_from(User).where(
        User.deleted_at.is_(None), User.status == "active", User.roles.any(Role.key == SUPER_ADMIN)))).scalar_one()


@router.post("", status_code=201, summary="Create a user")
async def create_user(body: UserCreate, request: Request, me: Principal = Depends(require("users.create")),
                      db: AsyncSession = Depends(get_db)):
    exists = (await db.execute(select(User.id).where(func.lower(User.email) == body.email.lower(),
                                                     User.deleted_at.is_(None)))).first()
    if exists:
        raise conflict("EMAIL_TAKEN", "A user with this email already exists.")
    roles = await _roles(db, body.roles, me)
    sec = await settings_store.get_group(db, "security")
    now = datetime.now(UTC)
    if body.password:
        if problems := password_problems(body.password, sec):
            raise AppError(422, "WEAK_PASSWORD", "Password must contain " + ", ".join(problems) + ".",
                           [{"field": "password", "message": "Password must contain " + ", ".join(problems) + "."}])
        pw = hash_password(body.password)
    else:
        pw = hash_password(random_token(32))  # unusable until the user sets one via the emailed link
    user = User(full_name=body.full_name.strip(), email=body.email.lower(), phone=body.phone, password_hash=pw,
                status="active", email_verified_at=now, password_changed_at=now if body.password else None, roles=roles)
    db.add(user)
    await db.flush()
    if not body.password:
        from datetime import timedelta

        from ...services import messaging

        token = random_token(32)
        await auth_svc.create_verification(db, user, "password_reset", token_hash(token), timedelta(days=3))
        general = await settings_store.get_group(db, "general")
        await messaging.queue_email(db, user.email, "auth.password_reset", {
            "name": user.full_name, "link": f"{general.app_url}/reset-password?token={token}", "minutes": 4320})
    await record(db, actor_id=me.id, action="create", entity="user", entity_id=user.id,
                 summary=f"Created user {user.email} ({', '.join(r.name for r in roles)})", ip=client_ip(request))
    return {"data": user_out(user)}


@router.get("/{user_id}", summary="Get a user")
async def get_user(user_id: uuid.UUID, _: Principal = Depends(require("users.view")), db: AsyncSession = Depends(get_db)):
    u = await db.get(User, user_id)
    if not u or u.deleted_at:
        raise not_found("User")
    return {"data": user_out(u)}


@router.patch("/{user_id}", summary="Update a user (name, phone, roles, status)")
async def update_user(user_id: uuid.UUID, body: UserUpdate, request: Request,
                      me: Principal = Depends(require("users.edit")), db: AsyncSession = Depends(get_db)):
    u = await db.get(User, user_id)
    if not u or u.deleted_at:
        raise not_found("User")
    is_super_target = any(r.key == SUPER_ADMIN for r in u.roles)
    if is_super_target and not me.is_super:
        raise forbidden("Only a Super Administrator can change a Super Administrator.")
    changes = {}
    if body.full_name is not None:
        u.full_name, changes["full_name"] = body.full_name.strip(), body.full_name.strip()
    if body.phone is not None:
        if body.phone != u.phone:
            u.phone_verified_at = None
        u.phone, changes["phone"] = body.phone, body.phone
    if body.roles is not None:
        roles = await _roles(db, body.roles, me)
        if is_super_target and SUPER_ADMIN not in body.roles and await _super_count(db) <= 1:
            raise conflict("LAST_SUPER_ADMIN", "At least one active Super Administrator must remain.")
        if u.id == me.id and SUPER_ADMIN in me.roles and SUPER_ADMIN not in body.roles:
            raise conflict("SELF_DEMOTION", "You cannot remove your own Super Administrator role.")
        u.roles, changes["roles"] = roles, body.roles
    if body.status is not None and body.status != u.status:
        if u.id == me.id and body.status == "deactivated":
            raise conflict("SELF_DEACTIVATION", "You cannot deactivate your own account.")
        if is_super_target and body.status == "deactivated" and await _super_count(db) <= 1:
            raise conflict("LAST_SUPER_ADMIN", "At least one active Super Administrator must remain.")
        u.status, changes["status"] = body.status, body.status
        if body.status == "deactivated":
            await auth_svc.revoke_all(db, u.id)
    forget_principals(u.id)
    await record(db, actor_id=me.id, action="update", entity="user", entity_id=u.id,
                 summary=f"Updated user {u.email}", data=changes, ip=client_ip(request))
    return {"data": user_out(u)}


@router.post("/{user_id}/unlock", summary="Clear a sign-in lockout")
async def unlock(user_id: uuid.UUID, request: Request, me: Principal = Depends(require("users.edit")),
                 db: AsyncSession = Depends(get_db)):
    u = await db.get(User, user_id)
    if not u or u.deleted_at:
        raise not_found("User")
    u.locked_until = None
    await record(db, actor_id=me.id, action="unlock", entity="user", entity_id=u.id, summary=f"Unlocked {u.email}",
                 ip=client_ip(request))
    return {"data": user_out(u)}


@router.post("/{user_id}/sign-out", summary="End all sessions of a user")
async def sign_out(user_id: uuid.UUID, request: Request, me: Principal = Depends(require("users.edit")),
                   db: AsyncSession = Depends(get_db)):
    u = await db.get(User, user_id)
    if not u or u.deleted_at:
        raise not_found("User")
    n = await auth_svc.revoke_all(db, u.id)
    await record(db, actor_id=me.id, action="sign_out", entity="user", entity_id=u.id,
                 summary=f"Ended {n} session(s) of {u.email}", ip=client_ip(request))
    return {"data": {"sessions_ended": n}}


@router.post("/{user_id}/reset-mfa", summary="Turn off two-factor authentication for a user who lost their device")
async def reset_mfa(user_id: uuid.UUID, request: Request, me: Principal = Depends(require("users.edit")),
                    db: AsyncSession = Depends(get_db)):
    u = await db.get(User, user_id)
    if not u or u.deleted_at:
        raise not_found("User")
    if any(r.key == SUPER_ADMIN for r in u.roles) and not me.is_super:
        raise forbidden()
    u.totp_enabled, u.totp_secret_enc, u.recovery_codes = False, None, None
    await auth_svc.revoke_all(db, u.id)
    await record(db, actor_id=me.id, action="reset_mfa", entity="user", entity_id=u.id,
                 summary=f"Reset two-factor authentication of {u.email}", ip=client_ip(request))
    return {"data": user_out(u)}


@router.delete("/{user_id}", summary="Delete a user (soft delete)")
async def delete_user(user_id: uuid.UUID, request: Request, me: Principal = Depends(require("users.delete")),
                      db: AsyncSession = Depends(get_db)):
    u = await db.get(User, user_id)
    if not u or u.deleted_at:
        raise not_found("User")
    if u.id == me.id:
        raise conflict("SELF_DELETE", "You cannot delete your own account here.")
    if any(r.key == SUPER_ADMIN for r in u.roles):
        if not me.is_super:
            raise forbidden()
        if await _super_count(db) <= 1:
            raise conflict("LAST_SUPER_ADMIN", "At least one active Super Administrator must remain.")
    u.deleted_at, u.status = datetime.now(UTC), "deactivated"
    await auth_svc.revoke_all(db, u.id)
    await record(db, actor_id=me.id, action="delete", entity="user", entity_id=u.id, summary=f"Deleted user {u.email}",
                 ip=client_ip(request))
    return {"data": {"ok": True}}
