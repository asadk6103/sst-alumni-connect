"""Featured alumni achievements: nominations → review → publication (portal; public website with the member's consent)."""

import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.audit import record
from ...core.db import get_db
from ...core.deps import Principal, client_ip, require, require_module
from ...core.errors import AppError, conflict, forbidden, not_found
from ...core.pagination import PageParams, page_params
from ...core.redis import enforce
from ...models import Achievement, AlumniProfile, Media, User
from ...services import notifications
from ..alumni import service as alumni
from ..community.service import authors
from ..events.service import image

router = APIRouter(prefix="/api/v1/achievements", tags=["Achievements"], dependencies=[Depends(require_module("achievements"))])
admin = APIRouter(prefix="/api/v1/admin/achievements", tags=["Admin: achievements"])
public = APIRouter(prefix="/api/v1/public/achievements", tags=["Public"])
KINDS = Literal["distinguished", "alumni_of_month", "success_story", "award", "milestone"]
LABELS = {
    "distinguished": "Distinguished alumni",
    "alumni_of_month": "Alumni of the month",
    "success_story": "Success story",
    "award": "Award",
    "milestone": "Professional milestone",
}


def _meta(p: PageParams, total: int) -> dict:
    return {"page": p.page, "page_size": p.page_size, "total": total, "pages": max(1, -(-total // p.page_size))}


async def out(db: AsyncSession, a: Achievement, people: dict | None = None, staff: bool = False, public_view: bool = False) -> dict:
    people = people if people is not None else await authors(db, {a.user_id, a.nominated_by})
    person = people.get(a.user_id)
    if public_view and person:  # public website: name, photo and batch only
        person = {k: person.get(k) for k in ("full_name", "photo", "batch")}
    data = {
        "id": str(a.id),
        "kind": a.kind,
        "kind_label": LABELS.get(a.kind, a.kind),
        "title": a.title,
        "summary": a.summary,
        "story": a.story,
        "image": await image(db, a.image_id),
        "year": a.year,
        "month": a.month,
        "featured": a.featured,
        "person": person,
        "published_at": a.published_at,
    }
    if not public_view:
        data.update({"status": a.status, "public_consent": a.public_consent})
    if staff:
        data.update(
            {
                "nominated_by": people.get(a.nominated_by),
                "nomination_reason": a.nomination_reason,
                "rejection_reason": a.rejection_reason,
                "image_id": str(a.image_id) if a.image_id else None,
                "user_id": str(a.user_id),
                "created_at": a.created_at,
            }
        )
    return data


# ── members ─────────────────────────────────────────────────────────────────
@router.get("", summary="Published alumni achievements")
async def list_published(
    kind: KINDS | None = None,
    q: str | None = Query(None, max_length=100),
    featured: bool = False,
    p: PageParams = Depends(page_params),
    me: Principal = Depends(require("portal.access")),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Achievement).join(User, User.id == Achievement.user_id).where(Achievement.status == "published", User.deleted_at.is_(None))
    )
    if kind:
        stmt = stmt.where(Achievement.kind == kind)
    if featured:
        stmt = stmt.where(Achievement.featured.is_(True))
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(Achievement.title).like(like), func.lower(User.full_name).like(like)))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        (
            await db.execute(
                stmt.order_by(Achievement.featured.desc(), Achievement.published_at.desc())
                .offset((p.page - 1) * p.page_size)
                .limit(p.page_size)
            )
        )
        .scalars()
        .all()
    )
    people = await authors(db, {a.user_id for a in rows})
    return {"data": [await out(db, a, people) for a in rows], "meta": _meta(p, total)}


class NominationIn(BaseModel):
    user_id: uuid.UUID
    kind: KINDS
    title: str = Field(..., min_length=5, max_length=200)
    reason: str = Field(..., min_length=30, max_length=2000)
    year: int | None = Field(None, ge=1950, le=2100)


@router.post("/nominations", status_code=201, summary="Nominate an alumnus (yourself included)")
async def nominate(body: NominationIn, me: Principal = Depends(require("portal.nominate")), db: AsyncSession = Depends(get_db)):
    await enforce(f"nominate:{me.id}", 10, 86400, "You have sent many nominations today.")
    prof = await db.get(AlumniProfile, body.user_id)
    u = await db.get(User, body.user_id)
    if not prof or not u or u.deleted_at or prof.verification_status != "verified":
        raise AppError(
            422, "VALIDATION_ERROR", "Only verified alumni can be nominated.", [{"field": "user_id", "message": "Not eligible."}]
        )
    if body.user_id != me.id:
        viewer = alumni.Viewer(me, await alumni.connected_ids(db, me.id, [body.user_id]))
        if not viewer.can_see_profile(prof):
            raise not_found("Member")
    a = Achievement(
        user_id=body.user_id,
        kind=body.kind,
        title=body.title.strip(),
        summary="",
        story="",
        year=body.year,
        nomination_reason=body.reason.strip(),
        nominated_by=me.id,
        status="nominated",
    )
    db.add(a)
    await db.flush()
    return {"data": await out(db, a)}


