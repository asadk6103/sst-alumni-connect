"""Messaging domain logic shared by the REST API and the real-time gateway.

Messages are written to PostgreSQL first; broadcasts happen after the commit. A repeated send with the same
client_id returns the original message (idempotent), so retries after a lost acknowledgement never duplicate.
"""

import time
import uuid
from datetime import UTC, datetime

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.deps import Principal
from ...core.errors import AppError, conflict, forbidden, not_found
from ...core.redis import enforce, redis
from ...core.settings_schemas import RealtimeSettings
from ...models import (
    AlumniConnection,
    AlumniProfile,
    BlockedUser,
    Conversation,
    ConversationMember,
    ConversationSetting,
    Media,
    Message,
    MessageAttachment,
    MessageReaction,
    MessageReceipt,
    User,
)
from ...services import live
from ..community.service import authors


def now() -> datetime:
    return datetime.now(UTC)


async def rt_settings(db: AsyncSession) -> RealtimeSettings:
    return await settings_store.get_group(db, "realtime")  # type: ignore[return-value]


# ── who may talk to whom ────────────────────────────────────────────────────
async def blocked_between(db: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> bool:
    return (
        await db.execute(
            select(BlockedUser.blocker_id).where(
                or_(
                    and_(BlockedUser.blocker_id == a, BlockedUser.blocked_id == b),
                    and_(BlockedUser.blocker_id == b, BlockedUser.blocked_id == a),
                )
            )
        )
    ).first() is not None


async def may_contact(db: AsyncSession, me: Principal, other_id: uuid.UUID) -> None:
    """Members message their connections and batchmates; staff may message anyone. Blocks always win."""
    if other_id == me.id:
        raise conflict("SELF", "You cannot message yourself.")
    other = await db.get(User, other_id)
    if not other or other.deleted_at or other.status != "active":
        raise not_found("Member")
    if await blocked_between(db, me.id, other_id):
        raise forbidden("You cannot message this member.")
    if me.can("alumni.view"):
        return
    connected = (
        await db.execute(
            select(AlumniConnection.id).where(
                AlumniConnection.status == "accepted",
                or_(
                    and_(AlumniConnection.requester_id == me.id, AlumniConnection.addressee_id == other_id),
                    and_(AlumniConnection.requester_id == other_id, AlumniConnection.addressee_id == me.id),
                ),
            )
        )
    ).first()
    if connected:
        return
    mine, theirs = await db.get(AlumniProfile, me.id), await db.get(AlumniProfile, other_id)
    if mine and theirs and mine.batch_id and mine.batch_id == theirs.batch_id and theirs.verification_status == "verified":
        return
    raise forbidden("You can message your connections and batchmates. Send a connection request first.")


async def member(db: AsyncSession, conv_id: uuid.UUID, user_id: uuid.UUID) -> ConversationMember:
    m = await db.get(ConversationMember, (conv_id, user_id))
    if not m or m.left_at:
        raise not_found("Conversation")
    return m


async def active_member_ids(db: AsyncSession, conv_id: uuid.UUID) -> list[uuid.UUID]:
    return list(
        (
            await db.execute(
                select(ConversationMember.user_id).where(
                    ConversationMember.conversation_id == conv_id, ConversationMember.left_at.is_(None)
                )
            )
        ).scalars()
    )


def direct_key(a: uuid.UUID, b: uuid.UUID) -> str:
    lo, hi = sorted([a, b])
    return f"{lo}:{hi}"


async def direct_conversation(db: AsyncSession, me: Principal, other_id: uuid.UUID) -> Conversation:
    await may_contact(db, me, other_id)
    key = direct_key(me.id, other_id)
    conv = (await db.execute(select(Conversation).where(Conversation.direct_key == key))).scalar_one_or_none()
    if conv:
        for uid in (me.id, other_id):  # someone who left a direct chat rejoins it
            m = await db.get(ConversationMember, (conv.id, uid))
            if m and m.left_at:
                m.left_at = None
        return conv
    conv = Conversation(kind="direct", direct_key=key, created_by=me.id)
    db.add(conv)
    await db.flush()
    for uid in (me.id, other_id):
        db.add(ConversationMember(conversation_id=conv.id, user_id=uid, role="member"))
        db.add(MessageReceipt(conversation_id=conv.id, user_id=uid))
    await db.flush()
    return conv


# ── messages ────────────────────────────────────────────────────────────────
async def send(
    db: AsyncSession,
    me: Principal,
    conv_id: uuid.UUID,
    *,
    body: str,
    client_id: str | None = None,
    reply_to_id: uuid.UUID | None = None,
    attachment_ids: list[uuid.UUID] | None = None,
) -> Message:
    rt = await rt_settings(db)
    body = (body or "").strip()
    attachment_ids = list(dict.fromkeys(attachment_ids or []))[:10]
    if client_id:
        dup = (await db.execute(select(Message).where(Message.sender_id == me.id, Message.client_id == client_id))).scalar_one_or_none()
        if dup:
            if dup.conversation_id != conv_id:
                raise conflict("CLIENT_ID_REUSED", "This message id was already used.")
            return dup
    await member(db, conv_id, me.id)
    if not body and not attachment_ids:
        raise AppError(422, "EMPTY_MESSAGE", "Type a message or attach a file.", [{"field": "body", "message": "Required."}])
    if len(body) > rt.max_message_chars:
        raise AppError(
            422,
            "MESSAGE_TOO_LONG",
            f"Messages can have up to {rt.max_message_chars} characters.",
            [{"field": "body", "message": "Too long."}],
        )
    await enforce(f"msg:{me.id}", rt.messages_per_minute, 60, "You are sending messages too quickly. Please slow down.")
    conv = await db.get(Conversation, conv_id)
    if conv.kind == "direct":
        others = [u for u in await active_member_ids(db, conv_id) if u != me.id]
        all_members = list(
            (await db.execute(select(ConversationMember.user_id).where(ConversationMember.conversation_id == conv_id))).scalars()
        )
        other = next((u for u in all_members if u != me.id), None)
        if other and await blocked_between(db, me.id, other):
            raise forbidden("You cannot message this member.")
        if other and other not in others:  # the other side left: bring the chat back for them
            m = await db.get(ConversationMember, (conv_id, other))
            m.left_at = None
    if reply_to_id:
        parent = await db.get(Message, reply_to_id)
        if not parent or parent.conversation_id != conv_id:
            raise not_found("Message")
    files = []
    for aid in attachment_ids:
        m = await db.get(Media, aid)
        if not m or m.deleted_at or m.uploaded_by != me.id or m.folder != "messages":
            raise AppError(422, "INVALID_ATTACHMENT", "One of the attachments is not available. Attach it again.")
        files.append(m)
    msg = Message(conversation_id=conv_id, sender_id=me.id, body=body, reply_to_id=reply_to_id, client_id=client_id)
    db.add(msg)
    await db.flush()
    await db.refresh(msg)
    for i, m in enumerate(files):
        db.add(MessageAttachment(message_id=msg.id, media_id=m.id, position=i))
    await db.flush()  # sessions do not autoflush
    preview = body[:150] if body else f"📎 {files[0].filename}" if files else ""
    await db.execute(
        update(Conversation)
        .where(Conversation.id == conv_id)
        .values(last_message_at=msg.created_at, last_message_preview=preview, last_sender_id=me.id)
    )
    await db.execute(
        update(MessageReceipt)
        .where(MessageReceipt.conversation_id == conv_id, MessageReceipt.user_id == me.id)
        .values(read_at=msg.created_at, delivered_at=msg.created_at)
    )
    out = (await messages_out(db, me.id, [msg]))[0]
    members = await active_member_ids(db, conv_id)
    for uid in members:
        live.emit_to_user(db, uid, "message:new", {"conversation_id": str(conv_id), "message": out})
    await _push_message(db, me, conv_id, [u for u in members if u != me.id], preview)
    return msg


async def _push_message(db: AsyncSession, me: Principal, conv_id: uuid.UUID, recipients: list, preview: str) -> None:
    """Mobile push for a new message: skipped for muted conversations and members who turned message pushes off."""
    from ...models import ConversationSetting, NotificationPreference
    from ...services import push

    if not recipients:
        return
    muted = set(
        (
            await db.execute(
                select(ConversationSetting.user_id).where(
                    ConversationSetting.conversation_id == conv_id,
                    ConversationSetting.user_id.in_(recipients),
                    ConversationSetting.muted.is_(True),
                )
            )
        ).scalars()
    )
    off = set(
        (
            await db.execute(
                select(NotificationPreference.user_id).where(
                    NotificationPreference.user_id.in_(recipients),
                    NotificationPreference.category == "messages",
                    NotificationPreference.push.is_(False),
                )
            )
        ).scalars()
    )
    targets = [u for u in recipients if u not in muted and u not in off]
    conv = await db.get(Conversation, conv_id)
    title = f"{me.full_name} · {conv.title}" if conv and conv.title else me.full_name
    await push.queue(
        db,
        targets,
        title,
        preview,
        {"conversation_id": str(conv_id), "link": f"/portal/messages/{conv_id}"},
        category="messages",
        collapse=f"conv-{conv_id}",
    )


async def _receipt_floor(db: AsyncSession, conv_id: uuid.UUID, me: uuid.UUID) -> tuple[datetime | None, datetime | None]:
    """Oldest delivered / read watermark among the other members (what 'delivered to all' / 'read by all' means)."""
    row = (
        await db.execute(
            select(
                func.min(func.coalesce(MessageReceipt.delivered_at, datetime(1970, 1, 1, tzinfo=UTC))),
                func.min(func.coalesce(MessageReceipt.read_at, datetime(1970, 1, 1, tzinfo=UTC))),
            )
            .join(
                ConversationMember,
                and_(
                    ConversationMember.conversation_id == MessageReceipt.conversation_id,
                    ConversationMember.user_id == MessageReceipt.user_id,
                ),
            )
            .where(MessageReceipt.conversation_id == conv_id, MessageReceipt.user_id != me, ConversationMember.left_at.is_(None))
        )
    ).one()
    return row[0], row[1]


async def messages_out(db: AsyncSession, me: uuid.UUID, msgs: list[Message]) -> list[dict]:
    if not msgs:
        return []
    ids = [m.id for m in msgs]
    atts: dict = {}
    for mid, med in (
        await db.execute(
            select(MessageAttachment.message_id, Media)
            .join(Media, Media.id == MessageAttachment.media_id)
            .where(MessageAttachment.message_id.in_(ids))
            .order_by(MessageAttachment.position)
        )
    ).all():
        atts.setdefault(mid, []).append(
            {
                "id": str(med.id),
                "filename": med.filename,
                "mime": med.mime,
                "size": med.size,
                "width": med.width,
                "height": med.height,
                "url": f"/api/v1/messages/attachments/{med.id}",
            }
        )
    reacts: dict = {}
    for mid, emoji, uid in (
        await db.execute(
            select(MessageReaction.message_id, MessageReaction.emoji, MessageReaction.user_id).where(MessageReaction.message_id.in_(ids))
        )
    ).all():
        r = reacts.setdefault(mid, {}).setdefault(emoji, {"emoji": emoji, "count": 0, "mine": False})
        r["count"] += 1
        r["mine"] = r["mine"] or uid == me
    replies = {}
    if rids := {m.reply_to_id for m in msgs if m.reply_to_id}:
        for r in (await db.execute(select(Message).where(Message.id.in_(rids)))).scalars():
            replies[r.id] = {
                "id": str(r.id),
                "sender_id": str(r.sender_id) if r.sender_id else None,
                "body": "" if r.deleted_at else r.body[:160],
                "deleted": bool(r.deleted_at),
            }
    floors: dict = {}
    out = []
    for m in msgs:
        status = None
        if m.sender_id == me and not m.deleted_at:
            if m.conversation_id not in floors:
                floors[m.conversation_id] = await _receipt_floor(db, m.conversation_id, me)
            delivered, read = floors[m.conversation_id]
            status = "read" if read and read >= m.created_at else "delivered" if delivered and delivered >= m.created_at else "sent"
        out.append(
            {
                "id": str(m.id),
                "conversation_id": str(m.conversation_id),
                "sender_id": str(m.sender_id) if m.sender_id else None,
                "kind": m.kind,
                "body": "" if m.deleted_at else m.body,
                "deleted": bool(m.deleted_at),
                "client_id": m.client_id,
                "reply_to": replies.get(m.reply_to_id),
                "attachments": [] if m.deleted_at else atts.get(m.id, []),
                "reactions": list(reacts.get(m.id, {}).values()),
                "created_at": m.created_at,
                "edited_at": m.edited_at,
                "status": status,
            }
        )
    return out


async def mark(db: AsyncSession, me: Principal, conv_id: uuid.UUID, kind: str, message_id: uuid.UUID | None = None) -> datetime | None:
    """Advance the delivered / read watermark (never backwards). Reading implies delivery."""
    await member(db, conv_id, me.id)
    if message_id:
        msg = await db.get(Message, message_id)
        if not msg or msg.conversation_id != conv_id:
            raise not_found("Message")
        at = msg.created_at
    else:
        at = (await db.execute(select(func.max(Message.created_at)).where(Message.conversation_id == conv_id))).scalar_one()
    if not at:
        return None
    rec = await db.get(MessageReceipt, (conv_id, me.id), with_for_update=True)
    if not rec:
        rec = MessageReceipt(conversation_id=conv_id, user_id=me.id)
        db.add(rec)
    changed = False
    if kind == "read" and (not rec.read_at or rec.read_at < at):
        rec.read_at, changed = at, True
    if not rec.delivered_at or rec.delivered_at < at:
        rec.delivered_at, changed = at, True
    if changed:
        for uid in await active_member_ids(db, conv_id):
            if uid != me.id:
                live.emit_to_user(
                    db,
                    uid,
                    "conversation:receipt",
                    {"conversation_id": str(conv_id), "user_id": str(me.id), "kind": kind, "at": at.isoformat()},
                )
        if kind == "read":
            live.emit_to_user(db, me.id, "conversation:read", {"conversation_id": str(conv_id)})
    return at


# ── conversations ───────────────────────────────────────────────────────────
async def conversations_out(db: AsyncSession, me: Principal, convs: list[Conversation]) -> list[dict]:
    if not convs:
        return []
    ids = [c.id for c in convs]
    members: dict = {}
    for cid, uid, role in (
        await db.execute(
            select(ConversationMember.conversation_id, ConversationMember.user_id, ConversationMember.role).where(
                ConversationMember.conversation_id.in_(ids), ConversationMember.left_at.is_(None)
            )
        )
    ).all():
        members.setdefault(cid, []).append((uid, role))
    people = await authors(db, {u for v in members.values() for u, _ in v} | {c.last_sender_id for c in convs if c.last_sender_id})
    unread = await unread_counts(db, me.id, ids)
    settings = {
        s.conversation_id: s
        for s in (
            await db.execute(
                select(ConversationSetting).where(ConversationSetting.conversation_id.in_(ids), ConversationSetting.user_id == me.id)
            )
        ).scalars()
    }
    blocked = set((await db.execute(select(BlockedUser.blocked_id).where(BlockedUser.blocker_id == me.id))).scalars())
    online = await online_many([u for v in members.values() for u, _ in v if u != me.id])
    out = []
    for c in convs:
        ms = members.get(c.id, [])
        others = [people.get(u) for u, _ in ms if u != me.id]
        s = settings.get(c.id)
        title = c.title if c.kind == "group" else (others[0]["full_name"] if others and others[0] else "Former member")
        out.append(
            {
                "id": str(c.id),
                "kind": c.kind,
                "title": title,
                "custom_title": c.title,
                "members": [
                    {**(people.get(u) or {"id": str(u)}), "role": role, "online": online.get(u, False) if u != me.id else True}
                    for u, role in ms
                ],
                "is_admin": any(u == me.id and role == "admin" for u, role in ms),
                "blocked": c.kind == "direct" and any(u in blocked for u, _ in ms if u != me.id),
                "last_message_at": c.last_message_at,
                "last_message_preview": c.last_message_preview,
                "last_sender": people.get(c.last_sender_id),
                "unread": unread.get(c.id, 0),
                "muted": bool(s and s.muted),
                "archived": bool(s and s.archived),
                "pinned": bool(s and s.pinned),
                "created_at": c.created_at,
            }
        )
    return out


async def unread_counts(db: AsyncSession, me: uuid.UUID, conv_ids: list[uuid.UUID] | None = None) -> dict:
    stmt = (
        select(Message.conversation_id, func.count())
        .join(
            ConversationMember,
            and_(
                ConversationMember.conversation_id == Message.conversation_id,
                ConversationMember.user_id == me,
                ConversationMember.left_at.is_(None),
            ),
        )
        .outerjoin(MessageReceipt, and_(MessageReceipt.conversation_id == Message.conversation_id, MessageReceipt.user_id == me))
        .where(
            or_(Message.sender_id.is_(None), Message.sender_id != me),
            Message.deleted_at.is_(None),
            or_(MessageReceipt.read_at.is_(None), Message.created_at > MessageReceipt.read_at),
        )
    )
    if conv_ids is not None:
        stmt = stmt.where(Message.conversation_id.in_(conv_ids))
    return dict((await db.execute(stmt.group_by(Message.conversation_id))).all())


# ── presence (Redis, multi-device, TTL + heartbeat) ─────────────────────────
def _conns_key(uid) -> str:
    return f"presence:conns:{uid}"


async def presence_connect(uid: uuid.UUID, sid: str, ttl: int) -> bool:
    """Register a connection; returns True when the member just came online."""
    r = redis()
    was = await is_online(uid)
    await r.set(f"presence:conn:{sid}", str(uid), ex=ttl)
    await r.sadd(_conns_key(uid), sid)
    await r.expire(_conns_key(uid), ttl * 4)
    return not was


async def presence_heartbeat(uid: uuid.UUID, sid: str, ttl: int) -> None:
    r = redis()
    await r.set(f"presence:conn:{sid}", str(uid), ex=ttl)
    await r.sadd(_conns_key(uid), sid)
    await r.expire(_conns_key(uid), ttl * 4)
    await r.set(f"presence:seen:{uid}", int(time.time()), ex=86400 * 90)


async def presence_disconnect(uid: uuid.UUID, sid: str) -> bool:
    """Drop a connection; returns True when it was the member's last live connection (now offline)."""
    r = redis()
    await r.delete(f"presence:conn:{sid}")
    await r.srem(_conns_key(uid), sid)
    await r.set(f"presence:seen:{uid}", int(time.time()), ex=86400 * 90)
    return not await is_online(uid)


async def is_online(uid: uuid.UUID) -> bool:
    r = redis()
    sids = await r.smembers(_conns_key(uid))
    alive = False
    for sid in sids:
        if await r.exists(f"presence:conn:{sid}"):
            alive = True
        else:
            await r.srem(_conns_key(uid), sid)  # expired connection (crashed gateway / lost network)
    return alive


async def online_many(uids: list[uuid.UUID]) -> dict:
    out = {}
    for u in dict.fromkeys(uids):
        try:
            out[u] = await is_online(u)
        except Exception:
            out[u] = False
    return out


async def last_seen(uid: uuid.UUID) -> int | None:
    v = await redis().get(f"presence:seen:{uid}")
    return int(v) if v else None


async def contacts_of(db: AsyncSession, uid: uuid.UUID, limit: int = 500) -> list[uuid.UUID]:
    """People who share a conversation with the member (they see the member's online status)."""
    mine = select(ConversationMember.conversation_id).where(ConversationMember.user_id == uid, ConversationMember.left_at.is_(None))
    return list(
        (
            await db.execute(
                select(func.distinct(ConversationMember.user_id))
                .where(
                    ConversationMember.conversation_id.in_(mine), ConversationMember.user_id != uid, ConversationMember.left_at.is_(None)
                )
                .limit(limit)
            )
        ).scalars()
    )
