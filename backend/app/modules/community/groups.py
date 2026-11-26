"""Communities (redesign phase 3): overview, trending discussions, notification level, files, community events, invites."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.deps import Principal, require, require_module
from ...core.errors import AppError, conflict, forbidden, not_found
from ...core.redis import enforce
from ...models import DiscussionGroup, Event, GroupInvite, GroupMember, Media, Post, PostMedia, User
from ...services import member_settings, notifications, rooms
from ..alumni.service import connected_ids
from . import service as svc

router = APIRouter(prefix="/api/v1/community", tags=["Community"], dependencies=[Depends(require_module("community"))])
reader = require("portal.react", "community.view", any_of=True)
NOTIFY_CAP = 300  # members notified per post (most recently joined first)


def _now() -> datetime:
    return datetime.now(UTC)


async def _readable(db: AsyncSession, p: Principal, group_id: uuid.UUID) -> DiscussionGroup:
    g = await svc.group_or_404(db, group_id)
    if not await rooms.can_read_group(db, p, g):
        raise not_found("Group")
    return g


async def notify_members(db: AsyncSession, p: Principal, g: DiscussionGroup, post: Post) -> None:
    """Tell the community's members about a new post (announcements also reach "highlights only" members)."""
    levels = ["all", "highlights"] if post.kind == "announcement" else ["all"]
    ids = (
        await db.execute(
            select(GroupMember.user_id)
            .where(
                GroupMember.group_id == g.id, GroupMember.status == "active", GroupMember.notify.in_(levels), GroupMember.user_id != p.id
            )
            .order_by(GroupMember.joined_at.desc())
            .limit(NOTIFY_CAP)
        )
    ).scalars()
    what = "posted an announcement" if post.kind == "announcement" else "posted"
    for uid in ids:
        await notifications.notify(
            db,
            uid,
            "community",
            "group_post",
            f"{p.full_name} {what} in {g.name}",
            body=(post.title or post.body)[:140],
            link=f"/portal/community/posts/{post.id}",
            actor_id=p.id,
        )


@router.get("/trending", summary="Trending discussions in the communities you can read")
async def trending(limit: int = Query(5, ge=1, le=20), p: Principal = Depends(reader), db: AsyncSession = Depends(get_db)):
    mine = await svc.member_group_ids(db, p.id)
    readable = or_(DiscussionGroup.join_policy == "open", DiscussionGroup.id.in_(mine or [uuid.UUID(int=0)]))
    rows = (
        await db.execute(
            select(Post, DiscussionGroup.name)
            .join(DiscussionGroup, DiscussionGroup.id == Post.group_id)
            .where(
                Post.status == "published",
                Post.created_at >= _now() - timedelta(days=30),
                DiscussionGroup.status == "active",
                readable,
            )
            .order_by((Post.comment_count * 2 + Post.reaction_count).desc(), Post.created_at.desc())
            .limit(limit)
        )
    ).all()
    events = dict(
        (
            await db.execute(
                select(Event.id, Event.title).where(Event.id.in_({x.event_id for x, _ in rows if x.event_id} or {uuid.UUID(int=0)}))
            )
        ).all()
    )

    def title(x: Post) -> str:
        if x.title:
            return x.title
        if x.body:
            return x.body[:90] + ("…" if len(x.body) > 90 else "")
        return events.get(x.event_id) or "Shared a photo or file"

    return {
        "data": [
            {
                "post_id": str(x.id),
                "group_id": str(x.group_id),
                "group": name,
                "title": title(x),
                "comment_count": x.comment_count,
                "reaction_count": x.reaction_count,
            }
            for x, name in rows
        ]
    }


@router.get("/groups/{group_id}/overview", summary="Community side panel: counts, admins, members, upcoming events")
async def overview(group_id: uuid.UUID, p: Principal = Depends(reader), db: AsyncSession = Depends(get_db)):
    g = await svc.group_or_404(db, group_id)
    if g.status != "active":
        raise not_found("Group")
    readable = await rooms.can_read_group(db, p, g)
    admins = (
        await db.execute(
            select(func.count())
            .select_from(GroupMember)
            .where(GroupMember.group_id == g.id, GroupMember.status == "active", GroupMember.role.in_(["owner", "moderator"]))
        )
    ).scalar_one()
    now = _now()
    ev_q = select(Event).where(Event.group_id == g.id, Event.status == "published", Event.ends_at >= now)
    events_total = (await db.execute(select(func.count()).select_from(ev_q.subquery()))).scalar_one()
    faces, upcoming = [], []
    if readable:
        ids = (
            (
                await db.execute(
                    select(GroupMember.user_id)
                    .join(User, User.id == GroupMember.user_id)
                    .where(GroupMember.group_id == g.id, GroupMember.status == "active", User.deleted_at.is_(None))
                    .order_by(GroupMember.role.desc(), GroupMember.joined_at)
                    .limit(8)
                )
            )
            .scalars()
            .all()
        )
        people = await svc.authors(db, set(ids))
        faces = [people[i] for i in ids if i in people]
        from ..events.service import event_out

        for e in (await db.execute(ev_q.order_by(Event.starts_at).limit(3))).scalars():
            upcoming.append(await event_out(db, p, e))
    creator = (await svc.authors(db, {g.created_by})).get(g.created_by) if g.created_by else None
    return {
        "data": {
            "members": g.member_count,
            "posts": g.post_count,
            "events": events_total,
            "admins": admins,
            "created_at": g.created_at,
            "created_by": creator,
            "member_faces": faces,
            "upcoming_events": upcoming,
        }
    }


