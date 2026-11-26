"""Mentorship: mentor applications and approval, mentor directory, requests, sessions, outcomes, feedback."""

import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import Text, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from ...core import settings_store
from ...core.audit import record
from ...core.db import get_db
from ...core.deps import Principal, client_ip, require, require_module
from ...core.errors import AppError, conflict, forbidden, not_found
from ...core.pagination import PageParams, csv_response, page_params
from ...core.redis import enforce
from ...models import AlumniProfile, Mentor, MentorshipFeedback, MentorshipRequest, MentorshipSession, User
from ...services import custom_fields, live, notifications
from ..community.service import authors

router = APIRouter(prefix="/api/v1/mentorship", tags=["Mentorship"], dependencies=[Depends(require_module("mentorship"))])
admin = APIRouter(prefix="/api/v1/admin/mentorship", tags=["Admin: mentorship"])
member = require("portal.access")
FORMATS = Literal["video", "phone", "in_person", "chat"]
CATEGORIES = Literal["career", "higher_studies", "industry", "leadership", "entrepreneurship", "technology", "management", "other"]


def _meta(p: PageParams, total: int) -> dict:
    return {"page": p.page, "page_size": p.page_size, "total": total, "pages": max(1, -(-total // p.page_size))}


def now() -> datetime:
    return datetime.now(UTC)


async def _ratings(db: AsyncSession, mentor_ids: list[uuid.UUID]) -> dict:
    if not mentor_ids:
        return {}
    rows = (
        await db.execute(
            select(MentorshipRequest.mentor_id, func.avg(MentorshipFeedback.rating), func.count(MentorshipFeedback.id))
            .join(MentorshipFeedback, MentorshipFeedback.request_id == MentorshipRequest.id)
            .where(MentorshipRequest.mentor_id.in_(mentor_ids), MentorshipFeedback.from_user_id == MentorshipRequest.mentee_id)
            .group_by(MentorshipRequest.mentor_id)
        )
    ).all()
    return {m: (round(float(a), 1), n) for m, a, n in rows}


async def _active_mentees(db: AsyncSession, mentor_id: uuid.UUID) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(MentorshipRequest)
            .where(MentorshipRequest.mentor_id == mentor_id, MentorshipRequest.status == "accepted")
        )
    ).scalar_one()


async def mentor_out(db: AsyncSession, m: Mentor, people: dict | None = None, ratings: dict | None = None, full: bool = False) -> dict:
    people = people if people is not None else await authors(db, {m.user_id})
    rating = (ratings if ratings is not None else await _ratings(db, [m.user_id])).get(m.user_id)
    out = {
        "user": people.get(m.user_id),
        "status": m.status,
        "industry": m.industry,
        "expertise": m.expertise or [],
        "skills": m.skills or [],
        "experience_years": m.experience_years,
        "hours_per_month": m.hours_per_month,
        "formats": m.formats or [],
        "mentees_students": m.mentees_students,
        "mentees_alumni": m.mentees_alumni,
        "max_mentees": m.max_mentees,
        "introduction": m.introduction,
        "categories": m.categories or [],
        "mentee_count": (
            await db.execute(
                select(func.count())
                .select_from(MentorshipRequest)
                .where(MentorshipRequest.mentor_id == m.user_id, MentorshipRequest.status.in_(["accepted", "completed"]))
            )
        ).scalar_one(),
        "mentoring_since": m.approved_at,
        "rating": rating[0] if rating else None,
        "reviews": rating[1] if rating else 0,
        "active_mentees": await _active_mentees(db, m.user_id),
    }
    if full:
        out.update(
            {
                "rejection_reason": m.rejection_reason,
                "approved_at": m.approved_at,
                "created_at": m.created_at,
                "custom_fields": m.custom_fields or {},
            }
        )
    out["extra_fields"] = await custom_fields.visible_for(db, "mentor", m.custom_fields, "owner" if full else "member")
    out["available"] = m.status == "approved" and out["active_mentees"] < m.max_mentees
    return out


# ── becoming a mentor ───────────────────────────────────────────────────────
class MentorIn(BaseModel):
    industry: str = Field(..., min_length=2, max_length=100)
    expertise: list[str] = Field(..., min_length=1, max_length=15)
    skills: list[str] = Field(default_factory=list, max_length=25)
    experience_years: int | None = Field(None, ge=0, le=70)
    hours_per_month: int = Field(2, ge=1, le=80)
    formats: list[FORMATS] = Field(..., min_length=1)
    mentees_students: bool = True
    mentees_alumni: bool = True
    max_mentees: int = Field(3, ge=1, le=30)
    introduction: str = Field(..., min_length=30, max_length=3000)
    custom_fields: dict = Field(default_factory=dict)
    categories: list[CATEGORIES] = Field(default_factory=list, max_length=8)

    @field_validator("expertise", "skills")
    @classmethod
    def _clean(cls, v):
        return list(dict.fromkeys(s.strip()[:60] for s in v if s.strip()))


@router.get("/me", summary="Your mentor profile (if any) and mentorship summary")
async def me(me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    m = await db.get(Mentor, me.id)
    counts = dict(
        (
            await db.execute(
                select(MentorshipRequest.status, func.count())
                .where(or_(MentorshipRequest.mentor_id == me.id, MentorshipRequest.mentee_id == me.id))
                .group_by(MentorshipRequest.status)
            )
        ).all()
    )
    return {
        "data": {
            "mentor": await mentor_out(db, m, full=True) if m else None,
            "counts": counts,
            "can_apply": me.can("portal.mentorship.mentor"),
            "can_request": me.can("portal.mentorship.request"),
        }
    }


@router.put("/me", summary="Apply to become a mentor, or update your mentor profile")
async def apply_mentor(
    body: MentorIn, request: Request, me: Principal = Depends(require("portal.mentorship.mentor")), db: AsyncSession = Depends(get_db)
):
    if not body.mentees_students and not body.mentees_alumni:
        raise AppError(
            422, "VALIDATION_ERROR", "Choose who you would like to mentor.", [{"field": "mentees_students", "message": "Required."}]
        )
    m = await db.get(Mentor, me.id)
    new = m is None
    if new:
        m = Mentor(user_id=me.id, status="pending")
        db.add(m)
    for k, v in body.model_dump(exclude={"custom_fields"}).items():
        setattr(m, k, v)
    m.custom_fields = await custom_fields.clean(db, "mentor", body.custom_fields, m.custom_fields, actor=me.id)
    if m.status == "rejected":
        m.status, m.rejection_reason = "pending", None
    await db.flush()
    if new:
        await record(
            db,
            actor_id=me.id,
            action="apply",
            entity="mentor",
            entity_id=me.id,
            summary="Applied to become a mentor",
            ip=client_ip(request),
        )
    return {"data": await mentor_out(db, m, full=True)}


class PauseIn(BaseModel):
    paused: bool


@router.post("/me/availability", summary="Pause or resume taking new mentees")
async def availability(body: PauseIn, me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    m = await db.get(Mentor, me.id)
    if not m or m.status not in ("approved", "paused"):
        raise conflict("NOT_MENTOR", "You are not an approved mentor.")
    m.status = "paused" if body.paused else "approved"
    return {"data": await mentor_out(db, m, full=True)}


# ── finding a mentor ────────────────────────────────────────────────────────
@router.get("/mentors", summary="Find a mentor (by industry, expertise, name)")
async def mentors(
    q: str | None = Query(None, max_length=100),
    industry: str | None = Query(None, max_length=100),
    expertise: str | None = Query(None, max_length=60),
    category: CATEGORIES | None = None,
    format: FORMATS | None = None,
    available: bool = False,
    p: PageParams = Depends(page_params),
    me: Principal = Depends(member),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Mentor)
        .join(User, User.id == Mentor.user_id)
        .where(Mentor.status == "approved", User.deleted_at.is_(None), User.status == "active", Mentor.user_id != me.id)
    )
    prof = await db.get(AlumniProfile, me.id)
    if prof and prof.kind == "student":
        stmt = stmt.where(Mentor.mentees_students.is_(True))
    else:
        stmt = stmt.where(Mentor.mentees_alumni.is_(True))
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(User.full_name).like(like),
                func.lower(cast(Mentor.expertise, Text)).like(like),
                func.lower(cast(Mentor.skills, Text)).like(like),
                func.lower(Mentor.industry).like(like),
            )
        )
    if industry:
        stmt = stmt.where(func.lower(Mentor.industry) == industry.strip().lower())
    if expertise:
        stmt = stmt.where(func.lower(cast(Mentor.expertise, Text)).like(f"%{expertise.strip().lower()}%"))
    if format:
        stmt = stmt.where(Mentor.formats.contains([format]))
    if category:
        stmt = stmt.where(Mentor.categories.contains([category]))
    if available:
        m2 = aliased(Mentor)  # independent of the outer query
        full = (
            select(MentorshipRequest.mentor_id)
            .join(m2, m2.user_id == MentorshipRequest.mentor_id)
            .where(MentorshipRequest.status == "accepted")
            .group_by(MentorshipRequest.mentor_id, m2.max_mentees)
            .having(func.count() >= m2.max_mentees)
        )
        stmt = stmt.where(Mentor.user_id.not_in(full))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        (await db.execute(stmt.order_by(Mentor.approved_at.desc().nulls_last()).offset((p.page - 1) * p.page_size).limit(p.page_size)))
        .scalars()
        .all()
    )
    people = await authors(db, {m.user_id for m in rows})
    ratings = await _ratings(db, [m.user_id for m in rows])
    industries = [
        r
        for (r,) in (
            await db.execute(
                select(Mentor.industry)
                .where(Mentor.status == "approved", Mentor.industry.is_not(None))
                .group_by(Mentor.industry)
                .order_by(Mentor.industry)
            )
        ).all()
    ]
    mine = {
        r.mentor_id: {"id": str(r.id), "status": r.status}
        for r in (
            await db.execute(
                select(MentorshipRequest).where(
                    MentorshipRequest.mentee_id == me.id,
                    MentorshipRequest.mentor_id.in_([m.user_id for m in rows] or [uuid.UUID(int=0)]),
                    MentorshipRequest.status.in_(["pending", "accepted"]),
                )
            )
        ).scalars()
    }
    data = [{**await mentor_out(db, m, people, ratings), "my_request": mine.get(m.user_id)} for m in rows]
    return {"data": data, "meta": {**_meta(p, total), "industries": industries}}


