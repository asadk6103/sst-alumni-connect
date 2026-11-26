"""Messaging REST API (the real-time gateway offers the same send/read operations over Socket.IO)."""

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, File, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.deps import Principal, require, require_module
from ...core.errors import AppError, conflict, forbidden, not_found
from ...core.redis import enforce
from ...models import (
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
from ...services import live, media
from ..community.service import authors, decode_cursor, encode_cursor
from . import service as svc

router = APIRouter(prefix="/api/v1/messages", tags=["Messaging"], dependencies=[Depends(require_module("messaging"))])
chat = require("portal.message")


@router.get("/conversations", summary="Your conversations (most recent first, with unread counts)")
async def conversations(
    q: str | None = Query(None, max_length=100),
    archived: bool = False,
    filter: Literal["all", "unread", "starred"] = "all",
    p: Principal = Depends(chat),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Conversation)
        .join(
            ConversationMember,
            and_(
                ConversationMember.conversation_id == Conversation.id,
                ConversationMember.user_id == p.id,
                ConversationMember.left_at.is_(None),
            ),
        )
        .outerjoin(ConversationSetting, and_(ConversationSetting.conversation_id == Conversation.id, ConversationSetting.user_id == p.id))
        .where(func.coalesce(ConversationSetting.archived, False).is_(archived))
        .where(or_(Conversation.kind == "group", Conversation.last_message_at.is_not(None), Conversation.created_by == p.id))
    )
    if q:
        like = f"%{q.strip().lower()}%"
        others = (
            select(ConversationMember.conversation_id)
            .join(User, User.id == ConversationMember.user_id)
            .where(User.id != p.id, func.lower(User.full_name).like(like))
        )
        stmt = stmt.where(or_(func.lower(Conversation.title).like(like), Conversation.id.in_(others)))
    if filter == "starred":
        stmt = stmt.where(ConversationSetting.starred.is_(True))
    rows = (
        (
            await db.execute(
                stmt.order_by(
                    func.coalesce(ConversationSetting.pinned, False).desc(),
                    Conversation.last_message_at.desc().nulls_last(),
                    Conversation.created_at.desc(),
                ).limit(200)
            )
        )
        .scalars()
        .all()
    )
    data = await svc.conversations_out(db, p, list(rows))
    if filter == "unread":
        data = [c for c in data if c.get("unread")]
    return {"data": data}


class DirectIn(BaseModel):
    user_id: uuid.UUID


@router.post("/conversations/direct", summary="Open (or create) the one-to-one chat with a member")
async def open_direct(body: DirectIn, p: Principal = Depends(chat), db: AsyncSession = Depends(get_db)):
    conv = await svc.direct_conversation(db, p, body.user_id)
    return {"data": (await svc.conversations_out(db, p, [conv]))[0]}


class GroupIn(BaseModel):
    title: str = Field(..., min_length=2, max_length=120)
    member_ids: list[uuid.UUID] = Field(..., min_length=1, max_length=99)


@router.post("/conversations/group", status_code=201, summary="Create a group chat")
async def create_group(body: GroupIn, p: Principal = Depends(chat), db: AsyncSession = Depends(get_db)):
    await enforce(f"group-chat:{p.id}", 20, 86400)
    ids = [u for u in dict.fromkeys(body.member_ids) if u != p.id]
    for uid in ids:
        await svc.may_contact(db, p, uid)
    conv = Conversation(kind="group", title=body.title.strip(), created_by=p.id)
    db.add(conv)
    await db.flush()
    for uid in [p.id, *ids]:
        db.add(ConversationMember(conversation_id=conv.id, user_id=uid, role="admin" if uid == p.id else "member"))
        db.add(MessageReceipt(conversation_id=conv.id, user_id=uid))
    await db.flush()
    await _system(db, conv.id, f"{p.full_name} created the group “{conv.title}”")
    for uid in ids:
        live.emit_to_user(db, uid, "conversation:new", {"conversation_id": str(conv.id)})
    return {"data": (await svc.conversations_out(db, p, [conv]))[0]}