class NotifyIn(BaseModel):
    level: Literal["all", "highlights", "off"]


@router.post("/groups/{group_id}/notify", summary="How much you hear about a community you belong to")
async def set_notify(group_id: uuid.UUID, body: NotifyIn, p: Principal = Depends(reader), db: AsyncSession = Depends(get_db)):
    m = await svc.membership(db, group_id, p.id)
    if not m:
        raise conflict("NOT_MEMBER", "Join the community first.")
    m.notify = body.level
    return {"data": {"notify": m.notify}}


@router.get("/groups/{group_id}/files", summary="Documents shared in a community")
async def files(group_id: uuid.UUID, p: Principal = Depends(reader), db: AsyncSession = Depends(get_db)):
    from ...services import media

    g = await _readable(db, p, group_id)
    rows = (
        await db.execute(
            select(Media, Post.id, Post.author_id, Post.created_at)
            .join(PostMedia, PostMedia.media_id == Media.id)
            .join(Post, Post.id == PostMedia.post_id)
            .where(
                Post.group_id == g.id,
                Post.status == "published",
                Media.deleted_at.is_(None),
                ~Media.mime.startswith("image/"),
                ~Media.mime.startswith("video/"),
            )
            .order_by(Post.created_at.desc())
            .limit(200)
        )
    ).all()
    people = await svc.authors(db, {r[2] for r in rows})
    out = []
    for m, post_id, author_id, at in rows:
        pub = await media.to_public(db, m)
        out.append(
            {
                "id": str(m.id),
                "filename": m.filename,
                "mime": m.mime,
                "size": m.size,
                "url": pub["url"],
                "post_id": str(post_id),
                "shared_by": people.get(author_id),
                "created_at": at,
            }
        )
    return {"data": out}


@router.post("/groups/{group_id}/events", status_code=201, summary="Create a community event (community managers)")
async def create_event(group_id: uuid.UUID, body: dict, p: Principal = Depends(reader), db: AsyncSession = Depends(get_db)):
    from ..events.router import EventIn
    from ..events.service import event_out

    g = await svc.group_or_404(db, group_id)
    if g.status != "active" or not await svc.can_manage_group(db, p, g):
        raise forbidden("Only the community's admins can create its events.")
    await enforce(f"group-event:{p.id}", 10, 86400, "You have created many events today.")
    data = EventIn.model_validate(body)
    ev = Event(
        **data.model_dump(exclude={"custom_fields", "batch_id", "banner_id"}),
        banner_id=data.banner_id if data.banner_id and await _own_image(db, p, data.banner_id) else None,
        group_id=g.id,
        status="published",
        created_by=p.id,
        registered_count=0,
        custom_fields={},
    )
    db.add(ev)
    await db.flush()
    post = Post(author_id=p.id, group_id=g.id, kind="event", event_id=ev.id, body=data.summary or "", audience="community")
    db.add(post)
    await db.execute(
        update(DiscussionGroup).where(DiscussionGroup.id == g.id).values(post_count=DiscussionGroup.post_count + 1, last_post_at=func.now())
    )
    await db.flush()
    await notify_members(db, p, g, post)
    return {"data": await event_out(db, p, ev, detail=True, reg=None)}


async def _own_image(db: AsyncSession, p: Principal, media_id: uuid.UUID) -> bool:
    m = await db.get(Media, media_id)
    if not m or m.uploaded_by != p.id or not m.mime.startswith("image/"):
        raise AppError(422, "INVALID_MEDIA", "Upload the banner image again.")
    return True


# ── invites ─────────────────────────────────────────────────────────────────
class InviteIn(BaseModel):
    user_ids: list[uuid.UUID] = Field(..., min_length=1, max_length=50)


