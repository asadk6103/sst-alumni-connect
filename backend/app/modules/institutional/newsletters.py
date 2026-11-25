"""Newsletters: double opt-in subscriptions, member preferences, composing, audiences, scheduled and resumable sending."""

import csv
import io
import secrets
import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from pydantic import BaseModel, EmailStr, Field, TypeAdapter, ValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.audit import record
from ...core.db import get_db
from ...core.deps import Principal, client_ip, current_user, require
from ...core.errors import AppError, conflict, not_found
from ...core.pagination import PageParams, csv_response, page_params
from ...core.redis import enforce
from ...models import AlumniProfile, Batch, Newsletter, NewsletterDelivery, NewsletterSubscriber, User
from ...services import messaging
from ...services.templates import simple_html

public = APIRouter(prefix="/api/v1/public/newsletter", tags=["Public"])
router = APIRouter(prefix="/api/v1/newsletter", tags=["Newsletter"])
admin = APIRouter(prefix="/api/v1/admin/newsletters", tags=["Admin: newsletters"])
_email = TypeAdapter(EmailStr)
CHUNK = 200


def _meta(p: PageParams, total: int) -> dict:
    return {"page": p.page, "page_size": p.page_size, "total": total, "pages": max(1, -(-total // p.page_size))}


async def _subscriber(db: AsyncSession, email: str) -> NewsletterSubscriber | None:
    return (
        await db.execute(select(NewsletterSubscriber).where(func.lower(NewsletterSubscriber.email) == email.lower()))
    ).scalar_one_or_none()


# ── public (double opt-in) ──────────────────────────────────────────────────
class SubscribeIn(BaseModel):
    email: EmailStr
    name: str | None = Field(None, max_length=150)


@public.post("/subscribe", status_code=202, summary="Subscribe to the newsletter (a confirmation email is sent)")
async def subscribe(body: SubscribeIn, request: Request, db: AsyncSession = Depends(get_db)):
    await enforce(f"nl-sub-ip:{client_ip(request)}", 10, 3600, "Too many requests. Please try again later.")
    mods = await settings_store.modules(db)
    if not mods.get("newsletters", True):
        raise AppError(404, "MODULE_DISABLED", "This feature is currently not available.")
    s = await _subscriber(db, body.email)
    if s and s.status == "subscribed":
        return {"data": {"message": "Please check your inbox to confirm your subscription."}}
    if not s:
        s = NewsletterSubscriber(
            email=str(body.email).lower(), name=body.name, status="pending", token=secrets.token_urlsafe(32), source="website"
        )
        db.add(s)
    else:
        s.status, s.token = "pending", secrets.token_urlsafe(32)
    await db.flush()
    await enforce(f"nl-sub:{s.email}", 3, 86400, "Please check your inbox — we already sent a confirmation.")
    general = await settings_store.get_group(db, "general")
    await messaging.queue_email(
        db, s.email, "newsletter.confirm", {"name": body.name or "there", "link": f"{general.app_url}/newsletter/confirm?token={s.token}"}
    )
    return {"data": {"message": "Please check your inbox to confirm your subscription."}}


class TokenIn(BaseModel):
    token: str = Field(..., min_length=10, max_length=100)


@public.post("/confirm", summary="Confirm a subscription")
async def confirm(body: TokenIn, db: AsyncSession = Depends(get_db)):
    s = (await db.execute(select(NewsletterSubscriber).where(NewsletterSubscriber.token == body.token))).scalar_one_or_none()
    if not s:
        raise AppError(400, "INVALID_LINK", "This link is not valid.")
    if s.status != "subscribed":
        s.status, s.confirmed_at, s.unsubscribed_at = "subscribed", datetime.now(UTC), None
    return {"data": {"email": s.email, "status": s.status}}


@public.post("/unsubscribe", summary="Unsubscribe (one click from any newsletter)")
async def unsubscribe(body: TokenIn, db: AsyncSession = Depends(get_db)):
    s = (await db.execute(select(NewsletterSubscriber).where(NewsletterSubscriber.token == body.token))).scalar_one_or_none()
    if not s:
        raise AppError(400, "INVALID_LINK", "This link is not valid.")
    s.status, s.unsubscribed_at = "unsubscribed", datetime.now(UTC)
    return {"data": {"email": s.email, "status": s.status}}


# ── members ─────────────────────────────────────────────────────────────────
@router.get("/me", summary="Your newsletter subscription")
async def my_subscription(me: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    s = await _subscriber(db, me.email)
    # verified alumni receive alumni newsletters unless they unsubscribed
    return {"data": {"subscribed": (s.status == "subscribed") if s else True, "email": me.email}}


class MeIn(BaseModel):
    subscribed: bool


@router.put("/me", summary="Subscribe or unsubscribe")
async def set_subscription(body: MeIn, me: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    s = await _subscriber(db, me.email)
    if not s:
        s = NewsletterSubscriber(
            email=me.email.lower(), name=me.full_name, user_id=me.id, token=secrets.token_urlsafe(32), source="portal", status="pending"
        )
        db.add(s)
    s.user_id = me.id
    s.status = "subscribed" if body.subscribed else "unsubscribed"
    s.confirmed_at = s.confirmed_at or (datetime.now(UTC) if body.subscribed else None)
    s.unsubscribed_at = None if body.subscribed else datetime.now(UTC)
    await db.flush()
    return {"data": {"subscribed": body.subscribed, "email": me.email}}


# ── recipients and sending ──────────────────────────────────────────────────
async def recipients(db: AsyncSession, n: Newsletter) -> list[tuple[str, str | None]]:
    """(email, name) of everyone the issue goes to; unsubscribed addresses are always excluded."""
    unsub = select(func.lower(NewsletterSubscriber.email)).where(NewsletterSubscriber.status == "unsubscribed")
    out: dict[str, str | None] = {}
    if n.audience == "all_subscribers":
        for e, name in (
            await db.execute(
                select(NewsletterSubscriber.email, NewsletterSubscriber.name).where(NewsletterSubscriber.status == "subscribed")
            )
        ).all():
            out[e.lower()] = name
    if n.audience in ("all_subscribers", "verified_alumni", "batch"):
        stmt = (
            select(User.email, User.full_name)
            .join(AlumniProfile, AlumniProfile.user_id == User.id)
            .where(
                User.deleted_at.is_(None),
                User.status == "active",
                AlumniProfile.verification_status == "verified",
                func.lower(User.email).not_in(unsub),
            )
        )
        if n.audience == "batch":
            stmt = stmt.where(AlumniProfile.batch_id == n.batch_id)
        for e, name in (await db.execute(stmt)).all():
            out.setdefault(e.lower(), name)
    return sorted(out.items())


async def _token_for(db: AsyncSession, email: str, name: str | None) -> str:
    s = await _subscriber(db, email)
    if not s:
        s = NewsletterSubscriber(
            email=email, name=name, status="subscribed", token=secrets.token_urlsafe(32), source="portal", confirmed_at=datetime.now(UTC)
        )
        db.add(s)
        await db.flush()
    return s.token


async def _footer(db: AsyncSession, email: str, name: str | None) -> str:
    general = await settings_store.get_group(db, "general")
    token = await _token_for(db, email, name)
    return (
        f'<p style="margin-top:28px;font-size:12px;color:#718096">You receive this as a member or subscriber of {general.app_name}. '
        f'<a href="{general.app_url}/newsletter/unsubscribe?token={token}">Unsubscribe</a></p>'
    )


def render_issue(n: Newsletter) -> str:
    pre = f'<div style="display:none;max-height:0;overflow:hidden">{n.preheader}</div>' if n.preheader else ""
    return pre + simple_html(n.body)


async def send_issue(db: AsyncSession, newsletter_id: uuid.UUID) -> int:
    """Send to everyone not yet delivered (resumable; each address once). Returns the number queued now."""
    n = await db.get(Newsletter, newsletter_id, with_for_update=True)
    if not n or n.status not in ("sending", "scheduled"):
        return 0
    n.status = "sending"
    content = render_issue(n)
    queued = 0
    for email, name in await recipients(db, n):
        ins = await db.execute(
            pg_insert(NewsletterDelivery)
            .values(newsletter_id=n.id, email=email)
            .on_conflict_do_nothing(index_elements=["newsletter_id", "email"])
        )
        if not ins.rowcount:
            continue
        log_id = await messaging.queue_html_email(db, email, n.subject, content, "newsletter", await _footer(db, email, name))
        await db.execute(
            NewsletterDelivery.__table__.update()
            .where(NewsletterDelivery.newsletter_id == n.id, NewsletterDelivery.email == email)
            .values(log_id=log_id)
        )
        queued += 1
        if queued % CHUNK == 0:
            await db.commit()  # keep progress; a crash resumes after the last committed chunk
            n = await db.get(Newsletter, newsletter_id)
    n.recipient_count = (
        await db.execute(select(func.count()).select_from(NewsletterDelivery).where(NewsletterDelivery.newsletter_id == n.id))
    ).scalar_one()
    n.status, n.sent_at = "sent", datetime.now(UTC)
    return queued


async def due_issues(db: AsyncSession) -> list[uuid.UUID]:
    return list(
        (
            await db.execute(
                select(Newsletter.id).where(
                    Newsletter.status.in_(["scheduled", "sending"]),
                    or_(Newsletter.scheduled_at.is_(None), Newsletter.scheduled_at <= datetime.now(UTC)),
                )
            )
        ).scalars()
    )


# ── communications staff ────────────────────────────────────────────────────
class NewsletterIn(BaseModel):
    subject: str = Field(..., min_length=3, max_length=200)
    preheader: str = Field("", max_length=200)
    body: str = Field(..., min_length=10, max_length=100000)
    audience: Literal["all_subscribers", "verified_alumni", "batch"] = "all_subscribers"
    batch_id: uuid.UUID | None = None


async def newsletter_out(db: AsyncSession, n: Newsletter, detail: bool = False) -> dict:
    batch = await db.get(Batch, n.batch_id) if n.batch_id else None
    out = {
        "id": str(n.id),
        "subject": n.subject,
        "preheader": n.preheader,
        "audience": n.audience,
        "batch_id": str(n.batch_id) if n.batch_id else None,
        "batch": batch.name if batch else None,
        "status": n.status,
        "scheduled_at": n.scheduled_at,
        "sent_at": n.sent_at,
        "recipient_count": n.recipient_count,
        "created_at": n.created_at,
        "updated_at": n.updated_at,
    }
    if detail:
        out["body"] = n.body
        out["estimated_recipients"] = len(await recipients(db, n)) if n.status in ("draft", "scheduled") else n.recipient_count
    return out


@admin.get("", summary="Newsletters")
async def admin_list(
    status: str | None = Query(None, max_length=20),
    p: PageParams = Depends(page_params),
    me: Principal = Depends(require("communications.view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Newsletter)
    if status:
        stmt = stmt.where(Newsletter.status == status)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        (await db.execute(stmt.order_by(Newsletter.created_at.desc()).offset((p.page - 1) * p.page_size).limit(p.page_size)))
        .scalars()
        .all()
    )
    counts = dict((await db.execute(select(NewsletterSubscriber.status, func.count()).group_by(NewsletterSubscriber.status))).all())
    return {"data": [await newsletter_out(db, n) for n in rows], "meta": {**_meta(p, total), "subscribers": counts}}


async def _check(db: AsyncSession, body: NewsletterIn) -> None:
    if body.audience == "batch" and (not body.batch_id or not await db.get(Batch, body.batch_id)):
        raise AppError(422, "VALIDATION_ERROR", "Choose the batch.", [{"field": "batch_id", "message": "Required."}])


@admin.post("", status_code=201, summary="Create a newsletter (draft)")
async def create(body: NewsletterIn, me: Principal = Depends(require("communications.create")), db: AsyncSession = Depends(get_db)):
    await _check(db, body)
    n = Newsletter(**body.model_dump(), status="draft", created_by=me.id, recipient_count=0)
    db.add(n)
    await db.flush()
    return {"data": await newsletter_out(db, n, detail=True)}


async def _draft(db: AsyncSession, newsletter_id: uuid.UUID) -> Newsletter:
    n = await db.get(Newsletter, newsletter_id)
    if not n:
        raise not_found("Newsletter")
    return n


@admin.get("/{newsletter_id}", summary="One newsletter")
async def get_one(newsletter_id: uuid.UUID, me: Principal = Depends(require("communications.view")), db: AsyncSession = Depends(get_db)):
    return {"data": await newsletter_out(db, await _draft(db, newsletter_id), detail=True)}


@admin.put("/{newsletter_id}", summary="Edit a draft or scheduled newsletter")
async def edit(
    newsletter_id: uuid.UUID,
    body: NewsletterIn,
    me: Principal = Depends(require("communications.create")),
    db: AsyncSession = Depends(get_db),
):
    n = await _draft(db, newsletter_id)
    if n.status not in ("draft", "scheduled"):
        raise conflict("ALREADY_SENT", "Sent newsletters cannot be edited.")
    await _check(db, body)
    for k, v in body.model_dump().items():
        setattr(n, k, v)
    await db.flush()
    return {"data": await newsletter_out(db, n, detail=True)}


@admin.post("/{newsletter_id}/preview", summary="Rendered HTML of the issue")
async def preview(newsletter_id: uuid.UUID, me: Principal = Depends(require("communications.view")), db: AsyncSession = Depends(get_db)):
    n = await _draft(db, newsletter_id)
    from ...services.templates import wrap_email

    general = await settings_store.get_group(db, "general")
    brand = await settings_store.branding(db)
    return {"data": {"subject": n.subject, "html": wrap_email(render_issue(n), general.app_name, brand.colors.primary)}}


@admin.post("/{newsletter_id}/test", summary="Send a test copy to yourself")
async def test(newsletter_id: uuid.UUID, me: Principal = Depends(require("communications.create")), db: AsyncSession = Depends(get_db)):
    await enforce(f"nl-test:{me.id}", 20, 3600)
    n = await _draft(db, newsletter_id)
    await messaging.queue_html_email(db, me.email, f"[Test] {n.subject}", render_issue(n), "newsletter.test")
    return {"data": {"sent_to": me.email}}


class SendIn(BaseModel):
    scheduled_at: datetime | None = None


@admin.post("/{newsletter_id}/send", summary="Send now or schedule")
async def send(
    newsletter_id: uuid.UUID,
    body: SendIn,
    request: Request,
    me: Principal = Depends(require("communications.publish")),
    db: AsyncSession = Depends(get_db),
):
    n = await _draft(db, newsletter_id)
    if n.status not in ("draft", "scheduled"):
        raise conflict("ALREADY_SENT", "This newsletter was already sent.")
    if body.scheduled_at and body.scheduled_at.tzinfo is None:
        raise AppError(422, "VALIDATION_ERROR", "Include a time zone.", [{"field": "scheduled_at", "message": "Time zone required."}])
    if not await recipients(db, n):
        raise conflict("NO_RECIPIENTS", "Nobody would receive this newsletter.")
    if body.scheduled_at and body.scheduled_at > datetime.now(UTC):
        n.status, n.scheduled_at = "scheduled", body.scheduled_at
    else:
        n.status, n.scheduled_at = "sending", None
        from ...worker import dispatch

        dispatch("app.tasks.send_newsletter", {"newsletter_id": str(n.id)}, after_commit_of=db)
    await record(
        db,
        actor_id=me.id,
        action="send" if n.status == "sending" else "schedule",
        entity="newsletter",
        entity_id=n.id,
        summary=f"Newsletter “{n.subject}”: {n.status}",
        ip=client_ip(request),
    )
    return {"data": await newsletter_out(db, n, detail=True)}


@admin.post("/{newsletter_id}/cancel", summary="Cancel a scheduled newsletter (back to draft)")
async def cancel(newsletter_id: uuid.UUID, me: Principal = Depends(require("communications.publish")), db: AsyncSession = Depends(get_db)):
    n = await _draft(db, newsletter_id)
    if n.status != "scheduled":
        raise conflict("NOT_SCHEDULED", "Only scheduled newsletters can be cancelled.")
    n.status, n.scheduled_at = "draft", None
    return {"data": await newsletter_out(db, n, detail=True)}


@admin.delete("/{newsletter_id}", summary="Delete a draft")
async def delete_draft(
    newsletter_id: uuid.UUID, me: Principal = Depends(require("communications.create")), db: AsyncSession = Depends(get_db)
):
    n = await _draft(db, newsletter_id)
    if n.status != "draft":
        raise conflict("NOT_DRAFT", "Only drafts can be deleted.")
    await db.delete(n)
    return {"data": {"ok": True}}


@admin.get("/subscribers/list", summary="Subscribers")
async def subscribers(
    status: Literal["pending", "subscribed", "unsubscribed"] | None = None,
    q: str | None = Query(None, max_length=100),
    p: PageParams = Depends(page_params),
    me: Principal = Depends(require("communications.view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(NewsletterSubscriber)
    if status:
        stmt = stmt.where(NewsletterSubscriber.status == status)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(NewsletterSubscriber.email).like(like), func.lower(NewsletterSubscriber.name).like(like)))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        (await db.execute(stmt.order_by(NewsletterSubscriber.created_at.desc()).offset((p.page - 1) * p.page_size).limit(p.page_size)))
        .scalars()
        .all()
    )
    return {
        "data": [
            {
                "id": str(s.id),
                "email": s.email,
                "name": s.name,
                "status": s.status,
                "source": s.source,
                "member": s.user_id is not None,
                "confirmed_at": s.confirmed_at,
                "unsubscribed_at": s.unsubscribed_at,
                "created_at": s.created_at,
            }
            for s in rows
        ],
        "meta": _meta(p, total),
    }


@admin.get("/subscribers/export", summary="Export subscribers (CSV)")
async def export_subscribers(request: Request, me: Principal = Depends(require("communications.view")), db: AsyncSession = Depends(get_db)):
    rows = (
        (
            await db.execute(
                select(NewsletterSubscriber).where(NewsletterSubscriber.status == "subscribed").order_by(NewsletterSubscriber.email)
            )
        )
        .scalars()
        .all()
    )
    await record(
        db,
        actor_id=me.id,
        action="export",
        entity="newsletter_subscriber",
        summary=f"Exported {len(rows)} subscribers",
        ip=client_ip(request),
    )
    await db.commit()
    return csv_response(
        "subscribers.csv",
        ["Email", "Name", "Source", "Confirmed"],
        ([s.email, s.name or "", s.source, s.confirmed_at.isoformat() if s.confirmed_at else ""] for s in rows),
    )


@admin.post("/subscribers/import", summary="Import subscribers who consented elsewhere (CSV: email, name)")
async def import_subscribers(
    request: Request,
    file: UploadFile = File(...),
    me: Principal = Depends(require("communications.configure")),
    db: AsyncSession = Depends(get_db),
):
    data = await file.read(2 * 1024 * 1024 + 1)
    if len(data) > 2 * 1024 * 1024:
        raise AppError(413, "FILE_TOO_LARGE", "The file is larger than 2 MB.")
    reader = csv.reader(io.StringIO(data.decode("utf-8-sig", errors="replace")))
    added, skipped, errors = 0, 0, []
    for line, row in enumerate(reader, start=1):
        if not row or (line == 1 and row[0].strip().lower() in ("email", "e-mail")):
            continue
        try:
            email = str(_email.validate_python(row[0].strip())).lower()
        except ValidationError:
            errors.append({"row": line, "message": f"Not an email address: {row[0][:60]}"})
            continue
        s = await _subscriber(db, email)
        if s:
            skipped += 1  # never resubscribe someone who unsubscribed
            continue
        db.add(
            NewsletterSubscriber(
                email=email,
                name=(row[1].strip()[:150] if len(row) > 1 and row[1].strip() else None),
                status="subscribed",
                token=secrets.token_urlsafe(32),
                source="import",
                confirmed_at=datetime.now(UTC),
            )
        )
        await db.flush()
        added += 1
    await record(
        db, actor_id=me.id, action="import", entity="newsletter_subscriber", summary=f"Imported {added} subscribers", ip=client_ip(request)
    )
    return {"data": {"added": added, "skipped": skipped, "errors": errors[:100]}}
