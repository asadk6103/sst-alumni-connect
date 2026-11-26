"""Events: visibility, seats and waitlist, serialisation."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.deps import Principal
from ...core.errors import not_found
from ...models import (
    AlumniProfile,
    Batch,
    DiscussionGroup,
    Event,
    EventComment,
    EventFeedback,
    EventInterest,
    EventInvite,
    EventMedia,
    EventRegistration,
    GroupMember,
    Media,
    User,
)
from ...services import custom_fields, live, media, notifications

KINDS = {
    "reunion": "Reunion",
    "batch_reunion": "Batch reunion",
    "networking": "Networking",
    "seminar": "Seminar",
    "webinar": "Webinar",
    "workshop": "Workshop",
    "school": "School event",
    "sports": "Sports & activities",
    "career": "Career & jobs",
    "social_impact": "Social impact",
    "other": "Other",
}


def now() -> datetime:
    return datetime.now(UTC)


async def visible(db: AsyncSession, p: Principal, ev: Event | None) -> Event:
    """Members see published events (batch events: that batch only); event staff see everything."""
    if not ev:
        raise not_found("Event")
    if p.can("events.view"):
        return ev
    if ev.status == "draft" or (ev.status == "pending" and ev.created_by != p.id):
        raise not_found("Event")
    if ev.batch_id:
        prof = await db.get(AlumniProfile, p.id)
        if not prof or prof.batch_id != ev.batch_id:
            raise not_found("Event")
    if ev.group_id:
        from ...services import rooms

        g = await db.get(DiscussionGroup, ev.group_id)
        if not g or not await rooms.can_read_group(db, p, g):
            raise not_found("Event")
    return ev


def group_scope(p: Principal):
    """Community events: everyone for open communities, members only for private ones."""
    if p.can("events.view") or p.can("community.view"):
        return Event.id.is_not(None)
    open_groups = select(DiscussionGroup.id).where(DiscussionGroup.join_policy == "open", DiscussionGroup.status == "active")
    mine = select(GroupMember.group_id).where(GroupMember.user_id == p.id, GroupMember.status == "active")
    return or_(Event.group_id.is_(None), Event.group_id.in_(open_groups), Event.group_id.in_(mine))


def seats_taken(ev: Event) -> int:
    return ev.registered_count


def seats_left(ev: Event) -> int | None:
    return None if ev.capacity is None else max(0, ev.capacity - ev.registered_count)


async def _count(db: AsyncSession, *where) -> int:
    model = where[0].left.table
    return (await db.execute(select(func.count()).select_from(model).where(*where))).scalar_one()


async def organizer(db: AsyncSession, ev: Event) -> dict:
    """Who runs the event: its community, the member who proposed it, or the alumni office."""
    if ev.group_id and (g := await db.get(DiscussionGroup, ev.group_id)):
        return {
            "type": "community",
            "id": str(g.id),
            "name": g.name,
            "members": g.member_count,
            "photo": await image(db, g.photo_id or g.cover_id),
        }
    if ev.created_by and (u := await db.get(User, ev.created_by)):
        prof = await db.get(AlumniProfile, u.id)
        staff = any(r.is_staff for r in u.roles)
        if prof and not staff:
            return {"type": "member", "id": str(u.id), "name": u.full_name, "members": None, "photo": await image(db, prof.photo_id)}
    return {"type": "office", "id": None, "name": "SST Alumni Office", "members": None, "photo": None}


async def can_manage(db: AsyncSession, p: Principal, ev: Event) -> bool:
    if p.can("events.edit"):
        return True
    if ev.created_by == p.id:
        return True
    if ev.group_id and (g := await db.get(DiscussionGroup, ev.group_id)):
        m = await db.get(GroupMember, (g.id, p.id))
        return bool(m and m.status == "active" and m.role in ("owner", "moderator"))
    return False


async def image(db: AsyncSession, media_id) -> dict | None:
    if not media_id:
        return None
    m = await db.get(Media, media_id)
    if not m or m.deleted_at:
        return None
    pub = await media.to_public(db, m)
    return {"id": str(m.id), "url": pub["url"], "variants": pub["variants"], "alt": m.alt}


async def event_out(db: AsyncSession, p: Principal, ev: Event, detail: bool = False, reg: EventRegistration | None | bool = False) -> dict:
    if reg is False:
        reg = (
            await db.execute(select(EventRegistration).where(EventRegistration.event_id == ev.id, EventRegistration.user_id == p.id))
        ).scalar_one_or_none()
    active = reg and reg.status in ("registered", "attended")
    batch = (await db.get(Batch, ev.batch_id)).name if ev.batch_id else None
    out = {
        "id": str(ev.id),
        "title": ev.title,
        "kind": ev.kind,
        "kind_label": KINDS.get(ev.kind, ev.kind),
        "summary": ev.summary,
        "banner": await image(db, ev.banner_id),
        "starts_at": ev.starts_at,
        "ends_at": ev.ends_at,
        "venue": ev.venue,
        "address": ev.address,
        "is_online": ev.is_online,
        "capacity": ev.capacity,
        "seats_left": seats_left(ev),
        "registered_count": ev.registered_count,
        "max_guests": ev.max_guests,
        "registration_deadline": ev.registration_deadline,
        "registration_open": ev.status == "published" and (ev.registration_deadline or ev.starts_at) > now(),
        "status": ev.status,
        "cancel_reason": ev.cancel_reason,
        "batch": batch,
        "batch_id": str(ev.batch_id) if ev.batch_id else None,
        "group": {"id": str(g.id), "name": g.name} if ev.group_id and (g := await db.get(DiscussionGroup, ev.group_id)) else None,
        "is_past": ev.ends_at < now(),
        "is_featured": ev.is_featured,
        "highlights": ev.highlights or [],
        "agenda": ev.agenda or [],
        "interested": bool(await db.get(EventInterest, (ev.id, p.id))),
        "interested_count": await _count(db, EventInterest.event_id == ev.id),
        "comment_count": await _count(db, EventComment.event_id == ev.id, EventComment.status == "published"),
        "invited_count": await _count(db, EventInvite.event_id == ev.id),
        "attending_count": await _count(db, EventRegistration.event_id == ev.id, EventRegistration.status.in_(["registered", "attended"])),
        "organizer": await organizer(db, ev),
        "can_manage": await can_manage(db, p, ev),
        "my_registration": {
            "id": str(reg.id),
            "status": reg.status,
            "guests": reg.guests,
            "checkin_code": reg.checkin_code if active else None,
        }
        if reg
        else None,
    }
    if detail:
        out["description"] = ev.description
        staff = p.can("events.view")
        out["custom_fields"] = (ev.custom_fields or {}) if staff else None
        out["extra_fields"] = await custom_fields.visible_for(db, "event", ev.custom_fields, "owner" if staff else "member")
        out["online_url"] = ev.online_url if (active or p.can("events.view")) else None
        gallery = (
            await db.execute(select(EventMedia.media_id).where(EventMedia.event_id == ev.id).order_by(EventMedia.position))
        ).scalars()
        out["gallery"] = [g for g in [await image(db, mid) for mid in gallery] if g]
        avg, n = (await db.execute(select(func.avg(EventFeedback.rating), func.count()).where(EventFeedback.event_id == ev.id))).one()
        mine = await db.get(EventFeedback, (ev.id, p.id))
        out["feedback"] = {
            "average": round(float(avg), 1) if avg else None,
            "count": n,
            "mine": {"rating": mine.rating, "comment": mine.comment} if mine else None,
        }
    return out


async def promote_waitlist(db: AsyncSession, ev: Event) -> int:
    """Fill freed seats from the waitlist (first come, first served) and tell the promoted members."""
    promoted = 0
    general = await settings_store.get_group(db, "general")
    while True:
        left = seats_left(ev)
        nxt = (
            await db.execute(
                select(EventRegistration)
                .where(EventRegistration.event_id == ev.id, EventRegistration.status == "waitlisted")
                .order_by(EventRegistration.created_at)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
        ).scalar_one_or_none()
        if not nxt or (left is not None and left < 1 + nxt.guests):
            return promoted
        nxt.status = "registered"
        ev.registered_count += 1 + nxt.guests
        promoted += 1
        u = await db.get(User, nxt.user_id)
        await notifications.notify(
            db,
            u.id,
            "events",
            "promoted",
            f"A place opened up: {ev.title}",
            link=f"/portal/events/{ev.id}",
            email=(
                "events.promoted",
                {
                    "event": ev.title,
                    "when": ev.starts_at.strftime("%d %b %Y %H:%M UTC"),
                    "link": f"{general.app_url}/portal/events/{ev.id}",
                },
            ),
        )
        live.emit_to_user(db, u.id, "event:registration", {"event_id": str(ev.id), "status": "registered"})


def new_code() -> str:
    return uuid.uuid4().hex + uuid.uuid4().hex[:8]