async def _system(db: AsyncSession, conv_id: uuid.UUID, text: str) -> None:
    msg = Message(conversation_id=conv_id, sender_id=None, kind="system", body=text)
    db.add(msg)
    await db.flush()
    await db.refresh(msg)
    await db.execute(
        update(Conversation).where(Conversation.id == conv_id).values(last_message_at=msg.created_at, last_message_preview=text[:150])
    )


@router.get("/conversations/{conv_id}", summary="One conversation")
async def get_conversation(conv_id: uuid.UUID, p: Principal = Depends(chat), db: AsyncSession = Depends(get_db)):
    await svc.member(db, conv_id, p.id)
    return {"data": (await svc.conversations_out(db, p, [await db.get(Conversation, conv_id)]))[0]}


class GroupEdit(BaseModel):
    title: str = Field(..., min_length=2, max_length=120)


@router.patch("/conversations/{conv_id}", summary="Rename a group chat (group admins)")
async def rename(conv_id: uuid.UUID, body: GroupEdit, p: Principal = Depends(chat), db: AsyncSession = Depends(get_db)):
    m = await svc.member(db, conv_id, p.id)
    conv = await db.get(Conversation, conv_id)
    if conv.kind != "group" or m.role != "admin":
        raise forbidden("Only group admins can rename the group.")
    conv.title = body.title.strip()
    await _system(db, conv_id, f"{p.full_name} renamed the group to “{conv.title}”")
    for uid in await svc.active_member_ids(db, conv_id):
        live.emit_to_user(db, uid, "conversation:updated", {"conversation_id": str(conv_id)})
    return {"data": (await svc.conversations_out(db, p, [conv]))[0]}


class MembersIn(BaseModel):
    user_ids: list[uuid.UUID] = Field(..., min_length=1, max_length=50)


@router.post("/conversations/{conv_id}/members", summary="Add members to a group chat (group admins)")
async def add_members(conv_id: uuid.UUID, body: MembersIn, p: Principal = Depends(chat), db: AsyncSession = Depends(get_db)):
    m = await svc.member(db, conv_id, p.id)
    conv = await db.get(Conversation, conv_id)
    if conv.kind != "group" or m.role != "admin":
        raise forbidden("Only group admins can add members.")
    current = await svc.active_member_ids(db, conv_id)
    if len(set(current) | set(body.user_ids)) > 100:
        raise conflict("GROUP_FULL", "Group chats can have up to 100 members.")
    added = []
    for uid in dict.fromkeys(body.user_ids):
        if uid in current:
            continue
        await svc.may_contact(db, p, uid)
        existing = await db.get(ConversationMember, (conv_id, uid))
        if existing:
            existing.left_at, existing.role = None, "member"
        else:
            db.add(ConversationMember(conversation_id=conv_id, user_id=uid))
        if not await db.get(MessageReceipt, (conv_id, uid)):
            db.add(MessageReceipt(conversation_id=conv_id, user_id=uid, read_at=func.now(), delivered_at=func.now()))
        added.append(uid)
    if added:
        names = await authors(db, set(added))
        await _system(db, conv_id, f"{p.full_name} added {', '.join(names[u]['full_name'] for u in added if u in names)}")
        for uid in [*current, *added]:
            live.emit_to_user(db, uid, "conversation:updated", {"conversation_id": str(conv_id)})
    return {"data": (await svc.conversations_out(db, p, [conv]))[0]}


@router.delete("/conversations/{conv_id}/members/{user_id}", summary="Leave a conversation, or remove a member (group admins)")
async def remove_member(conv_id: uuid.UUID, user_id: uuid.UUID, p: Principal = Depends(chat), db: AsyncSession = Depends(get_db)):
    me = await svc.member(db, conv_id, p.id)
    conv = await db.get(Conversation, conv_id)
    if user_id != p.id and (conv.kind != "group" or me.role != "admin"):
        raise forbidden()
    target = await svc.member(db, conv_id, user_id)
    target.left_at = func.now()
    await db.flush()
    if conv.kind == "group":
        remaining = await svc.active_member_ids(db, conv_id)
        if target.role == "admin" and remaining:
            admins = (
                await db.execute(
                    select(func.count())
                    .select_from(ConversationMember)
                    .where(
                        ConversationMember.conversation_id == conv_id,
                        ConversationMember.role == "admin",
                        ConversationMember.left_at.is_(None),
                    )
                )
            ).scalar_one()
            if not admins:  # hand admin to the longest-standing member
                first = (
                    await db.execute(
                        select(ConversationMember)
                        .where(ConversationMember.conversation_id == conv_id, ConversationMember.left_at.is_(None))
                        .order_by(ConversationMember.joined_at)
                        .limit(1)
                    )
                ).scalar_one()
                first.role = "admin"
        who = (await authors(db, {user_id})).get(user_id, {}).get("full_name", "A member")
        await _system(db, conv_id, f"{who} left the group" if user_id == p.id else f"{p.full_name} removed {who}")
        for uid in [*remaining, user_id]:
            live.emit_to_user(db, uid, "conversation:updated", {"conversation_id": str(conv_id)})
    return {"data": {"ok": True}}


