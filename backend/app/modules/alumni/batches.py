"""Batch management (graduating classes)."""

import uuid

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.audit import record
from ...core.db import get_db
from ...core.deps import Principal, client_ip, require
from ...core.errors import conflict, not_found
from ...models import AlumniProfile, Batch, User
from .schemas import fail

router = APIRouter(prefix="/api/v1/admin/batches", tags=["Admin: batches"])


class BatchIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    graduation_year: int = Field(..., ge=1900, le=2100)
    admission_year: int | None = Field(None, ge=1900, le=2100)
    description: str = Field("", max_length=500)
    coordinator_id: uuid.UUID | None = None
    is_active: bool = True


class GenerateIn(BaseModel):
    from_year: int = Field(..., ge=1900, le=2100)
    to_year: int = Field(..., ge=1900, le=2100)
    pattern: str = Field("Class of {year}", min_length=6, max_length=80)


async def _counts(db: AsyncSession, ids: list[uuid.UUID]) -> dict:
    if not ids:
        return {}
    rows = (
        await db.execute(
            select(AlumniProfile.batch_id, AlumniProfile.verification_status, func.count())
            .join(User, User.id == AlumniProfile.user_id)
            .where(AlumniProfile.batch_id.in_(ids), User.deleted_at.is_(None))
            .group_by(AlumniProfile.batch_id, AlumniProfile.verification_status)
        )
    ).all()
    out: dict = {}
    for bid, status, n in rows:
        c = out.setdefault(bid, {"members": 0, "verified": 0, "pending": 0})
        c["members"] += n
        if status in ("verified", "pending"):
            c[status] += n
    return out


async def _out(db: AsyncSession, b: Batch, counts: dict | None = None) -> dict:
    c = (counts or await _counts(db, [b.id])).get(b.id, {"members": 0, "verified": 0, "pending": 0})
    coord = await db.get(User, b.coordinator_id) if b.coordinator_id else None
    return {
        "id": str(b.id),
        "name": b.name,
        "graduation_year": b.graduation_year,
        "admission_year": b.admission_year,
        "description": b.description,
        "is_active": b.is_active,
        "coordinator": {"id": str(coord.id), "full_name": coord.full_name, "email": coord.email} if coord else None,
        **c,
        "created_at": b.created_at,
    }


@router.get("", summary="List batches with member counts")
async def list_batches(
    q: str | None = Query(None, max_length=100), _: Principal = Depends(require("batches.view")), db: AsyncSession = Depends(get_db)
):
    stmt = select(Batch).order_by(Batch.graduation_year.desc(), Batch.name)
    if q:
        stmt = stmt.where(func.lower(Batch.name).like(f"%{q.strip().lower()}%"))
    rows = (await db.execute(stmt)).scalars().all()
    counts = await _counts(db, [b.id for b in rows])
    unassigned = (
        await db.execute(
            select(func.count())
            .select_from(AlumniProfile)
            .join(User, User.id == AlumniProfile.user_id)
            .where(AlumniProfile.batch_id.is_(None), User.deleted_at.is_(None))
        )
    ).scalar_one()
    return {"data": [await _out(db, b, counts) for b in rows], "meta": {"unassigned": unassigned}}


async def _check(db: AsyncSession, body: BatchIn, current: uuid.UUID | None = None) -> None:
    dup = (await db.execute(select(Batch.id).where(func.lower(Batch.name) == body.name.strip().lower()))).scalar_one_or_none()
    if dup and dup != current:
        raise conflict("BATCH_EXISTS", f"A batch named “{body.name}” already exists.")
    if body.admission_year and body.admission_year > body.graduation_year:
        fail("admission_year", "Admission must be before graduation.")
    if body.coordinator_id:
        u = await db.get(User, body.coordinator_id)
        if not u or u.deleted_at:
            fail("coordinator_id", "This member does not exist.")


@router.post("", status_code=201, summary="Create a batch")
async def create_batch(
    body: BatchIn, request: Request, me: Principal = Depends(require("batches.create")), db: AsyncSession = Depends(get_db)
):
    await _check(db, body)
    b = Batch(**{**body.model_dump(), "name": body.name.strip()})
    db.add(b)
    await db.flush()
    await settings_store.changed()
    await record(
        db, actor_id=me.id, action="create", entity="batch", entity_id=b.id, summary=f"Created batch {b.name}", ip=client_ip(request)
    )
    return {"data": await _out(db, b)}


@router.post("/generate", status_code=201, summary="Create one batch per graduation year in a range")
async def generate(
    body: GenerateIn, request: Request, me: Principal = Depends(require("batches.create")), db: AsyncSession = Depends(get_db)
):
    if body.to_year < body.from_year or body.to_year - body.from_year > 100:
        fail("to_year", "Choose a range of at most 100 years, oldest first.")
    if "{year}" not in body.pattern:
        fail("pattern", "The name pattern must contain {year}.")
    have = {n.lower() for n in (await db.execute(select(Batch.name))).scalars()}
    created = []
    for y in range(body.from_year, body.to_year + 1):
        name = body.pattern.replace("{year}", str(y)).strip()[:100]
        if name.lower() not in have:
            db.add(Batch(name=name, graduation_year=y, description=""))
            created.append(name)
    await db.flush()
    # Members of those years without a batch join the new batch when it is the only one for their year.
    for y in range(body.from_year, body.to_year + 1):
        ids = (await db.execute(select(Batch.id).where(Batch.graduation_year == y))).scalars().all()
        if len(ids) == 1:
            await db.execute(
                AlumniProfile.__table__.update()
                .where(AlumniProfile.graduation_year == y, AlumniProfile.batch_id.is_(None))
                .values(batch_id=ids[0])
            )
    await settings_store.changed()
    await record(
        db,
        actor_id=me.id,
        action="create",
        entity="batch",
        summary=f"Created {len(created)} batches ({body.from_year}–{body.to_year})",
        ip=client_ip(request),
    )
    return {"data": {"created": created}}


@router.put("/{batch_id}", summary="Update a batch")
async def update_batch(
    batch_id: uuid.UUID,
    body: BatchIn,
    request: Request,
    me: Principal = Depends(require("batches.edit")),
    db: AsyncSession = Depends(get_db),
):
    b = await db.get(Batch, batch_id)
    if not b:
        raise not_found("Batch")
    await _check(db, body, b.id)
    if body.graduation_year != b.graduation_year:
        n = (await db.execute(select(func.count()).select_from(AlumniProfile).where(AlumniProfile.batch_id == b.id))).scalar_one()
        if n:
            fail("graduation_year", f"{n} member(s) belong to this batch; their graduation year would no longer match.")
    for k, v in body.model_dump().items():
        setattr(b, k, v.strip() if isinstance(v, str) else v)
    await settings_store.changed()
    await record(
        db, actor_id=me.id, action="update", entity="batch", entity_id=b.id, summary=f"Updated batch {b.name}", ip=client_ip(request)
    )
    return {"data": await _out(db, b)}


@router.delete("/{batch_id}", summary="Delete a batch (members keep their graduation year)")
async def delete_batch(
    batch_id: uuid.UUID, request: Request, me: Principal = Depends(require("batches.delete")), db: AsyncSession = Depends(get_db)
):
    b = await db.get(Batch, batch_id)
    if not b:
        raise not_found("Batch")
    await db.delete(b)
    await settings_store.changed()
    await record(
        db, actor_id=me.id, action="delete", entity="batch", entity_id=batch_id, summary=f"Deleted batch {b.name}", ip=client_ip(request)
    )
    return {"data": {"ok": True}}
