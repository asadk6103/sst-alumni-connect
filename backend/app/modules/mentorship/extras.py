"""Mentorship (redesign phase 4): summary, sessions list, mentee profiles ("Find a Mentee") and mentor offers."""

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import Text, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.deps import Principal, require, require_module
from ...core.errors import conflict, forbidden, not_found
from ...core.redis import enforce
from ...models import MenteeProfile, Mentor, MentorshipRequest, MentorshipSession, User
from ..community.service import authors
from .router import CATEGORIES, _active_mentees, _notify, now, request_out, session_out

router = APIRouter(prefix="/api/v1/mentorship", tags=["Mentorship"], dependencies=[Depends(require_module("mentorship"))])
member = require("portal.access")


@router.get("/summary", summary="Your mentorship counts")
async def summary(me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    async def count(*where) -> int:
        return (await db.execute(select(func.count()).select_from(MentorshipRequest).where(*where))).scalar_one()

    active = MentorshipRequest.status.in_(["accepted", "completed"])
    mine = or_(MentorshipRequest.mentor_id == me.id, MentorshipRequest.mentee_id == me.id)
    sessions = (
        await db.execute(
            select(func.count())
            .select_from(MentorshipSession)
            .join(MentorshipRequest, MentorshipRequest.id == MentorshipSession.request_id)
            .where(mine, MentorshipSession.status != "cancelled")
        )
    ).scalar_one()
    awaiting = await count(
        MentorshipRequest.status == "pending",
        or_(
            (MentorshipRequest.initiated_by == "mentee") & (MentorshipRequest.mentor_id == me.id),
            (MentorshipRequest.initiated_by == "mentor") & (MentorshipRequest.mentee_id == me.id),
        ),
    )
    return {
        "data": {
            "sessions": sessions,
            "as_mentee": await count(MentorshipRequest.mentee_id == me.id, active),
            "as_mentor": await count(MentorshipRequest.mentor_id == me.id, active),
            "awaiting": awaiting,
        }
    }


@router.get("/sessions", summary="Your mentorship sessions")
async def sessions(scope: Literal["upcoming", "past"] = "upcoming", me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    stmt = (
        select(MentorshipSession, MentorshipRequest)
        .join(MentorshipRequest, MentorshipRequest.id == MentorshipSession.request_id)
        .where(or_(MentorshipRequest.mentor_id == me.id, MentorshipRequest.mentee_id == me.id))
    )
    if scope == "upcoming":
        stmt = stmt.where(MentorshipSession.scheduled_at >= now(), MentorshipSession.status == "scheduled").order_by(
            MentorshipSession.scheduled_at
        )
    else:
        stmt = stmt.where(or_(MentorshipSession.scheduled_at < now(), MentorshipSession.status != "scheduled")).order_by(
            MentorshipSession.scheduled_at.desc()
        )
    rows = (await db.execute(stmt.limit(100))).all()
    people = await authors(db, {r.mentor_id for _, r in rows} | {r.mentee_id for _, r in rows})
    out = []
    for s, r in rows:
        other = r.mentee_id if r.mentor_id == me.id else r.mentor_id
        out.append(
            {
                **session_out(s, r, me),
                "request_id": str(r.id),
                "topic": r.topic,
                "with": people.get(other),
                "role": "mentor" if r.mentor_id == me.id else "mentee",
            }
        )
    return {"data": out}


class MenteeIn(BaseModel):
    looking: bool = True
    areas: list[CATEGORIES] = Field(default_factory=list, max_length=8)
    goals: str = Field("", max_length=2000)


def _mentee_out(m: MenteeProfile | None) -> dict | None:
    return {"looking": m.looking, "areas": m.areas or [], "goals": m.goals, "updated_at": m.updated_at} if m else None


@router.get("/mentee/me", summary="Your 'looking for a mentor' profile")
async def my_mentee(me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    return {"data": _mentee_out(await db.get(MenteeProfile, me.id))}


@router.put("/mentee/me", summary="Tell mentors you are looking for mentorship")
async def save_mentee(body: MenteeIn, me: Principal = Depends(require("portal.mentorship.request")), db: AsyncSession = Depends(get_db)):
    m = await db.get(MenteeProfile, me.id)
    if not m:
        m = MenteeProfile(user_id=me.id)
        db.add(m)
    m.looking, m.areas, m.goals = body.looking, list(dict.fromkeys(body.areas)), body.goals.strip()
    await db.flush()
    await db.refresh(m)
    return {"data": _mentee_out(m)}


async def _approved_mentor(db: AsyncSession, me: Principal) -> Mentor:
    m = await db.get(Mentor, me.id)
    if not m or m.status != "approved":
        raise forbidden("Become an approved mentor to find mentees.")
    return m


@router.get("/mentees", summary="Members looking for a mentor (approved mentors)")
async def mentees(
    q: str | None = Query(None, max_length=100),
    category: CATEGORIES | None = None,
    me: Principal = Depends(member),
    db: AsyncSession = Depends(get_db),
):
    await _approved_mentor(db, me)
    stmt = (
        select(MenteeProfile)
        .join(User, User.id == MenteeProfile.user_id)
        .where(MenteeProfile.looking.is_(True), MenteeProfile.user_id != me.id, User.deleted_at.is_(None), User.status == "active")
    )
    if category:
        stmt = stmt.where(MenteeProfile.areas.contains([category]))
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(User.full_name).like(like),
                func.lower(MenteeProfile.goals).like(like),
                func.lower(cast(MenteeProfile.areas, Text)).like(like),
            )
        )
    rows = (await db.execute(stmt.order_by(MenteeProfile.updated_at.desc()).limit(60))).scalars().all()
    people = await authors(db, {m.user_id for m in rows})
    open_ = set(
        (
            await db.execute(
                select(MentorshipRequest.mentee_id).where(
                    MentorshipRequest.mentor_id == me.id,
                    MentorshipRequest.mentee_id.in_([m.user_id for m in rows] or [uuid.UUID(int=0)]),
                    MentorshipRequest.status.in_(["pending", "accepted"]),
                )
            )
        ).scalars()
    )
    return {
        "data": [{"user": people.get(m.user_id), **_mentee_out(m), "connected": m.user_id in open_} for m in rows if m.user_id in people]
    }


class OfferIn(BaseModel):
    topic: str = Field(..., min_length=3, max_length=200)
    note: str = Field("", max_length=3000)


@router.post("/mentees/{user_id}/offer", status_code=201, summary="Offer to mentor a member (approved mentors)")
async def offer(user_id: uuid.UUID, body: OfferIn, me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    m = await _approved_mentor(db, me)
    await enforce(f"mentor-offer:{me.id}", 10, 86400, "You have sent many offers today.")
    target = await db.get(MenteeProfile, user_id)
    if not target or not target.looking or user_id == me.id:
        raise not_found("Mentee")
    if await _active_mentees(db, me.id) >= m.max_mentees:
        raise conflict("FULL", f"You already mentor {m.max_mentees} people. Raise your limit or complete a mentorship first.")
    dup = (
        await db.execute(
            select(MentorshipRequest.id).where(
                MentorshipRequest.mentor_id == me.id,
                MentorshipRequest.mentee_id == user_id,
                MentorshipRequest.status.in_(["pending", "accepted"]),
            )
        )
    ).first()
    if dup:
        raise conflict("ALREADY_REQUESTED", "You already have an open mentorship with this member.")
    r = MentorshipRequest(
        mentor_id=me.id, mentee_id=user_id, topic=body.topic.strip(), goals=body.note.strip(), initiated_by="mentor", status="pending"
    )
    db.add(r)
    await db.flush()
    await _notify(db, user_id, "mentorship.offer", {"from": me.full_name, "topic": r.topic}, f"/portal/mentorship/requests/{r.id}")
    return {"data": await request_out(db, me, r)}
