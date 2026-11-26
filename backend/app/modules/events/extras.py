"""Events (redesign phase 4): member-proposed events, featured, summary, interested, discussion, attendees, photos, files, invites."""

import uuid

from fastapi import APIRouter, Depends, File, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.deps import Principal, require, require_module
from ...core.errors import forbidden, not_found
from ...core.redis import enforce
from ...models import (
    AlumniProfile,
    Event,
    EventComment,
    EventFile,
    EventInterest,
    EventInvite,
    EventMedia,
    EventRegistration,
    Media,
    User,
)
from ...services import live, media, notifications
from ..alumni.service import connected_ids
from ..community.service import authors
from . import service as svc

router = APIRouter(prefix="/api/v1/events", tags=["Events"], dependencies=[Depends(require_module("events"))])
member = require("portal.access")
DOC_TYPES = ("pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv")


def _visible_stmt(me: Principal, prof: AlumniProfile | None):
    return select(Event).where(
        Event.status == "published",
        or_(Event.batch_id.is_(None), Event.batch_id == (prof.batch_id if prof and prof.batch_id else uuid.UUID(int=0))),
        svc.group_scope(me),
    )


@router.get("/summary", summary="Your event counts (upcoming, attending, interested, past)")
async def summary(me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    prof = await db.get(AlumniProfile, me.id)
    now = svc.now()
    base = _visible_stmt(me, prof)

    async def count(stmt) -> int:
        return (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()

    mine = and_(
        EventRegistration.event_id == Event.id, EventRegistration.user_id == me.id, EventRegistration.status.in_(["registered", "attended"])
    )
    return {
        "data": {
            "upcoming": await count(base.where(Event.ends_at >= now)),
            "attending": await count(base.join(EventRegistration, mine).where(Event.ends_at >= now)),
            "interested": await count(base.join(EventInterest, and_(EventInterest.event_id == Event.id, EventInterest.user_id == me.id))),
            "past": await count(base.join(EventRegistration, mine).where(Event.ends_at < now)),
        }
    }


@router.get("/featured", summary="Featured upcoming events (carousel)")
async def featured(me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    prof = await db.get(AlumniProfile, me.id)
    rows = (
        (
            await db.execute(
                _visible_stmt(me, prof).where(Event.is_featured.is_(True), Event.ends_at >= svc.now()).order_by(Event.starts_at).limit(5)
            )
        )
        .scalars()
        .all()
    )
    return {"data": [await svc.event_out(db, me, e) for e in rows]}


@router.post("", status_code=201, summary="Propose an event (published after the alumni office approves it)")
async def propose(body: dict, me: Principal = Depends(require("portal.events.register")), db: AsyncSession = Depends(get_db)):
    from .router import EventIn

    await enforce(f"event-propose:{me.id}", 5, 86400, "You can propose up to 5 events a day.")
    data = EventIn.model_validate({k: v for k, v in body.items() if k not in ("batch_id", "is_featured", "custom_fields")})
    if data.banner_id:
        m = await db.get(Media, data.banner_id)
        if not m or m.uploaded_by != me.id or not m.mime.startswith("image/"):
            raise forbidden("Upload the banner image again.")
    auto = me.can("events.publish")
    ev = Event(
        **data.model_dump(exclude={"custom_fields", "batch_id", "is_featured", "agenda"}),
        agenda=[a.model_dump() for a in data.agenda],
        status="published" if auto else "pending",
        created_by=me.id,
        registered_count=0,
        custom_fields={},
    )
    db.add(ev)
    await db.flush()
    if not auto:
        live.emit_to_room(db, "admin:alumni_admin", "moderation:event", {"id": str(ev.id)})
    return {"data": await svc.event_out(db, me, ev, detail=True, reg=None)}


async def _event(db: AsyncSession, me: Principal, event_id: uuid.UUID) -> Event:
    return await svc.visible(db, me, await db.get(Event, event_id))


@router.post("/{event_id}/interest", summary="Mark an event as interesting (bookmark)")
async def interest(event_id: uuid.UUID, me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    ev = await _event(db, me, event_id)
    if not await db.get(EventInterest, (ev.id, me.id)):
        db.add(EventInterest(event_id=ev.id, user_id=me.id))
        await db.flush()
    return {"data": await svc.event_out(db, me, ev)}


@router.delete("/{event_id}/interest", summary="Remove the interested mark")
async def uninterest(event_id: uuid.UUID, me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    ev = await _event(db, me, event_id)
    if row := await db.get(EventInterest, (ev.id, me.id)):
        await db.delete(row)
        await db.flush()
    return {"data": await svc.event_out(db, me, ev)}


@router.get("/{event_id}/attendees", summary="Who is attending")
async def attendees(
    event_id: uuid.UUID,
    q: str | None = Query(None, max_length=100),
    limit: int = Query(100, ge=1, le=300),
    me: Principal = Depends(member),
    db: AsyncSession = Depends(get_db),
):
    ev = await _event(db, me, event_id)
    stmt = (
        select(EventRegistration.user_id)
        .join(User, User.id == EventRegistration.user_id)
        .where(EventRegistration.event_id == ev.id, EventRegistration.status.in_(["registered", "attended"]), User.deleted_at.is_(None))
    )
    if q:
        stmt = stmt.where(func.lower(User.full_name).like(f"%{q.strip().lower()}%"))
    ids = (await db.execute(stmt.order_by(EventRegistration.created_at).limit(limit))).scalars().all()
    people = await authors(db, set(ids))
    return {"data": [people[i] for i in ids if i in people]}


class CommentIn(BaseModel):
    body: str = Field(..., min_length=1, max_length=2000)


@router.get("/{event_id}/comments", summary="Event discussion (newest first)")
async def comments(event_id: uuid.UUID, me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    ev = await _event(db, me, event_id)
    rows = (
        (
            await db.execute(
                select(EventComment)
                .where(EventComment.event_id == ev.id, EventComment.status == "published")
                .order_by(EventComment.created_at.desc())
                .limit(200)
            )
        )
        .scalars()
        .all()
    )
    people = await authors(db, {c.author_id for c in rows})
    manage = await svc.can_manage(db, me, ev)
    return {
        "data": [
            {
                "id": str(c.id),
                "body": c.body,
                "author": people.get(c.author_id),
                "created_at": c.created_at,
                "can_delete": c.author_id == me.id or manage,
            }
            for c in rows
        ]
    }


@router.post("/{event_id}/comments", status_code=201, summary="Post in the event discussion")
async def add_comment(
    event_id: uuid.UUID, body: CommentIn, me: Principal = Depends(require("portal.react")), db: AsyncSession = Depends(get_db)
):
    ev = await _event(db, me, event_id)
    await enforce(f"event-comment:{me.id}", 30, 3600, "You are commenting very often. Please wait a little.")
    c = EventComment(event_id=ev.id, author_id=me.id, body=body.body.strip())
    db.add(c)
    await db.flush()
    await db.refresh(c)
    if ev.created_by and ev.created_by != me.id:
        await notifications.notify(
            db,
            ev.created_by,
            "events",
            "event_comment",
            f"{me.full_name} commented on {ev.title}",
            body=c.body[:140],
            link=f"/portal/events/{ev.id}?tab=discussion",
            actor_id=me.id,
        )
    return {
        "data": {
            "id": str(c.id),
            "body": c.body,
            "author": (await authors(db, {me.id})).get(me.id),
            "created_at": c.created_at,
            "can_delete": True,
        }
    }


@router.delete("/{event_id}/comments/{comment_id}", summary="Delete a comment (author or organisers)")
async def delete_comment(event_id: uuid.UUID, comment_id: uuid.UUID, me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    ev = await _event(db, me, event_id)
    c = await db.get(EventComment, comment_id)
    if not c or c.event_id != ev.id or c.status != "published":
        raise not_found("Comment")
    if c.author_id != me.id and not await svc.can_manage(db, me, ev):
        raise forbidden()
    c.status = "deleted"
    return {"data": {"ok": True}}


@router.get("/{event_id}/files", summary="Documents attached by the organisers")
async def files(event_id: uuid.UUID, me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    ev = await _event(db, me, event_id)
    rows = (
        await db.execute(
            select(Media, EventFile.created_at)
            .join(EventFile, EventFile.media_id == Media.id)
            .where(EventFile.event_id == ev.id, Media.deleted_at.is_(None))
            .order_by(EventFile.created_at.desc())
        )
    ).all()
    out = []
    for m, at in rows:
        pub = await media.to_public(db, m)
        out.append({"id": str(m.id), "filename": m.filename, "mime": m.mime, "size": m.size, "url": pub["url"], "created_at": at})
    return {"data": out}


async def _organiser(db: AsyncSession, me: Principal, event_id: uuid.UUID) -> Event:
    ev = await db.get(Event, event_id)
    if not ev:
        raise not_found("Event")
    if not await svc.can_manage(db, me, ev):
        raise forbidden("Only the event's organisers can do this.")
    return ev


@router.post("/{event_id}/files", status_code=201, summary="Attach a document (organisers)")
async def add_file(event_id: uuid.UUID, file: UploadFile = File(...), me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    ev = await _organiser(db, me, event_id)
    await enforce(f"event-file:{me.id}", 30, 3600)
    m = await media.upload(
        db, data=await file.read(), filename=file.filename or "file", folder="events", actor=me.id, extra_types=DOC_TYPES
    )
    db.add(EventFile(event_id=ev.id, media_id=m.id, uploaded_by=me.id))
    await db.flush()
    return {"data": {"id": str(m.id), "filename": m.filename}}


@router.delete("/{event_id}/files/{media_id}", summary="Remove a document (organisers)")
async def remove_file(event_id: uuid.UUID, media_id: uuid.UUID, me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    ev = await _organiser(db, me, event_id)
    row = await db.get(EventFile, (ev.id, media_id))
    if not row:
        raise not_found("File")
    await db.delete(row)
    return {"data": {"ok": True}}


@router.post("/{event_id}/photos", status_code=201, summary="Add a photo to the event gallery (organisers)")
async def add_photo(event_id: uuid.UUID, file: UploadFile = File(...), me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    ev = await _organiser(db, me, event_id)
    await enforce(f"event-photo:{me.id}", 60, 3600)
    m = await media.upload(db, data=await file.read(), filename=file.filename or "photo", folder="events", images_only=True, actor=me.id)
    pos = (await db.execute(select(func.coalesce(func.max(EventMedia.position), -1)).where(EventMedia.event_id == ev.id))).scalar_one() + 1
    db.add(EventMedia(event_id=ev.id, media_id=m.id, position=pos))
    await db.flush()
    return {"data": await svc.image(db, m.id)}


class InviteIn(BaseModel):
    user_ids: list[uuid.UUID] = Field(..., min_length=1, max_length=50)


@router.get("/{event_id}/invitable", summary="Your connections you can invite")
async def invitable(
    event_id: uuid.UUID, q: str | None = Query(None, max_length=100), me: Principal = Depends(member), db: AsyncSession = Depends(get_db)
):
    ev = await _event(db, me, event_id)
    friends = await connected_ids(db, me.id)
    going = set(
        (
            await db.execute(
                select(EventRegistration.user_id).where(
                    EventRegistration.event_id == ev.id, EventRegistration.status.in_(["registered", "attended"])
                )
            )
        ).scalars()
    )
    invited = set((await db.execute(select(EventInvite.invitee_id).where(EventInvite.event_id == ev.id))).scalars())
    stmt = select(User.id).where(User.id.in_((friends - going) or {uuid.UUID(int=0)}), User.deleted_at.is_(None))
    if q:
        stmt = stmt.where(func.lower(User.full_name).like(f"%{q.strip().lower()}%"))
    ids = (await db.execute(stmt.order_by(User.full_name).limit(50))).scalars().all()
    people = await authors(db, set(ids))
    return {"data": [{**people[i], "invited": i in invited} for i in ids if i in people]}


@router.post("/{event_id}/invite", summary="Invite your connections to an event")
async def invite(event_id: uuid.UUID, body: InviteIn, me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    ev = await _event(db, me, event_id)
    if ev.status != "published" or ev.ends_at < svc.now():
        raise forbidden("You can only invite people to upcoming published events.")
    await enforce(f"event-invite:{me.id}", 200, 86400, "You have sent many invitations today.")
    friends = await connected_ids(db, me.id, list(body.user_ids))
    sent = 0
    for uid in dict.fromkeys(body.user_ids):
        if uid not in friends or await db.get(EventInvite, (ev.id, uid)):
            continue
        going = (
            await db.execute(
                select(EventRegistration.id).where(
                    EventRegistration.event_id == ev.id,
                    EventRegistration.user_id == uid,
                    EventRegistration.status.in_(["registered", "attended"]),
                )
            )
        ).first()
        if going:
            continue
        db.add(EventInvite(event_id=ev.id, invitee_id=uid, inviter_id=me.id))
        await notifications.notify(
            db,
            uid,
            "events",
            "event_invite",
            f"{me.full_name} invited you to {ev.title}",
            body=svc.KINDS.get(ev.kind, ""),
            link=f"/portal/events/{ev.id}",
            actor_id=me.id,
        )
        sent += 1
    await db.flush()
    return {"data": {"sent": sent}}