@router.get("/groups/{group_id}/invitable", summary="Your connections you can invite to a community")
async def invitable(
    group_id: uuid.UUID, q: str | None = Query(None, max_length=100), p: Principal = Depends(reader), db: AsyncSession = Depends(get_db)
):
    g = await svc.group_or_404(db, group_id)
    if not await svc.membership(db, g.id, p.id):
        raise forbidden("Join the community to invite people.")
    friends = await connected_ids(db, p.id)
    members = set(
        (
            await db.execute(select(GroupMember.user_id).where(GroupMember.group_id == g.id, GroupMember.status.in_(["active", "banned"])))
        ).scalars()
    )
    invited = set(
        (await db.execute(select(GroupInvite.invitee_id).where(GroupInvite.group_id == g.id, GroupInvite.status == "pending"))).scalars()
    )
    stmt = select(User.id).where(User.id.in_((friends - members) or {uuid.UUID(int=0)}), User.deleted_at.is_(None))
    if q:
        stmt = stmt.where(func.lower(User.full_name).like(f"%{q.strip().lower()}%"))
    ids = (await db.execute(stmt.order_by(User.full_name).limit(50))).scalars().all()
    people = await svc.authors(db, set(ids))
    return {"data": [{**people[i], "invited": i in invited} for i in ids if i in people]}


@router.post("/groups/{group_id}/invites", summary="Invite your connections to a community")
async def invite(group_id: uuid.UUID, body: InviteIn, p: Principal = Depends(reader), db: AsyncSession = Depends(get_db)):
    g = await svc.group_or_404(db, group_id)
    if g.status != "active" or g.kind == "batch":
        raise conflict("NOT_INVITABLE", "Batch communities are joined automatically after verification.")
    if not await svc.membership(db, g.id, p.id):
        raise forbidden("Join the community to invite people.")
    await enforce(f"group-invite:{p.id}", 200, 86400, "You have sent many invitations today.")
    manager = await svc.can_manage_group(db, p, g)
    friends = await connected_ids(db, p.id, list(body.user_ids))
    prefs = await member_settings.get_many(db, body.user_ids)
    sent = 0
    for uid in dict.fromkeys(body.user_ids):
        if uid == p.id or (uid not in friends and not manager):
            continue
        if prefs.get(uid, member_settings.DEFAULTS)["group_invites"] == "none":
            continue
        m = await db.get(GroupMember, (g.id, uid))
        if m and m.status in ("active", "banned"):
            continue
        inv = (
            await db.execute(select(GroupInvite).where(GroupInvite.group_id == g.id, GroupInvite.invitee_id == uid))
        ).scalar_one_or_none()
        if inv and inv.status == "pending":
            continue
        if inv:
            inv.status, inv.inviter_id, inv.created_at = "pending", p.id, _now()
        else:
            db.add(GroupInvite(group_id=g.id, inviter_id=p.id, invitee_id=uid))
        await notifications.notify(
            db,
            uid,
            "community",
            "group_invite",
            f"{p.full_name} invited you to join {g.name}",
            link="/portal/community/groups?tab=invites",
            actor_id=p.id,
        )
        sent += 1
    await db.flush()
    return {"data": {"sent": sent}}


@router.get("/group-invites", summary="Community invitations waiting for your answer")
async def my_invites(p: Principal = Depends(reader), db: AsyncSession = Depends(get_db)):
    rows = (
        await db.execute(
            select(GroupInvite, DiscussionGroup)
            .join(DiscussionGroup, DiscussionGroup.id == GroupInvite.group_id)
            .where(GroupInvite.invitee_id == p.id, GroupInvite.status == "pending", DiscussionGroup.status == "active")
            .order_by(GroupInvite.created_at.desc())
        )
    ).all()
    people = await svc.authors(db, {i.inviter_id for i, _ in rows})
    return {
        "data": [
            {"id": str(i.id), "group": await svc.group_out(db, p, g), "inviter": people.get(i.inviter_id), "created_at": i.created_at}
            for i, g in rows
        ]
    }


@router.post("/group-invites/{invite_id}/{decision}", summary="Accept or decline a community invitation")
async def answer_invite(
    invite_id: uuid.UUID, decision: Literal["accept", "decline"], p: Principal = Depends(reader), db: AsyncSession = Depends(get_db)
):
    inv = await db.get(GroupInvite, invite_id)
    if not inv or inv.invitee_id != p.id or inv.status != "pending":
        raise not_found("Invitation")
    g = await svc.group_or_404(db, inv.group_id)
    if decision == "decline":
        inv.status = "declined"
        return {"data": {"ok": True}}
    if not p.can("portal.groups"):
        raise forbidden("Your profile needs to be verified before joining communities.")
    m = await db.get(GroupMember, (g.id, p.id))
    if m and m.status == "banned":
        raise forbidden("You cannot join this community.")
    inv.status = "accepted"
    if not m or m.status != "active":
        if m:
            m.status = "active"
        else:
            db.add(GroupMember(group_id=g.id, user_id=p.id, role="member", status="active"))
        await db.execute(update(DiscussionGroup).where(DiscussionGroup.id == g.id).values(member_count=DiscussionGroup.member_count + 1))
    await db.flush()
    await db.refresh(g)
    return {"data": await svc.group_out(db, p, g)}