@router.get("/mentors/{user_id}", summary="A mentor's profile")
async def mentor(user_id: uuid.UUID, me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    m = await db.get(Mentor, user_id)
    if not m or (m.status != "approved" and user_id != me.id and not me.can("mentorship.view")):
        raise not_found("Mentor")
    out = await mentor_out(db, m)
    rows = (
        (
            await db.execute(
                select(MentorshipFeedback)
                .join(MentorshipRequest, MentorshipRequest.id == MentorshipFeedback.request_id)
                .where(
                    MentorshipRequest.mentor_id == user_id,
                    MentorshipFeedback.from_user_id == MentorshipRequest.mentee_id,
                    MentorshipFeedback.comment.is_not(None),
                )
                .order_by(MentorshipFeedback.created_at.desc())
                .limit(10)
            )
        )
        .scalars()
        .all()
    )
    people = await authors(db, {r.from_user_id for r in rows})
    out["testimonials"] = [
        {"rating": r.rating, "comment": r.comment, "from": people.get(r.from_user_id), "created_at": r.created_at} for r in rows
    ]
    open_ = (
        await db.execute(
            select(MentorshipRequest).where(
                MentorshipRequest.mentor_id == user_id,
                MentorshipRequest.mentee_id == me.id,
                MentorshipRequest.status.in_(["pending", "accepted"]),
            )
        )
    ).scalar_one_or_none()
    out["my_request"] = {"id": str(open_.id), "status": open_.status} if open_ else None
    return {"data": out}


# ── requests ────────────────────────────────────────────────────────────────
class RequestIn(BaseModel):
    mentor_id: uuid.UUID
    topic: str = Field(..., min_length=3, max_length=200)
    goals: str = Field(..., min_length=20, max_length=3000)
    preferred_format: FORMATS | None = None


async def request_out(
    db: AsyncSession, me: Principal, r: MentorshipRequest, people: dict | None = None, with_sessions: bool = False
) -> dict:
    people = people if people is not None else await authors(db, {r.mentor_id, r.mentee_id})
    out = {
        "id": str(r.id),
        "mentor": people.get(r.mentor_id),
        "mentee": people.get(r.mentee_id),
        "topic": r.topic,
        "goals": r.goals,
        "preferred_format": r.preferred_format,
        "status": r.status,
        "initiated_by": r.initiated_by,
        "awaiting_me": r.status == "pending" and me.id == (r.mentor_id if r.initiated_by == "mentee" else r.mentee_id),
        "response_note": r.response_note,
        "created_at": r.created_at,
        "responded_at": r.responded_at,
        "completed_at": r.completed_at,
        "role": "mentor" if r.mentor_id == me.id else "mentee",
    }
    if with_sessions:
        sessions = (
            (
                await db.execute(
                    select(MentorshipSession).where(MentorshipSession.request_id == r.id).order_by(MentorshipSession.scheduled_at)
                )
            )
            .scalars()
            .all()
        )
        out["sessions"] = [session_out(s, r, me) for s in sessions]
        fb = (await db.execute(select(MentorshipFeedback).where(MentorshipFeedback.request_id == r.id))).scalars().all()
        out["feedback"] = {
            "mine": next(({"rating": f.rating, "comment": f.comment} for f in fb if f.from_user_id == me.id), None),
            "theirs": next(({"rating": f.rating, "comment": f.comment} for f in fb if f.from_user_id != me.id), None),
        }
    return out


def session_out(s: MentorshipSession, r: MentorshipRequest, me: Principal) -> dict:
    return {
        "id": str(s.id),
        "scheduled_at": s.scheduled_at,
        "duration_minutes": s.duration_minutes,
        "format": s.format,
        "location": s.location,
        "agenda": s.agenda,
        "status": s.status,
        "outcome": s.outcome if (r.mentor_id == me.id or r.mentee_id == me.id or me.can("mentorship.view")) else None,
    }


class _Blank(dict):
    def __missing__(self, key):
        return ""


TITLES = {
    "mentorship.request": "{from} asked you for mentorship",
    "mentorship.offer": "{from} offered to mentor you",
    "mentorship.offer_accepted": "{mentee} accepted your mentorship offer",
    "mentorship.offer_declined": "{mentee} declined your mentorship offer",
    "mentorship.accepted": "{mentor} accepted your mentorship request",
    "mentorship.declined": "{mentor} declined your mentorship request",
    "mentorship.cancelled": "{mentee} cancelled the mentorship",
    "mentorship.completed": "{by} marked the mentorship as completed",
    "mentorship.session": "{by} scheduled a session on {when}",
    "mentorship.mentor_approved": "You are now a mentor",
    "mentorship.mentor_rejected": "Your mentor application was not approved",
}


async def _notify(db: AsyncSession, user_id: uuid.UUID, template: str, data: dict, path: str) -> None:
    general = await settings_store.get_group(db, "general")
    title = TITLES.get(template, "Mentorship update").format_map(_Blank(data))
    await notifications.notify(
        db,
        user_id,
        "mentorship",
        template,
        title,
        body=data.get("topic", "") or data.get("note", ""),
        link=path,
        email=(template, {**data, "link": f"{general.app_url}{path}"}),
    )
    live.emit_to_user(db, user_id, "mentorship:update", {"template": template})


@router.post("/requests", status_code=201, summary="Ask a mentor for mentorship")
async def create_request(
    body: RequestIn, me: Principal = Depends(require("portal.mentorship.request")), db: AsyncSession = Depends(get_db)
):
    await enforce(f"mentor-req:{me.id}", 10, 86400, "You have sent many requests today.")
    if body.mentor_id == me.id:
        raise conflict("SELF", "You cannot mentor yourself.")
    m = await db.get(Mentor, body.mentor_id)
    if not m or m.status != "approved":
        raise not_found("Mentor")
    prof = await db.get(AlumniProfile, me.id)
    is_student = bool(prof and prof.kind == "student")
    if (is_student and not m.mentees_students) or (not is_student and not m.mentees_alumni):
        raise conflict("NOT_ACCEPTING", "This mentor does not mentor members like you.")
    if await _active_mentees(db, m.user_id) >= m.max_mentees:
        raise conflict("FULL", "This mentor has no free places right now.")
    pending = (
        await db.execute(
            select(func.count())
            .select_from(MentorshipRequest)
            .where(MentorshipRequest.mentee_id == me.id, MentorshipRequest.status == "pending")
        )
    ).scalar_one()
    if pending >= 3:
        raise conflict("TOO_MANY_PENDING", "You can have up to 3 requests waiting for a reply.")
    dup = (
        await db.execute(
            select(MentorshipRequest.id).where(
                MentorshipRequest.mentor_id == m.user_id,
                MentorshipRequest.mentee_id == me.id,
                MentorshipRequest.status.in_(["pending", "accepted"]),
            )
        )
    ).first()
    if dup:
        raise conflict("ALREADY_REQUESTED", "You already have an open request with this mentor.")
    r = MentorshipRequest(
        mentor_id=m.user_id,
        mentee_id=me.id,
        topic=body.topic.strip(),
        goals=body.goals.strip(),
        preferred_format=body.preferred_format,
        status="pending",
    )
    db.add(r)
    await db.flush()
    await _notify(db, m.user_id, "mentorship.request", {"from": me.full_name, "topic": r.topic}, f"/portal/mentorship/requests/{r.id}")
    return {"data": await request_out(db, me, r)}


@router.get("/requests", summary="Your mentorship requests (as mentor or mentee)")
async def my_requests(
    role: Literal["mentor", "mentee", "all"] = "all",
    status: str | None = Query(None, max_length=20),
    me: Principal = Depends(member),
    db: AsyncSession = Depends(get_db),
):
    cond = {
        "mentor": MentorshipRequest.mentor_id == me.id,
        "mentee": MentorshipRequest.mentee_id == me.id,
        "all": or_(MentorshipRequest.mentor_id == me.id, MentorshipRequest.mentee_id == me.id),
    }[role]
    stmt = select(MentorshipRequest).where(cond)
    if status:
        stmt = stmt.where(MentorshipRequest.status == status)
    rows = (await db.execute(stmt.order_by(MentorshipRequest.updated_at.desc()).limit(200))).scalars().all()
    people = await authors(db, {r.mentor_id for r in rows} | {r.mentee_id for r in rows})
    return {"data": [await request_out(db, me, r, people) for r in rows]}


async def _req(db: AsyncSession, me: Principal, request_id: uuid.UUID) -> MentorshipRequest:
    r = await db.get(MentorshipRequest, request_id)
    if not r or (me.id not in (r.mentor_id, r.mentee_id) and not me.can("mentorship.view")):
        raise not_found("Request")
    return r


@router.get("/requests/{request_id}", summary="One mentorship (sessions and feedback included)")
async def get_request(request_id: uuid.UUID, me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    return {"data": await request_out(db, me, await _req(db, me, request_id), with_sessions=True)}


class RespondIn(BaseModel):
    accept: bool
    note: str | None = Field(None, max_length=1000)


@router.post("/requests/{request_id}/respond", summary="Accept or decline a request (mentor) or an offer (mentee)")
async def respond(request_id: uuid.UUID, body: RespondIn, me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    r = await _req(db, me, request_id)
    offer = r.initiated_by == "mentor"
    if me.id != (r.mentee_id if offer else r.mentor_id):
        raise forbidden("Only the mentee can reply to an offer." if offer else "Only the mentor can reply.")
    if r.status != "pending":
        raise conflict("NOT_PENDING", "This request is no longer waiting for a reply.")
    if offer:
        if body.accept:
            m = await db.get(Mentor, r.mentor_id)
            if not m or m.status != "approved" or await _active_mentees(db, r.mentor_id) >= m.max_mentees:
                raise conflict("FULL", "This mentor has no free places right now.")
        r.status, r.response_note, r.responded_at = ("accepted" if body.accept else "declined"), body.note, now()
        await db.flush()
        await _notify(
            db,
            r.mentor_id,
            "mentorship.offer_accepted" if body.accept else "mentorship.offer_declined",
            {"mentee": me.full_name, "note": body.note or ""},
            f"/portal/mentorship/requests/{r.id}",
        )
        return {"data": await request_out(db, me, r, with_sessions=True)}
    if body.accept:
        m = await db.get(Mentor, me.id)
        if m and await _active_mentees(db, me.id) >= m.max_mentees:
            raise conflict("FULL", f"You already mentor {m.max_mentees} people. Raise your limit or complete a mentorship first.")
    r.status, r.response_note, r.responded_at = ("accepted" if body.accept else "declined"), body.note, now()
    await db.flush()
    await _notify(
        db,
        r.mentee_id,
        "mentorship.accepted" if body.accept else "mentorship.declined",
        {"mentor": me.full_name, "note": body.note or ""},
        f"/portal/mentorship/requests/{r.id}",
    )
    return {"data": await request_out(db, me, r, with_sessions=True)}


@router.post("/requests/{request_id}/cancel", summary="Cancel your request (mentee)")
async def cancel_request(request_id: uuid.UUID, me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    r = await _req(db, me, request_id)
    if r.mentee_id != me.id or r.status not in ("pending", "accepted"):
        raise conflict("NOT_ALLOWED", "This mentorship cannot be cancelled.")
    r.status = "cancelled"
    await _notify(db, r.mentor_id, "mentorship.cancelled", {"mentee": me.full_name, "topic": r.topic}, "/portal/mentorship")
    return {"data": await request_out(db, me, r, with_sessions=True)}


@router.post("/requests/{request_id}/complete", summary="Mark a mentorship as completed")
async def complete(request_id: uuid.UUID, me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    r = await _req(db, me, request_id)
    if me.id not in (r.mentor_id, r.mentee_id) or r.status != "accepted":
        raise conflict("NOT_ACTIVE", "Only an active mentorship can be completed.")
    r.status, r.completed_at = "completed", now()
    other = r.mentee_id if me.id == r.mentor_id else r.mentor_id
    await _notify(db, other, "mentorship.completed", {"by": me.full_name, "topic": r.topic}, f"/portal/mentorship/requests/{r.id}")
    return {"data": await request_out(db, me, r, with_sessions=True)}


class SessionIn(BaseModel):
    scheduled_at: datetime
    duration_minutes: int = Field(45, ge=10, le=480)
    format: FORMATS
    location: str | None = Field(None, max_length=500)
    agenda: str | None = Field(None, max_length=2000)


@router.post("/requests/{request_id}/sessions", status_code=201, summary="Schedule a session")
async def add_session(request_id: uuid.UUID, body: SessionIn, me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    r = await _req(db, me, request_id)
    if me.id not in (r.mentor_id, r.mentee_id) or r.status != "accepted":
        raise conflict("NOT_ACTIVE", "Sessions can be scheduled for active mentorships only.")
    if body.scheduled_at.tzinfo is None:
        raise AppError(422, "VALIDATION_ERROR", "Include a time zone.", [{"field": "scheduled_at", "message": "Time zone required."}])
    s = MentorshipSession(request_id=r.id, created_by=me.id, status="scheduled", **body.model_dump())
    db.add(s)
    await db.flush()
    other = r.mentee_id if me.id == r.mentor_id else r.mentor_id
    await _notify(
        db,
        other,
        "mentorship.session",
        {"by": me.full_name, "when": s.scheduled_at.strftime("%d %b %Y %H:%M UTC"), "format": s.format.replace("_", " ")},
        f"/portal/mentorship/requests/{r.id}",
    )
    return {"data": session_out(s, r, me)}


class SessionUpdate(BaseModel):
    status: Literal["scheduled", "completed", "cancelled"] | None = None
    scheduled_at: datetime | None = None
    location: str | None = Field(None, max_length=500)
    agenda: str | None = Field(None, max_length=2000)
    outcome: str | None = Field(None, max_length=5000)


@router.patch("/sessions/{session_id}", summary="Reschedule, cancel or record the outcome of a session")
async def update_session(session_id: uuid.UUID, body: SessionUpdate, me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    s = await db.get(MentorshipSession, session_id)
    if not s:
        raise not_found("Session")
    r = await _req(db, me, s.request_id)
    if me.id not in (r.mentor_id, r.mentee_id):
        raise forbidden()
    if "outcome" in body.model_fields_set and me.id != r.mentor_id:
        raise forbidden("The mentor records session outcomes.")
    for f in body.model_fields_set:
        setattr(s, f, getattr(body, f))
    if body.outcome and s.status == "scheduled":
        s.status = "completed"
    await db.flush()
    return {"data": session_out(s, r, me)}


class FeedbackIn(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    comment: str | None = Field(None, max_length=2000)


@router.put("/requests/{request_id}/feedback", summary="Rate the mentorship")
async def feedback(request_id: uuid.UUID, body: FeedbackIn, me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    r = await _req(db, me, request_id)
    if me.id not in (r.mentor_id, r.mentee_id):
        raise forbidden()
    had_session = (
        await db.execute(select(MentorshipSession.id).where(MentorshipSession.request_id == r.id, MentorshipSession.status == "completed"))
    ).first()
    if r.status != "completed" and not had_session:
        raise conflict("TOO_EARLY", "You can leave feedback after a session has taken place.")
    fb = (
        await db.execute(select(MentorshipFeedback).where(MentorshipFeedback.request_id == r.id, MentorshipFeedback.from_user_id == me.id))
    ).scalar_one_or_none()
    if fb:
        fb.rating, fb.comment = body.rating, body.comment
    else:
        db.add(MentorshipFeedback(request_id=r.id, from_user_id=me.id, rating=body.rating, comment=body.comment))
    await db.flush()
    return {"data": (await request_out(db, me, r, with_sessions=True))["feedback"]}


# ── coordinators ────────────────────────────────────────────────────────────
@admin.get("/mentors", summary="Mentor applications and mentors")
async def admin_mentors(
    status: Literal["pending", "approved", "rejected", "paused"] | None = None,
    q: str | None = Query(None, max_length=100),
    p: PageParams = Depends(page_params),
    me: Principal = Depends(require("mentorship.view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Mentor).join(User, User.id == Mentor.user_id).where(User.deleted_at.is_(None))
    if status:
        stmt = stmt.where(Mentor.status == status)
    if q:
        stmt = stmt.where(func.lower(User.full_name).like(f"%{q.strip().lower()}%"))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(stmt.order_by(Mentor.created_at.desc()).offset((p.page - 1) * p.page_size).limit(p.page_size))).scalars().all()
    people = await authors(db, {m.user_id for m in rows})
    ratings = await _ratings(db, [m.user_id for m in rows])
    counts = dict((await db.execute(select(Mentor.status, func.count()).group_by(Mentor.status))).all())
    return {"data": [await mentor_out(db, m, people, ratings, full=True) for m in rows], "meta": {**_meta(p, total), "counts": counts}}


class MentorDecision(BaseModel):
    approve: bool
    reason: str | None = Field(None, max_length=300)


@admin.post("/mentors/{user_id}/decide", summary="Approve or reject a mentor application")
async def decide(
    user_id: uuid.UUID,
    body: MentorDecision,
    request: Request,
    me: Principal = Depends(require("mentorship.approve")),
    db: AsyncSession = Depends(get_db),
):
    m = await db.get(Mentor, user_id)
    if not m:
        raise not_found("Mentor")
    if not body.approve and not body.reason:
        raise AppError(422, "VALIDATION_ERROR", "Give a reason.", [{"field": "reason", "message": "Required."}])
    m.status = "approved" if body.approve else "rejected"
    m.approved_by, m.approved_at = (me.id, now()) if body.approve else (None, None)
    m.rejection_reason = None if body.approve else body.reason
    await _notify(
        db,
        user_id,
        "mentorship.mentor_approved" if body.approve else "mentorship.mentor_rejected",
        {"reason": body.reason or ""},
        "/portal/mentorship",
    )
    await record(
        db,
        actor_id=me.id,
        action="approve" if body.approve else "reject",
        entity="mentor",
        entity_id=user_id,
        summary=f"Mentor application {'approved' if body.approve else 'rejected'}",
        data={"reason": body.reason},
        ip=client_ip(request),
    )
    return {"data": await mentor_out(db, m, full=True)}


@admin.get("/requests", summary="All mentorships")
async def admin_requests(
    status: str | None = Query(None, max_length=20),
    p: PageParams = Depends(page_params),
    me: Principal = Depends(require("mentorship.view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(MentorshipRequest)
    if status:
        stmt = stmt.where(MentorshipRequest.status == status)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        (await db.execute(stmt.order_by(MentorshipRequest.updated_at.desc()).offset((p.page - 1) * p.page_size).limit(p.page_size)))
        .scalars()
        .all()
    )
    people = await authors(db, {r.mentor_id for r in rows} | {r.mentee_id for r in rows})
    counts = dict((await db.execute(select(MentorshipRequest.status, func.count()).group_by(MentorshipRequest.status))).all())
    sessions = dict((await db.execute(select(MentorshipSession.status, func.count()).group_by(MentorshipSession.status))).all())
    avg = (await db.execute(select(func.avg(MentorshipFeedback.rating)))).scalar_one()
    return {
        "data": [await request_out(db, me, r, people) for r in rows],
        "meta": {**_meta(p, total), "counts": counts, "sessions": sessions, "average_rating": round(float(avg), 1) if avg else None},
    }


@admin.get("/export", summary="Export mentorships (CSV)")
async def export(request: Request, me: Principal = Depends(require("mentorship.export")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(MentorshipRequest).order_by(MentorshipRequest.created_at.desc()))).scalars().all()
    people = await authors(db, {r.mentor_id for r in rows} | {r.mentee_id for r in rows})
    n_sessions = dict((await db.execute(select(MentorshipSession.request_id, func.count()).group_by(MentorshipSession.request_id))).all())
    await record(
        db, actor_id=me.id, action="export", entity="mentorship", summary=f"Exported {len(rows)} mentorships", ip=client_ip(request)
    )
    await db.commit()
    name = lambda u: (people.get(u) or {}).get("full_name", "")  # noqa: E731
    return csv_response(
        "mentorships.csv",
        ["Mentor", "Mentee", "Topic", "Status", "Sessions", "Requested", "Completed"],
        (
            [
                name(r.mentor_id),
                name(r.mentee_id),
                r.topic,
                r.status,
                n_sessions.get(r.id, 0),
                r.created_at.isoformat(),
                r.completed_at.isoformat() if r.completed_at else "",
            ]
            for r in rows
        ),
    )