class SettingsIn(BaseModel):
    muted: bool | None = None
    archived: bool | None = None
    pinned: bool | None = None
    starred: bool | None = None


@router.put("/conversations/{conv_id}/settings", summary="Mute, archive or pin a conversation (for you)")
async def conv_settings(conv_id: uuid.UUID, body: SettingsIn, p: Principal = Depends(chat), db: AsyncSession = Depends(get_db)):
    await svc.member(db, conv_id, p.id)
    s = await db.get(ConversationSetting, (conv_id, p.id))
    if not s:
        s = ConversationSetting(conversation_id=conv_id, user_id=p.id, muted=False, archived=False, pinned=False, starred=False)
        db.add(s)
    for f in body.model_fields_set:
        setattr(s, f, getattr(body, f))
    return {"data": {"muted": s.muted, "archived": s.archived, "pinned": s.pinned, "starred": s.starred}}


@router.get("/conversations/{conv_id}/messages", summary="Messages, newest page first (cursor `before`), oldest-first within a page")
async def list_messages(
    conv_id: uuid.UUID,
    before: str | None = None,
    limit: int = Query(40, ge=1, le=100),
    q: str | None = Query(None, max_length=100),
    p: Principal = Depends(chat),
    db: AsyncSession = Depends(get_db),
):
    m = await svc.member(db, conv_id, p.id)
    stmt = select(Message).where(Message.conversation_id == conv_id)
    conv = await db.get(Conversation, conv_id)
    if conv.kind == "group":  # members see the group from when they joined
        stmt = stmt.where(Message.created_at >= m.joined_at)
    if q:
        stmt = stmt.where(Message.deleted_at.is_(None), func.lower(Message.body).like(f"%{q.strip().lower()}%"))
    if c := decode_cursor(before):
        stmt = stmt.where(or_(Message.created_at < c[0], and_(Message.created_at == c[0], Message.id < c[1])))
    rows = (await db.execute(stmt.order_by(Message.created_at.desc(), Message.id.desc()).limit(limit + 1))).scalars().all()
    more = len(rows) > limit
    rows = list(reversed(rows[:limit]))
    people = await authors(db, {r.sender_id for r in rows if r.sender_id})
    return {
        "data": await svc.messages_out(db, p.id, rows),
        "meta": {
            "before": encode_cursor(rows[0].created_at, rows[0].id) if more and rows else None,
            "people": {str(k): v for k, v in people.items()},
        },
    }


class SendIn(BaseModel):
    body: str = Field("", max_length=20000)
    client_id: str | None = Field(None, max_length=64, pattern=r"^[A-Za-z0-9_\-]+$")
    reply_to_id: uuid.UUID | None = None
    attachment_ids: list[uuid.UUID] = Field(default_factory=list, max_length=10)


@router.post("/conversations/{conv_id}/messages", status_code=201, summary="Send a message (idempotent with client_id)")
async def send_message(conv_id: uuid.UUID, body: SendIn, p: Principal = Depends(chat), db: AsyncSession = Depends(get_db)):
    msg = await svc.send(
        db, p, conv_id, body=body.body, client_id=body.client_id, reply_to_id=body.reply_to_id, attachment_ids=body.attachment_ids
    )
    return {"data": (await svc.messages_out(db, p.id, [msg]))[0]}


