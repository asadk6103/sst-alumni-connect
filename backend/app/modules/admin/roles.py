import re
import uuid

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ...core.audit import record
from ...core.db import get_db
from ...core.deps import Principal, client_ip, forget_principals, require
from ...core.errors import AppError, conflict, forbidden, not_found
from ...core.permissions import ADMIN_MODULES, PORTAL_PERMISSIONS, SUPER_ADMIN
from ...models import Permission, Role, user_roles

router = APIRouter(prefix="/api/v1/admin/roles", tags=["Admin: roles and permissions"])


async def role_out(db: AsyncSession, r: Role) -> dict:
    count = (await db.execute(select(func.count()).select_from(user_roles).where(user_roles.c.role_id == r.id))).scalar_one()
    return {"id": str(r.id), "key": r.key, "name": r.name, "description": r.description, "is_system": r.is_system,
            "is_staff": r.is_staff, "permissions": sorted(p.key for p in r.permissions), "user_count": count}


@router.get("/catalogue", summary="All permissions grouped by module")
async def catalogue(_: Principal = Depends(require("roles.view"))):
    return {"data": {
        "admin": [{"module": m, "label": label, "actions": actions} for m, (label, actions) in ADMIN_MODULES.items()],
        "portal": [{"key": k, "label": v} for k, v in PORTAL_PERMISSIONS.items()],
    }}


@router.get("", summary="List roles")
async def list_roles(_: Principal = Depends(require("roles.view")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Role).options(selectinload(Role.permissions))
                             .order_by(Role.is_system.desc(), Role.is_staff.desc(), Role.name))).scalars().all()
    return {"data": [await role_out(db, r) for r in rows]}


class RoleIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    description: str = Field("", max_length=255)
    is_staff: bool = False
    permissions: list[str] = Field(default_factory=list)


async def _perms(db: AsyncSession, keys: list[str]) -> list[Permission]:
    rows = (await db.execute(select(Permission).where(Permission.key.in_(keys)))).scalars().all()
    if len(rows) != len(set(keys)):
        raise AppError(422, "UNKNOWN_PERMISSION", "Unknown permission(s).")
    return list(rows)


def _guard_escalation(me: Principal, keys: list[str]) -> None:
    """Admins may only hand out permissions they hold themselves."""
    if me.is_super:
        return
    extra = [k for k in keys if k not in me.permissions]
    if extra:
        raise forbidden(f"You cannot grant permissions you do not have: {', '.join(sorted(extra)[:5])}")


@router.post("", status_code=201, summary="Create a custom role")
async def create_role(body: RoleIn, request: Request, me: Principal = Depends(require("roles.create")),
                      db: AsyncSession = Depends(get_db)):
    key = re.sub(r"[^a-z0-9]+", "_", body.name.lower()).strip("_")[:50] or "role"
    if (await db.execute(select(Role.id).where(Role.key == key))).first():
        key = f"{key}_{uuid.uuid4().hex[:6]}"
    _guard_escalation(me, body.permissions)
    role = Role(key=key, name=body.name.strip(), description=body.description, is_staff=body.is_staff, is_system=False,
                permissions=await _perms(db, body.permissions))
    db.add(role)
    await db.flush()
    await record(db, actor_id=me.id, action="create", entity="role", entity_id=role.id, summary=f"Created role {role.name}",
                 data={"permissions": body.permissions}, ip=client_ip(request))
    return {"data": await role_out(db, role)}


@router.put("/{role_id}", summary="Update a role's name, description and permissions")
async def update_role(role_id: uuid.UUID, body: RoleIn, request: Request, me: Principal = Depends(require("roles.edit")),
                      db: AsyncSession = Depends(get_db)):
    role = await db.get(Role, role_id, options=[selectinload(Role.permissions)])
    if not role:
        raise not_found("Role")
    if role.key == SUPER_ADMIN:
        raise conflict("PROTECTED_ROLE", "The Super Administrator role always has every permission.")
    before = sorted(p.key for p in role.permissions)
    changed = set(before) ^ set(body.permissions)
    _guard_escalation(me, list(changed))
    if not role.is_system:
        role.name, role.is_staff = body.name.strip(), body.is_staff
    role.description = body.description
    role.permissions = await _perms(db, body.permissions)
    forget_principals()
    await record(db, actor_id=me.id, action="update", entity="role", entity_id=role.id,
                 summary=f"Updated role {role.name}",
                 data={"added": sorted(set(body.permissions) - set(before)), "removed": sorted(set(before) - set(body.permissions))},
                 ip=client_ip(request))
    return {"data": await role_out(db, role)}


@router.delete("/{role_id}", summary="Delete a custom role")
async def delete_role(role_id: uuid.UUID, request: Request, me: Principal = Depends(require("roles.delete")),
                      db: AsyncSession = Depends(get_db)):
    role = await db.get(Role, role_id, options=[selectinload(Role.permissions)])
    if not role:
        raise not_found("Role")
    if role.is_system:
        raise conflict("SYSTEM_ROLE", "Built-in roles cannot be deleted.")
    out = await role_out(db, role)
    if out["user_count"]:
        raise conflict("ROLE_IN_USE", f"{out['user_count']} user(s) still have this role. Reassign them first.")
    await db.delete(role)
    forget_principals()
    await record(db, actor_id=me.id, action="delete", entity="role", entity_id=role_id, summary=f"Deleted role {role.name}",
                 ip=client_ip(request))
    return {"data": {"ok": True}}
