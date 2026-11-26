"""Help & Support: member tickets with replies, FAQs and contact details; staff handle tickets and manage FAQs."""

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, File, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.db import get_db
from ...core.deps import Principal, current_user, require
from ...core.errors import AppError, forbidden, not_found
from ...core.pagination import PageParams, page_params
from ...core.redis import enforce
from ...models import Faq, Media, SupportReply, SupportTicket, User
from ...services import live, media, notifications
from ..community.service import authors

router = APIRouter(prefix="/api/v1/support", tags=["Support"])
admin = APIRouter(prefix="/api/v1/admin/support", tags=["Admin: support"])
CATEGORIES = Literal["account", "profile", "verification", "events", "jobs", "mentorship", "donations", "technical", "other"]
PRIORITIES = Literal["low", "medium", "high", "urgent"]
STATUSES = Literal["open", "in_progress", "resolved", "closed"]
FILE_TYPES = ("pdf", "doc", "docx", "txt", "png", "jpg", "jpeg", "webp")
MAX_MB = 10


def _meta(p: PageParams, total: int) -> dict:
    return {"page": p.page, "page_size": p.page_size, "total": total, "pages": max(1, -(-total // p.page_size))}


async def _files(db: AsyncSession, ids: list) -> list[dict]:
    out = []
    for mid in ids or []:
        m = await db.get(Media, uuid.UUID(str(mid)))
        if m and not m.deleted_at:
            out.append({"id": str(m.id), "filename": m.filename, "size": m.size, "url": (await media.to_public(db, m))["url"]})
    return out


async def ticket_out(db: AsyncSession, t: SupportTicket, with_replies: bool = False) -> dict:
    people = await authors(db, {t.user_id, t.assigned_to})
    out = {
        "id": str(t.id),
        "number": f"SST-{t.number}",
        "category": t.category,
        "priority": t.priority,
        "subject": t.subject,
        "description": t.description,
        "status": t.status,
        "member": people.get(t.user_id),
        "assigned_to": people.get(t.assigned_to) if t.assigned_to else None,
        "created_at": t.created_at,
        "updated_at": t.updated_at,
        "attachments": await _files(db, t.attachments),
    }
    if with_replies:
        rows = (
            (await db.execute(select(SupportReply).where(SupportReply.ticket_id == t.id).order_by(SupportReply.created_at))).scalars().all()
        )
        who = await authors(db, {r.author_id for r in rows})
        out["replies"] = [
            {
                "id": str(r.id),
                "author": who.get(r.author_id),
                "staff": r.staff,
                "body": r.body,
                "attachments": await _files(db, r.attachments),
                "created_at": r.created_at,
            }
            for r in rows
        ]
    return out


@router.post("/uploads", status_code=201, summary="Attach a file to a ticket (max 10 MB)")
async def upload(file: UploadFile = File(...), me: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await enforce(f"support-upload:{me.id}", 30, 3600)
    data = await file.read()
    if len(data) > MAX_MB * 1024 * 1024:
        raise AppError(413, "FILE_TOO_LARGE", f"Files can be up to {MAX_MB} MB.")
    name = file.filename or "file"
    if name.lower().rsplit(".", 1)[-1] not in FILE_TYPES:
        raise AppError(415, "FILE_TYPE_NOT_ALLOWED", "Attach a PDF, Word, text or image file.")
    m = await media.upload(db, data=data, filename=name, folder="support", actor=me.id, extra_types=FILE_TYPES)
    return {"data": {"id": str(m.id), "filename": m.filename, "size": m.size}}


async def _own_files(db: AsyncSession, me: Principal, ids: list[uuid.UUID]) -> list[str]:
    out = []
    for mid in dict.fromkeys(ids):
        m = await db.get(Media, mid)
        if not m or m.uploaded_by != me.id or m.folder != "support":
            raise AppError(422, "INVALID_MEDIA", "Attach the file again.")
        out.append(str(m.id))
    return out


class TicketIn(BaseModel):
    category: CATEGORIES
    priority: PRIORITIES = "medium"
    subject: str = Field(..., min_length=4, max_length=200)
    description: str = Field(..., min_length=10, max_length=5000)
    attachment_ids: list[uuid.UUID] = Field(default_factory=list, max_length=5)


@router.post("/tickets", status_code=201, summary="Open a support ticket")
async def create_ticket(body: TicketIn, me: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await enforce(f"support-ticket:{me.id}", 10, 86400, "You have opened many tickets today.")
    t = SupportTicket(
        user_id=me.id,
        category=body.category,
        priority=body.priority,
        subject=body.subject.strip(),
        description=body.description.strip(),
        attachments=await _own_files(db, me, body.attachment_ids),
        status="open",
    )
    db.add(t)
    await db.flush()
    await db.refresh(t)
    live.emit_to_room(db, "admin:alumni_admin", "support:new", {"id": str(t.id)})
    return {"data": await ticket_out(db, t)}


@router.get("/tickets", summary="Your support tickets")
async def my_tickets(p: PageParams = Depends(page_params), me: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    stmt = select(SupportTicket).where(SupportTicket.user_id == me.id)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        (await db.execute(stmt.order_by(SupportTicket.updated_at.desc()).offset((p.page - 1) * p.page_size).limit(p.page_size)))
        .scalars()
        .all()
    )
    return {"data": [await ticket_out(db, t) for t in rows], "meta": _meta(p, total)}


async def _mine(db: AsyncSession, me: Principal, ticket_id: uuid.UUID) -> SupportTicket:
    t = await db.get(SupportTicket, ticket_id)
    if not t or (t.user_id != me.id and not me.can("support.view")):
        raise not_found("Ticket")
    return t


@router.get("/tickets/{ticket_id}", summary="One ticket with its conversation")
async def get_ticket(ticket_id: uuid.UUID, me: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return {"data": await ticket_out(db, await _mine(db, me, ticket_id), with_replies=True)}


class ReplyIn(BaseModel):
    body: str = Field(..., min_length=1, max_length=5000)
    attachment_ids: list[uuid.UUID] = Field(default_factory=list, max_length=5)


@router.post("/tickets/{ticket_id}/replies", status_code=201, summary="Reply on your ticket (reopens it)")
async def reply(ticket_id: uuid.UUID, body: ReplyIn, me: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    t = await _mine(db, me, ticket_id)
    if t.user_id != me.id:
        raise forbidden("Staff reply from the support desk.")
    await enforce(f"support-reply:{me.id}", 60, 3600)
    db.add(
        SupportReply(
            ticket_id=t.id, author_id=me.id, staff=False, body=body.body.strip(), attachments=await _own_files(db, me, body.attachment_ids)
        )
    )
    if t.status in ("resolved", "closed"):
        t.status = "open"
    t.updated_at = func.now()
    await db.flush()
    await db.refresh(t)
    return {"data": await ticket_out(db, t, with_replies=True)}


@router.post("/tickets/{ticket_id}/close", summary="Close your ticket")
async def close(ticket_id: uuid.UUID, me: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    t = await _mine(db, me, ticket_id)
    if t.user_id != me.id:
        raise forbidden()
    t.status = "closed"
    await db.flush()
    await db.refresh(t)
    return {"data": await ticket_out(db, t)}


@router.get("/faqs", summary="Frequently asked questions")
async def faqs(q: str | None = Query(None, max_length=100), _: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    stmt = select(Faq).where(Faq.published.is_(True))
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(func.lower(Faq.question).like(like) | func.lower(Faq.answer).like(like))
    rows = (await db.execute(stmt.order_by(Faq.category, Faq.position, Faq.question))).scalars().all()
    return {"data": [_faq_out(f) for f in rows]}


def _faq_out(f: Faq) -> dict:
    return {
        "id": str(f.id),
        "question": f.question,
        "answer": f.answer,
        "category": f.category,
        "position": f.position,
        "published": f.published,
    }


@router.get("/contact", summary="How to reach the alumni office")
async def contact(_: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    g = await settings_store.get_group(db, "general")
    return {
        "data": {
            "email": g.contact_email,
            "phone": g.contact_phone,
            "address": g.address,
            "hours": getattr(g, "office_hours", None) or "Mon – Fri, 9:00 AM – 5:00 PM",
            "name": g.app_name,
        }
    }


# ── staff ───────────────────────────────────────────────────────────────────
@admin.get("/tickets", summary="Support tickets")
async def admin_tickets(
    status: STATUSES | None = None,
    priority: PRIORITIES | None = None,
    q: str | None = Query(None, max_length=100),
    p: PageParams = Depends(page_params),
    me: Principal = Depends(require("support.view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(SupportTicket)
    if status:
        stmt = stmt.where(SupportTicket.status == status)
    if priority:
        stmt = stmt.where(SupportTicket.priority == priority)
    if q:
        like = f"%{q.strip().lower()}%"
        users = select(User.id).where(func.lower(User.full_name).like(like) | func.lower(User.email).like(like))
        stmt = stmt.where(func.lower(SupportTicket.subject).like(like) | SupportTicket.user_id.in_(users))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    order = [SupportTicket.updated_at.desc()]
    rows = (await db.execute(stmt.order_by(*order).offset((p.page - 1) * p.page_size).limit(p.page_size))).scalars().all()
    counts = dict((await db.execute(select(SupportTicket.status, func.count()).group_by(SupportTicket.status))).all())
    return {"data": [await ticket_out(db, t) for t in rows], "meta": {**_meta(p, total), "counts": counts}}


class StaffReplyIn(ReplyIn):
    status: STATUSES | None = None


@admin.post("/tickets/{ticket_id}/replies", status_code=201, summary="Reply to a member (and optionally change the status)")
async def staff_reply(
    ticket_id: uuid.UUID, body: StaffReplyIn, me: Principal = Depends(require("support.edit")), db: AsyncSession = Depends(get_db)
):
    t = await db.get(SupportTicket, ticket_id)
    if not t:
        raise not_found("Ticket")
    db.add(
        SupportReply(
            ticket_id=t.id, author_id=me.id, staff=True, body=body.body.strip(), attachments=await _own_files(db, me, body.attachment_ids)
        )
    )
    t.status = body.status or ("in_progress" if t.status == "open" else t.status)
    t.assigned_to = t.assigned_to or me.id
    t.updated_at = func.now()
    await db.flush()
    await notifications.notify(
        db,
        t.user_id,
        "support",
        "support_reply",
        f"New reply on your support request SST-{t.number}",
        body=body.body[:140],
        link=f"/portal/account/support?ticket={t.id}",
        actor_id=me.id,
    )
    await db.refresh(t)
    return {"data": await ticket_out(db, t, with_replies=True)}


class TicketEdit(BaseModel):
    status: STATUSES | None = None
    priority: PRIORITIES | None = None
    assign_to_me: bool | None = None


@admin.patch("/tickets/{ticket_id}", summary="Change status or priority, or take the ticket")
async def edit_ticket(
    ticket_id: uuid.UUID, body: TicketEdit, me: Principal = Depends(require("support.edit")), db: AsyncSession = Depends(get_db)
):
    t = await db.get(SupportTicket, ticket_id)
    if not t:
        raise not_found("Ticket")
    old = t.status
    if body.status:
        t.status = body.status
    if body.priority:
        t.priority = body.priority
    if body.assign_to_me:
        t.assigned_to = me.id
    t.updated_at = func.now()
    await db.flush()
    if body.status and body.status != old and body.status in ("resolved", "closed"):
        await notifications.notify(
            db,
            t.user_id,
            "support",
            "support_status",
            f"Your support request SST-{t.number} was {body.status}",
            link=f"/portal/account/support?ticket={t.id}",
        )
    await db.refresh(t)
    return {"data": await ticket_out(db, t, with_replies=True)}


class FaqIn(BaseModel):
    question: str = Field(..., min_length=5, max_length=300)
    answer: str = Field(..., min_length=5, max_length=5000)
    category: str = Field("General", min_length=2, max_length=60)
    position: int = Field(0, ge=0, le=1000)
    published: bool = True


@admin.get("/faqs", summary="All FAQs")
async def admin_faqs(me: Principal = Depends(require("support.view")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Faq).order_by(Faq.category, Faq.position, Faq.question))).scalars().all()
    return {"data": [_faq_out(f) for f in rows]}


@admin.post("/faqs", status_code=201, summary="Add an FAQ")
async def add_faq(body: FaqIn, me: Principal = Depends(require("support.edit")), db: AsyncSession = Depends(get_db)):
    f = Faq(**body.model_dump())
    db.add(f)
    await db.flush()
    return {"data": _faq_out(f)}


@admin.put("/faqs/{faq_id}", summary="Edit an FAQ")
async def edit_faq(faq_id: uuid.UUID, body: FaqIn, me: Principal = Depends(require("support.edit")), db: AsyncSession = Depends(get_db)):
    f = await db.get(Faq, faq_id)
    if not f:
        raise not_found("FAQ")
    for k, v in body.model_dump().items():
        setattr(f, k, v)
    return {"data": _faq_out(f)}


@admin.delete("/faqs/{faq_id}", summary="Delete an FAQ")
async def delete_faq(faq_id: uuid.UUID, me: Principal = Depends(require("support.edit")), db: AsyncSession = Depends(get_db)):
    f = await db.get(Faq, faq_id)
    if not f:
        raise not_found("FAQ")
    await db.delete(f)
    return {"data": {"ok": True}}