class EditIn(BaseModel):
    body: str = Field(..., min_length=1, max_length=20000)


async def _own_message(db: AsyncSession, message_id: uuid.UUID, p: Principal) -> Message:
    msg = await db.get(Message, message_id)
    if not msg or msg.deleted_at:
        raise not_found("Message")
    await svc.member(db, msg.conversation_id, p.id)
    if msg.sender_id != p.id:
        raise forbidden("You can only change your own messages.")
    return msg


async def _broadcast_update(db: AsyncSession, p: Principal, msg: Message) -> dict:
    await db.flush()
    await db.refresh(msg)
    out = (await svc.messages_out(db, p.id, [msg]))[0]
    for uid in await svc.active_member_ids(db, msg.conversation_id):
        live.emit_to_user(db, uid, "message:updated", {"conversation_id": str(msg.conversation_id), "message": {**out, "status": None}})
    return out


@router.patch("/{message_id}", summary="Edit your message")
async def edit_message(message_id: uuid.UUID, body: EditIn, p: Principal = Depends(chat), db: AsyncSession = Depends(get_db)):
    msg = await _own_message(db, message_id, p)
    rt = await svc.rt_settings(db)
    if len(body.body.strip()) > rt.max_message_chars:
        raise AppError(422, "MESSAGE_TOO_LONG", f"Messages can have up to {rt.max_message_chars} characters.")
    msg.body, msg.edited_at = body.body.strip(), func.now()
    return {"data": await _broadcast_update(db, p, msg)}


@router.delete("/{message_id}", summary="Delete your message (for everyone)")
async def delete_message(message_id: uuid.UUID, p: Principal = Depends(chat), db: AsyncSession = Depends(get_db)):
    msg = await _own_message(db, message_id, p)
    msg.deleted_at = func.now()
    for att in (await db.execute(select(MessageAttachment).where(MessageAttachment.message_id == msg.id))).scalars():
        if m := await db.get(Media, att.media_id):
            m.deleted_at = func.now()
    return {"data": await _broadcast_update(db, p, msg)}


@router.put("/{message_id}/reactions/{emoji}", summary="React to a message")
async def react(message_id: uuid.UUID, emoji: str, p: Principal = Depends(chat), db: AsyncSession = Depends(get_db)):
    if not 1 <= len(emoji) <= 8 or any(ch.isalnum() or ch.isspace() for ch in emoji):
        raise AppError(422, "INVALID_EMOJI", "Choose an emoji.")
    msg = await db.get(Message, message_id)
    if not msg or msg.deleted_at:
        raise not_found("Message")
    await svc.member(db, msg.conversation_id, p.id)
    if not await db.get(MessageReaction, (msg.id, p.id, emoji)):
        db.add(MessageReaction(message_id=msg.id, user_id=p.id, emoji=emoji))
    return {"data": await _broadcast_update(db, p, msg)}


@router.delete("/{message_id}/reactions/{emoji}", summary="Remove your reaction")
async def unreact(message_id: uuid.UUID, emoji: str, p: Principal = Depends(chat), db: AsyncSession = Depends(get_db)):
    msg = await db.get(Message, message_id)
    if not msg:
        raise not_found("Message")
    await svc.member(db, msg.conversation_id, p.id)
    await db.execute(
        delete(MessageReaction).where(MessageReaction.message_id == msg.id, MessageReaction.user_id == p.id, MessageReaction.emoji == emoji)
    )
    return {"data": await _broadcast_update(db, p, msg)}


class MarkIn(BaseModel):
    message_id: uuid.UUID | None = None


@router.post("/conversations/{conv_id}/read", summary="Mark messages as read (up to message_id, default: all)")
async def read(conv_id: uuid.UUID, body: MarkIn, p: Principal = Depends(chat), db: AsyncSession = Depends(get_db)):
    at = await svc.mark(db, p, conv_id, "read", body.message_id)
    return {"data": {"read_at": at}}


@router.post("/conversations/{conv_id}/delivered", summary="Acknowledge delivery (up to message_id)")
async def delivered(conv_id: uuid.UUID, body: MarkIn, p: Principal = Depends(chat), db: AsyncSession = Depends(get_db)):
    at = await svc.mark(db, p, conv_id, "delivered", body.message_id)
    return {"data": {"delivered_at": at}}