@router.get("/nominations/mine", summary="Nominations you made and achievements about you")
async def my_nominations(me: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    rows = (
        (
            await db.execute(
                select(Achievement)
                .where(or_(Achievement.nominated_by == me.id, Achievement.user_id == me.id))
                .order_by(Achievement.created_at.desc())
                .limit(100)
            )
        )
        .scalars()
        .all()
    )
    people = await authors(db, {a.user_id for a in rows})
    return {
        "data": [
            {
                **await out(db, a, people),
                "about_me": a.user_id == me.id,
                "rejection_reason": a.rejection_reason if a.nominated_by == me.id else None,
            }
            for a in rows
        ]
    }


class ConsentIn(BaseModel):
    public: bool


@router.post("/{achievement_id}/consent", summary="Allow (or not) your achievement on the public website")
async def consent(
    achievement_id: uuid.UUID, body: ConsentIn, me: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)
):
    a = await db.get(Achievement, achievement_id)
    if not a or a.user_id != me.id:
        raise not_found("Achievement")
    a.public_consent = body.public
    return {"data": await out(db, a)}


@router.get("/{achievement_id}", summary="An achievement")
async def get_one(achievement_id: uuid.UUID, me: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    a = await db.get(Achievement, achievement_id)
    if not a or (a.status != "published" and me.id not in (a.user_id, a.nominated_by) and not me.can("achievements.view")):
        raise not_found("Achievement")
    return {"data": await out(db, a, staff=me.can("achievements.view"))}


# ── public website ──────────────────────────────────────────────────────────
@public.get("", summary="Published achievements the members agreed to show publicly")
async def public_list(kind: KINDS | None = None, limit: int = Query(12, ge=1, le=50), db: AsyncSession = Depends(get_db)):
    mods = await settings_store.modules(db)
    if not mods.get("achievements", True):
        return {"data": []}
    stmt = (
        select(Achievement)
        .join(User, User.id == Achievement.user_id)
        .where(Achievement.status == "published", Achievement.public_consent.is_(True), User.deleted_at.is_(None))
    )
    if kind:
        stmt = stmt.where(Achievement.kind == kind)
    rows = (await db.execute(stmt.order_by(Achievement.featured.desc(), Achievement.published_at.desc()).limit(limit))).scalars().all()
    people = await authors(db, {a.user_id for a in rows})
    return {"data": [await out(db, a, people, public_view=True) for a in rows]}


# ── review ──────────────────────────────────────────────────────────────────
@admin.get("", summary="Nominations and achievements")
async def admin_list(
    status: Literal["nominated", "approved", "published", "rejected"] | None = None,
    kind: KINDS | None = None,
    p: PageParams = Depends(page_params),
    me: Principal = Depends(require("achievements.view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Achievement)
    if status:
        stmt = stmt.where(Achievement.status == status)
    if kind:
        stmt = stmt.where(Achievement.kind == kind)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        (await db.execute(stmt.order_by(Achievement.created_at.desc()).offset((p.page - 1) * p.page_size).limit(p.page_size)))
        .scalars()
        .all()
    )
    people = await authors(db, {a.user_id for a in rows} | {a.nominated_by for a in rows})
    counts = dict((await db.execute(select(Achievement.status, func.count()).group_by(Achievement.status))).all())
    return {"data": [await out(db, a, people, staff=True) for a in rows], "meta": {**_meta(p, total), "counts": counts}}


class AchievementIn(BaseModel):
    user_id: uuid.UUID
    kind: KINDS
    title: str = Field(..., min_length=5, max_length=200)
    summary: str = Field("", max_length=500)
    story: str = Field("", max_length=20000)
    image_id: uuid.UUID | None = None
    year: int | None = Field(None, ge=1950, le=2100)
    month: int | None = Field(None, ge=1, le=12)
    featured: bool = False


async def _check(db: AsyncSession, body: AchievementIn) -> None:
    if not await db.get(User, body.user_id):
        raise AppError(422, "VALIDATION_ERROR", "Unknown member.", [{"field": "user_id", "message": "Unknown member."}])
    if body.image_id:
        m = await db.get(Media, body.image_id)
        if not m or m.private or not m.mime.startswith("image/"):
            raise AppError(
                422, "VALIDATION_ERROR", "Choose an image from the media library.", [{"field": "image_id", "message": "Not an image."}]
            )
    if body.kind == "alumni_of_month" and not (body.year and body.month):
        raise AppError(422, "VALIDATION_ERROR", "Alumni of the month needs a month and year.", [{"field": "month", "message": "Required."}])


@admin.post("", status_code=201, summary="Add an achievement directly")
async def create(
    body: AchievementIn, request: Request, me: Principal = Depends(require("achievements.create")), db: AsyncSession = Depends(get_db)
):
    await _check(db, body)
    a = Achievement(**body.model_dump(), status="approved", nominated_by=me.id, reviewed_by=me.id)
    db.add(a)
    await db.flush()
    await record(
        db,
        actor_id=me.id,
        action="create",
        entity="achievement",
        entity_id=a.id,
        summary=f"Added achievement {a.title}",
        ip=client_ip(request),
    )
    return {"data": await out(db, a, staff=True)}


@admin.put("/{achievement_id}", summary="Edit an achievement (story, image, featuring)")
async def edit(
    achievement_id: uuid.UUID,
    body: AchievementIn,
    me: Principal = Depends(require("achievements.edit")),
    db: AsyncSession = Depends(get_db),
):
    a = await db.get(Achievement, achievement_id)
    if not a:
        raise not_found("Achievement")
    await _check(db, body)
    if body.user_id != a.user_id:
        a.public_consent = None
    for k, v in body.model_dump().items():
        setattr(a, k, v)
    return {"data": await out(db, a, staff=True)}


class ReviewIn(BaseModel):
    action: Literal["approve", "publish", "unpublish", "reject"]
    reason: str | None = Field(None, max_length=300)


@admin.post("/{achievement_id}/review", summary="Approve, publish, unpublish or reject")
async def review(
    achievement_id: uuid.UUID,
    body: ReviewIn,
    request: Request,
    me: Principal = Depends(require("achievements.view")),
    db: AsyncSession = Depends(get_db),
):
    need = {
        "approve": "achievements.approve",
        "publish": "achievements.publish",
        "unpublish": "achievements.publish",
        "reject": "achievements.reject",
    }
    if not me.can(need[body.action]):
        raise forbidden()
    a = await db.get(Achievement, achievement_id)
    if not a:
        raise not_found("Achievement")
    if body.action == "publish":
        if not a.summary and not a.story:
            raise conflict("INCOMPLETE", "Write a summary or story before publishing.")
        if a.kind == "alumni_of_month" and a.featured:
            # only one featured alumnus of the month at a time
            for other in (
                await db.execute(
                    select(Achievement).where(Achievement.kind == "alumni_of_month", Achievement.featured.is_(True), Achievement.id != a.id)
                )
            ).scalars():
                other.featured = False
        a.status, a.published_at = "published", datetime.now(UTC)
    elif body.action == "unpublish":
        a.status = "approved"
    elif body.action == "approve":
        a.status = "approved"
    else:
        if not body.reason:
            raise AppError(422, "VALIDATION_ERROR", "Give a reason.", [{"field": "reason", "message": "Required."}])
        a.status, a.rejection_reason = "rejected", body.reason
    a.reviewed_by = me.id
    if body.action == "publish":
        u = await db.get(User, a.user_id)
        general = await settings_store.get_group(db, "general")
        await notifications.notify(
            db,
            u.id,
            "achievements",
            "published",
            f"Your achievement was published: {a.title}",
            link=f"/portal/achievements/{a.id}",
            email=(
                "achievements.published",
                {"title": a.title, "kind": LABELS.get(a.kind, a.kind), "link": f"{general.app_url}/portal/achievements/{a.id}"},
            ),
        )
    await record(
        db,
        actor_id=me.id,
        action=body.action,
        entity="achievement",
        entity_id=a.id,
        summary=f"Achievement {a.title}: {body.action}",
        data={"reason": body.reason},
        ip=client_ip(request),
    )
    return {"data": await out(db, a, staff=True)}


@admin.delete("/{achievement_id}", summary="Delete an achievement")
async def delete(
    achievement_id: uuid.UUID, request: Request, me: Principal = Depends(require("achievements.delete")), db: AsyncSession = Depends(get_db)
):
    a = await db.get(Achievement, achievement_id)
    if not a:
        raise not_found("Achievement")
    await db.delete(a)
    await record(
        db,
        actor_id=me.id,
        action="delete",
        entity="achievement",
        entity_id=achievement_id,
        summary=f"Deleted achievement {a.title}",
        ip=client_ip(request),
    )
    return {"data": {"ok": True}}
