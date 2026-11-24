"""Authorisation of real-time rooms. Room names are never trusted: every subscription is checked here.

user:{id}            the member's own devices (joined automatically on connect)
feed:all             main community feed (members who may read the community)
group:{id}           a discussion group (readable groups only)
batch:{id}           a batch community (members of that batch)
conversation:{id}    a chat (participants only)
event:{id}           an event's live updates (registered members or event staff)
admin:{role}         staff dashboards (holders of that role)
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.deps import Principal
from ..models import AlumniProfile, DiscussionGroup, GroupMember

ROOM_KINDS = {"user", "feed", "group", "batch", "conversation", "event", "admin"}


async def can_read_group(db: AsyncSession, p: Principal, group: DiscussionGroup) -> bool:
    if p.can("community.view"):
        return True
    if group.status != "active" or not p.can("portal.react"):
        return False
    if group.join_policy == "open":
        return True
    m = await db.get(GroupMember, (group.id, p.id))
    return bool(m and m.status == "active")


async def can_join(db: AsyncSession, p: Principal, room: str) -> bool:
    kind, _, ident = room.partition(":")
    if kind not in ROOM_KINDS or not ident or len(room) > 80:
        return False
    if kind == "user":
        return ident == str(p.id)
    if kind == "feed":
        return ident == "all" and (p.can("portal.react") or p.can("community.view"))
    if kind == "admin":
        return ident in p.roles
    try:
        rid = uuid.UUID(ident)
    except ValueError:
        return False
    if kind == "group":
        g = await db.get(DiscussionGroup, rid)
        return bool(g) and await can_read_group(db, p, g)
    if kind == "batch":
        prof = await db.get(AlumniProfile, p.id)
        return bool(prof and prof.batch_id == rid and prof.verification_status == "verified")
    if kind == "conversation":
        from ..models import ConversationMember

        m = (
            await db.execute(
                select(ConversationMember).where(
                    ConversationMember.conversation_id == rid, ConversationMember.user_id == p.id, ConversationMember.left_at.is_(None)
                )
            )
        ).scalar_one_or_none()
        return m is not None
    if kind == "event":
        from ..models import Event, EventRegistration

        if p.can("events.view"):
            return True
        ev = await db.get(Event, rid)
        if not ev:
            return False
        reg = (
            await db.execute(
                select(EventRegistration.id).where(
                    EventRegistration.event_id == rid,
                    EventRegistration.user_id == p.id,
                    EventRegistration.status.in_(["registered", "attended"]),
                )
            )
        ).first()
        return reg is not None
    return False