@router.get("/unread", summary="Unread messages in total and per conversation")
async def unread(p: Principal = Depends(chat), db: AsyncSession = Depends(get_db)):
    counts = await svc.unread_counts(db, p.id)
    muted = set(
        (
            await db.execute(
                select(ConversationSetting.conversation_id).where(ConversationSetting.user_id == p.id, ConversationSetting.muted.is_(True))
            )
        ).scalars()
    )
    return {"data": {"total": sum(n for c, n in counts.items() if c not in muted), "conversations": {str(k): v for k, v in counts.items()}}}


@router.post("/uploads", status_code=201, summary="Upload an attachment (image or document; private)")
async def upload(file: UploadFile = File(...), p: Principal = Depends(chat), db: AsyncSession = Depends(get_db)):
    rt = await svc.rt_settings(db)
    await enforce(f"msg-upload:{p.id}", 60, 3600)
    data = await file.read(rt.attachment_max_mb * 1024 * 1024 + 1)
    if len(data) > rt.attachment_max_mb * 1024 * 1024:
        raise AppError(413, "FILE_TOO_LARGE", f"Attachments can be up to {rt.attachment_max_mb} MB.")
    m = await media.upload(db, data=data, filename=file.filename or "file", folder="messages", actor=p.id, private=True)
    return {"data": {"id": str(m.id), "filename": m.filename, "mime": m.mime, "size": m.size, "width": m.width, "height": m.height}}


@router.get("/attachments/{media_id}", summary="Download an attachment (conversation members only)")
async def attachment(media_id: uuid.UUID, p: Principal = Depends(chat), db: AsyncSession = Depends(get_db)):
    m = await db.get(Media, media_id)
    if not m or m.deleted_at or m.folder != "messages":
        raise not_found("File")
    if m.uploaded_by != p.id:
        conv_id = (
            await db.execute(
                select(Message.conversation_id)
                .join(MessageAttachment, MessageAttachment.message_id == Message.id)
                .where(MessageAttachment.media_id == media_id)
            )
        ).scalar_one_or_none()
        if not conv_id:
            raise not_found("File")
        await svc.member(db, conv_id, p.id)
    return media.download_response(m, await media.read(db, m))


@router.get("/blocks", summary="Members you have blocked")
async def blocks(p: Principal = Depends(chat), db: AsyncSession = Depends(get_db)):
    ids = list((await db.execute(select(BlockedUser.blocked_id).where(BlockedUser.blocker_id == p.id))).scalars())
    people = await authors(db, set(ids))
    return {"data": [people[i] for i in ids if i in people]}


@router.put("/blocks/{user_id}", summary="Block a member (they can no longer message you)")
async def block(user_id: uuid.UUID, p: Principal = Depends(chat), db: AsyncSession = Depends(get_db)):
    if user_id == p.id:
        raise conflict("SELF", "You cannot block yourself.")
    if not await db.get(User, user_id):
        raise not_found("Member")
    if not await db.get(BlockedUser, (p.id, user_id)):
        db.add(BlockedUser(blocker_id=p.id, blocked_id=user_id))
    return {"data": {"blocked": True}}


@router.delete("/blocks/{user_id}", summary="Unblock a member")
async def unblock(user_id: uuid.UUID, p: Principal = Depends(chat), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(BlockedUser).where(BlockedUser.blocker_id == p.id, BlockedUser.blocked_id == user_id))
    return {"data": {"blocked": False}}


@router.get("/presence", summary="Online status of members you share a conversation with")
async def presence(ids: str = Query(..., max_length=2000), p: Principal = Depends(chat), db: AsyncSession = Depends(get_db)):
    try:
        wanted = [uuid.UUID(x) for x in ids.split(",") if x][:100]
    except ValueError as e:
        raise AppError(422, "INVALID_IDS", "Invalid member ids.") from e
    allowed = set(await svc.contacts_of(db, p.id, 5000))
    out = {}
    for u in wanted:
        if u in allowed:
            out[str(u)] = {"online": await svc.is_online(u), "last_seen": await svc.last_seen(u)}
    return {"data": out}
