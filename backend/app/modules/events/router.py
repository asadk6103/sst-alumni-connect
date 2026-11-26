"""Events for members and event management for staff (registration, waitlist, QR check-in, gallery, feedback)."""

import uuid
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.audit import record
from ...core.db import get_db
from ...core.deps import Principal, client_ip, require, require_module
from ...core.errors import AppError, conflict, not_found
from ...core.pagination import PageParams, csv_response, page_params
from ...core.redis import enforce
from ...models import AlumniProfile, Batch, Event, EventAttendance, EventFeedback, EventInterest, EventMedia, EventRegistration, User
from ...services import custom_fields, live, media, messaging, notifications
from ..community.service import authors
from . import service as svc

router = APIRouter(prefix="/api/v1/events", tags=["Events"], dependencies=[Depends(require_module("events"))])
admin = APIRouter(prefix="/api/v1/admin/events", tags=["Admin: events"])
member = require("portal.access")


def _meta(p: PageParams, total: int) -> dict:
    return {"page": p.page, "page_size": p.page_size, "total": total, "pages": max(1, -(-total // p.page_size))}


# ── members ─────────────────────────────────────────────────────────────────
@router.get("", summary="Events (upcoming, past or yours)")
async def list_events(
    scope: Literal["upcoming", "past", "mine", "interested"] = "upcoming",
    kind: str | None = Query(None, max_length=200),
    q: str | None = Query(None, max_length=100),
    group_id: uuid.UUID | None = None,
    p: PageParams = Depends(page_params),
    me: Principal = Depends(member),
    db: AsyncSession = Depends(get_db),
):
    prof = await db.get(AlumniProfile, me.id)
    stmt = select(Event).where(
        Event.status.in_(["published", "cancelled"]),
        or_(Event.batch_id.is_(None), Event.batch_id == (prof.batch_id if prof and prof.batch_id else uuid.UUID(int=0))),
        svc.group_scope(me),
    )
    if group_id:
        stmt = stmt.where(Event.group_id == group_id)
    now = svc.now()
    if scope == "upcoming":
        stmt = stmt.where(Event.ends_at >= now).order_by(Event.starts_at)
    elif scope == "past":
        stmt = stmt.where(Event.ends_at < now).order_by(Event.starts_at.desc())
    elif scope == "interested":
        stmt = stmt.join(EventInterest, and_(EventInterest.event_id == Event.id, EventInterest.user_id == me.id)).order_by(Event.starts_at)
    else:
        stmt = stmt.join(
            EventRegistration,
            and_(EventRegistration.event_id == Event.id, EventRegistration.user_id == me.id, EventRegistration.status != "cancelled"),
        ).order_by(Event.starts_at.desc())
    if kind:
        stmt = stmt.where(Event.kind.in_([k for k in kind.split(",") if k][:20]))
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(Event.title).like(like), func.lower(Event.venue).like(like), func.lower(Event.summary).like(like)))
    total = (await db.execute(select(func.count()).select_from(stmt.order_by(None).subquery()))).scalar_one()
    rows = (await db.execute(stmt.offset((p.page - 1) * p.page_size).limit(p.page_size))).scalars().all()
    regs = {
        r.event_id: r
        for r in (
            await db.execute(
                select(EventRegistration).where(
                    EventRegistration.user_id == me.id, EventRegistration.event_id.in_([e.id for e in rows] or [uuid.UUID(int=0)])
                )
            )
        ).scalars()
    }
    return {"data": [await svc.event_out(db, me, e, reg=regs.get(e.id)) for e in rows], "meta": _meta(p, total)}


@router.get("/{event_id}", summary="Event details (meeting link for registered attendees)")
async def get_event(event_id: uuid.UUID, me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    ev = await svc.visible(db, me, await db.get(Event, event_id))
    return {"data": await svc.event_out(db, me, ev, detail=True)}


class RegisterIn(BaseModel):
    guests: int = Field(0, ge=0, le=10)
    note: str | None = Field(None, max_length=300)


@router.post("/{event_id}/register", summary="Register (joins the waitlist when the event is full)")
async def register(
    event_id: uuid.UUID, body: RegisterIn, me: Principal = Depends(require("portal.events.register")), db: AsyncSession = Depends(get_db)
):
    await enforce(f"event-reg:{me.id}", 30, 3600)
    ev = await svc.visible(db, me, await db.get(Event, event_id, with_for_update=True))  # serialises seat counting
    if ev.status != "published":
        raise conflict("NOT_OPEN", "Registration is not open for this event.")
    if (ev.registration_deadline or ev.starts_at) <= svc.now():
        raise conflict("REGISTRATION_CLOSED", "Registration for this event has closed.")
    if body.guests > ev.max_guests:
        raise AppError(
            422, "TOO_MANY_GUESTS", f"You can bring up to {ev.max_guests} guest(s).", [{"field": "guests", "message": "Too many."}]
        )
    reg = (
        await db.execute(select(EventRegistration).where(EventRegistration.event_id == ev.id, EventRegistration.user_id == me.id))
    ).scalar_one_or_none()
    if reg and reg.status in ("registered", "waitlisted", "attended"):
        raise conflict("ALREADY_REGISTERED", "You are already registered." if reg.status != "waitlisted" else "You are on the waitlist.")
    seats = 1 + body.guests
    left = svc.seats_left(ev)
    status = "registered" if left is None or left >= seats else "waitlisted"
    if reg:
        reg.status, reg.guests, reg.note, reg.created_at = status, body.guests, body.note, func.now()
    else:
        reg = EventRegistration(
            event_id=ev.id, user_id=me.id, status=status, guests=body.guests, note=body.note, checkin_code=svc.new_code()
        )
        db.add(reg)
    if status == "registered":
        ev.registered_count += seats
    await db.flush()
    await db.refresh(reg)
    user = await db.get(User, me.id)
    general = await settings_store.get_group(db, "general")
    await messaging.queue_email(
        db,
        user.email,
        "events.registered" if status == "registered" else "events.waitlisted",
        {
            "name": user.full_name,
            "event": ev.title,
            "when": ev.starts_at.strftime("%d %b %Y %H:%M UTC"),
            "where": "Online" if ev.is_online else (ev.venue or ""),
            "link": f"{general.app_url}/portal/events/{ev.id}",
        },
        user.language or "en",
    )
    live.emit_to_room(db, f"event:{ev.id}", "event:seats", {"event_id": str(ev.id), "seats_left": svc.seats_left(ev)})
    return {"data": await svc.event_out(db, me, ev, detail=True, reg=reg)}


@router.post("/{event_id}/cancel", summary="Cancel your registration")
async def cancel(event_id: uuid.UUID, me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    ev = await svc.visible(db, me, await db.get(Event, event_id, with_for_update=True))
    reg = (
        await db.execute(select(EventRegistration).where(EventRegistration.event_id == ev.id, EventRegistration.user_id == me.id))
    ).scalar_one_or_none()
    if not reg or reg.status not in ("registered", "waitlisted"):
        raise not_found("Registration")
    if ev.starts_at <= svc.now():
        raise conflict("STARTED", "The event has already started.")
    if reg.status == "registered":
        ev.registered_count = max(0, ev.registered_count - 1 - reg.guests)
    reg.status = "cancelled"
    await db.flush()
    await svc.promote_waitlist(db, ev)
    live.emit_to_room(db, f"event:{ev.id}", "event:seats", {"event_id": str(ev.id), "seats_left": svc.seats_left(ev)})
    return {"data": await svc.event_out(db, me, ev, detail=True, reg=reg)}


@router.get("/{event_id}/calendar.ics", summary="Add to calendar (iCalendar file)")
async def ics(event_id: uuid.UUID, me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    ev = await svc.visible(db, me, await db.get(Event, event_id))
    general = await settings_store.get_group(db, "general")

    def esc(s: str | None) -> str:
        return (s or "").replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n")

    fmt = "%Y%m%dT%H%M%SZ"
    body = "\r\n".join(
        [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            f"PRODID:-//{esc(general.app_name)}//Events//EN",
            "BEGIN:VEVENT",
            f"UID:{ev.id}@sst-alumni",
            f"DTSTAMP:{svc.now().strftime(fmt)}",
            f"DTSTART:{ev.starts_at.astimezone(svc.UTC).strftime(fmt)}",
            f"DTEND:{ev.ends_at.astimezone(svc.UTC).strftime(fmt)}",
            f"SUMMARY:{esc(ev.title)}",
            f"LOCATION:{esc('Online' if ev.is_online else ', '.join(x for x in (ev.venue, ev.address) if x))}",
            f"DESCRIPTION:{esc(ev.summary)}",
            f"URL:{general.app_url}/portal/events/{ev.id}",
            "END:VEVENT",
            "END:VCALENDAR",
            "",
        ]
    )
    return Response(
        body, media_type="text/calendar; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="event-{ev.id}.ics"'}
    )


class FeedbackIn(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    comment: str | None = Field(None, max_length=2000)


@router.put("/{event_id}/feedback", summary="Rate an event you attended")
async def feedback(event_id: uuid.UUID, body: FeedbackIn, me: Principal = Depends(member), db: AsyncSession = Depends(get_db)):
    ev = await svc.visible(db, me, await db.get(Event, event_id))
    if ev.starts_at > svc.now():
        raise conflict("NOT_STARTED", "You can leave feedback once the event has started.")
    reg = (
        await db.execute(
            select(EventRegistration).where(
                EventRegistration.event_id == ev.id,
                EventRegistration.user_id == me.id,
                EventRegistration.status.in_(["registered", "attended"]),
            )
        )
    ).scalar_one_or_none()
    if not reg:
        raise conflict("NOT_ATTENDEE", "Only attendees can leave feedback.")
    fb = await db.get(EventFeedback, (ev.id, me.id))
    if fb:
        fb.rating, fb.comment = body.rating, body.comment
    else:
        db.add(EventFeedback(event_id=ev.id, user_id=me.id, rating=body.rating, comment=body.comment))
    await db.flush()
    return {"data": (await svc.event_out(db, me, ev, detail=True, reg=reg))["feedback"]}


# ── staff ───────────────────────────────────────────────────────────────────
EVENT_KINDS = Literal[
    "reunion", "batch_reunion", "networking", "seminar", "webinar", "workshop", "school", "sports", "career", "social_impact", "other"
]


class AgendaItem(BaseModel):
    time: str = Field(..., max_length=20)
    title: str = Field(..., min_length=1, max_length=150)


class EventIn(BaseModel):
    title: str = Field(..., min_length=3, max_length=200)
    kind: EVENT_KINDS
    summary: str = Field("", max_length=300)
    description: str = Field("", max_length=20000)
    banner_id: uuid.UUID | None = None
    starts_at: datetime
    ends_at: datetime
    venue: str | None = Field(None, max_length=200)
    address: str | None = Field(None, max_length=300)
    is_online: bool = False
    online_url: str | None = Field(None, max_length=500)
    capacity: int | None = Field(None, ge=1, le=100000)
    max_guests: int = Field(0, ge=0, le=10)
    registration_deadline: datetime | None = None
    batch_id: uuid.UUID | None = None
    custom_fields: dict = Field(default_factory=dict)
    is_featured: bool = False
    highlights: list[str] = Field(default_factory=list, max_length=10)
    agenda: list[AgendaItem] = Field(default_factory=list, max_length=30)

    @field_validator("highlights")
    @classmethod
    def _hl(cls, v):
        return [x.strip()[:60] for x in v if x and x.strip()]

    @field_validator("online_url")
    @classmethod
    def _url(cls, v):
        if v and not v.strip().lower().startswith(("https://", "http://")):
            raise ValueError("Enter a full meeting link starting with https://")
        return v.strip() if v else None

    @model_validator(mode="after")
    def _dates(self):
        for f in ("starts_at", "ends_at", "registration_deadline"):
            v = getattr(self, f)
            if v is not None and v.tzinfo is None:
                raise ValueError(f"{f} needs a time zone")
        if self.ends_at <= self.starts_at:
            raise ValueError("The event must end after it starts.")
        if self.registration_deadline and self.registration_deadline > self.starts_at:
            raise ValueError("Registration must close before the event starts.")
        if not self.is_online and not self.venue:
            raise ValueError("Enter a venue, or mark the event as online.")
        return self


async def _admin_event(db: AsyncSession, event_id: uuid.UUID) -> Event:
    ev = await db.get(Event, event_id, with_for_update=True)
    if not ev:
        raise not_found("Event")
    return ev


@admin.get("", summary="All events")
async def admin_list(
    status: Literal["draft", "pending", "published", "cancelled"] | None = None,
    scope: Literal["upcoming", "past"] | None = None,
    q: str | None = Query(None, max_length=100),
    p: PageParams = Depends(page_params),
    me: Principal = Depends(require("events.view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Event)
    if status:
        stmt = stmt.where(Event.status == status)
    if scope == "upcoming":
        stmt = stmt.where(Event.ends_at >= svc.now())
    elif scope == "past":
        stmt = stmt.where(Event.ends_at < svc.now())
    if q:
        stmt = stmt.where(func.lower(Event.title).like(f"%{q.strip().lower()}%"))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(stmt.order_by(Event.starts_at.desc()).offset((p.page - 1) * p.page_size).limit(p.page_size))).scalars().all()
    data = []
    for e in rows:
        out = await svc.event_out(db, me, e, reg=None)
        counts = dict(
            (
                await db.execute(
                    select(EventRegistration.status, func.count())
                    .where(EventRegistration.event_id == e.id)
                    .group_by(EventRegistration.status)
                )
            ).all()
        )
        out["counts"] = {k: counts.get(k, 0) for k in ("registered", "waitlisted", "attended", "cancelled")}
        data.append(out)
    return {"data": data, "meta": _meta(p, total)}


@admin.get("/{event_id}", summary="One event (for editing)")
async def admin_get(event_id: uuid.UUID, me: Principal = Depends(require("events.view")), db: AsyncSession = Depends(get_db)):
    ev = await db.get(Event, event_id)
    if not ev:
        raise not_found("Event")
    out = await svc.event_out(db, me, ev, detail=True, reg=None)
    out["banner_id"] = str(ev.banner_id) if ev.banner_id else None
    return {"data": out}


async def _check_refs(db: AsyncSession, body: EventIn) -> None:
    if body.batch_id and not await db.get(Batch, body.batch_id):
        raise AppError(422, "VALIDATION_ERROR", "This batch does not exist.", [{"field": "batch_id", "message": "Unknown batch."}])


@admin.post("", status_code=201, summary="Create an event (draft)")
async def create(body: EventIn, request: Request, me: Principal = Depends(require("events.create")), db: AsyncSession = Depends(get_db)):
    await _check_refs(db, body)
    ev = Event(
        **body.model_dump(exclude={"custom_fields"}),
        status="draft",
        created_by=me.id,
        registered_count=0,
        custom_fields=await custom_fields.clean(db, "event", body.custom_fields, actor=me.id),
    )
    db.add(ev)
    await db.flush()
    await record(
        db, actor_id=me.id, action="create", entity="event", entity_id=ev.id, summary=f"Created event {ev.title}", ip=client_ip(request)
    )
    return {"data": await svc.event_out(db, me, ev, detail=True, reg=None)}


@admin.put("/{event_id}", summary="Update an event")
async def update(
    event_id: uuid.UUID,
    body: EventIn,
    request: Request,
    me: Principal = Depends(require("events.edit")),
    db: AsyncSession = Depends(get_db),
):
    ev = await _admin_event(db, event_id)
    await _check_refs(db, body)
    if body.capacity is not None and body.capacity < ev.registered_count:
        raise AppError(
            422,
            "VALIDATION_ERROR",
            f"{ev.registered_count} seats are already taken.",
            [{"field": "capacity", "message": f"At least {ev.registered_count}."}],
        )
    moved = body.starts_at != ev.starts_at
    for k, v in body.model_dump(exclude={"custom_fields"}).items():
        setattr(ev, k, v)
    ev.custom_fields = await custom_fields.clean(db, "event", body.custom_fields, ev.custom_fields, actor=me.id)
    if moved:
        ev.reminder_sent_at = None
    await db.flush()
    await svc.promote_waitlist(db, ev)  # capacity may have grown
    live.emit_to_room(db, f"event:{ev.id}", "event:updated", {"event_id": str(ev.id)})
    await record(
        db, actor_id=me.id, action="update", entity="event", entity_id=ev.id, summary=f"Updated event {ev.title}", ip=client_ip(request)
    )
    return {"data": await svc.event_out(db, me, ev, detail=True, reg=None)}


@admin.post("/{event_id}/publish", summary="Publish an event")
async def publish(
    event_id: uuid.UUID, request: Request, me: Principal = Depends(require("events.publish")), db: AsyncSession = Depends(get_db)
):
    ev = await _admin_event(db, event_id)
    if ev.status == "cancelled":
        raise conflict("CANCELLED", "Cancelled events cannot be published again. Create a new event.")
    ev.status = "published"
    await record(
        db, actor_id=me.id, action="publish", entity="event", entity_id=ev.id, summary=f"Published event {ev.title}", ip=client_ip(request)
    )
    return {"data": await svc.event_out(db, me, ev, reg=None)}


class CancelIn(BaseModel):
    reason: str = Field(..., min_length=3, max_length=300)


@admin.post("/{event_id}/cancel", summary="Cancel an event (registrants are emailed)")
async def cancel_event(
    event_id: uuid.UUID,
    body: CancelIn,
    request: Request,
    me: Principal = Depends(require("events.edit")),
    db: AsyncSession = Depends(get_db),
):
    ev = await _admin_event(db, event_id)
    ev.status, ev.cancel_reason = "cancelled", body.reason
    general = await settings_store.get_group(db, "general")
    regs = (
        await db.execute(
            select(EventRegistration, User)
            .join(User, User.id == EventRegistration.user_id)
            .where(EventRegistration.event_id == ev.id, EventRegistration.status.in_(["registered", "waitlisted"]))
        )
    ).all()
    for _reg, u in regs:
        await notifications.notify(
            db,
            u.id,
            "events",
            "cancelled",
            f"Cancelled: {ev.title}",
            body=body.reason,
            link="/portal/events",
            email=("events.cancelled", {"event": ev.title, "reason": body.reason, "link": f"{general.app_url}/portal/events"}),
        )
    await record(
        db,
        actor_id=me.id,
        action="cancel",
        entity="event",
        entity_id=ev.id,
        summary=f"Cancelled event {ev.title}",
        data={"reason": body.reason, "notified": len(regs)},
        ip=client_ip(request),
    )
    return {"data": await svc.event_out(db, me, ev, reg=None)}


@admin.delete("/{event_id}", summary="Delete a draft event")
async def delete_event(
    event_id: uuid.UUID, request: Request, me: Principal = Depends(require("events.delete")), db: AsyncSession = Depends(get_db)
):
    ev = await _admin_event(db, event_id)
    n = (await db.execute(select(func.count()).select_from(EventRegistration).where(EventRegistration.event_id == ev.id))).scalar_one()
    if ev.status != "draft" or n:
        raise conflict("HAS_HISTORY", "Only drafts without registrations can be deleted. Cancel the event instead.")
    await db.delete(ev)
    await record(
        db,
        actor_id=me.id,
        action="delete",
        entity="event",
        entity_id=event_id,
        summary=f"Deleted draft event {ev.title}",
        ip=client_ip(request),
    )
    return {"data": {"ok": True}}


def _regs_stmt(event_id: uuid.UUID, status: str | None, q: str | None):
    stmt = (
        select(EventRegistration, User, EventAttendance.checked_in_at)
        .join(User, User.id == EventRegistration.user_id)
        .outerjoin(
            EventAttendance,
            and_(EventAttendance.event_id == EventRegistration.event_id, EventAttendance.user_id == EventRegistration.user_id),
        )
        .where(EventRegistration.event_id == event_id)
    )
    if status:
        stmt = stmt.where(EventRegistration.status == status)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(User.full_name).like(like), func.lower(User.email).like(like)))
    return stmt


@admin.get("/{event_id}/registrations", summary="Registrations and attendance")
async def registrations(
    event_id: uuid.UUID,
    status: Literal["registered", "waitlisted", "cancelled", "attended"] | None = None,
    q: str | None = Query(None, max_length=100),
    p: PageParams = Depends(page_params),
    me: Principal = Depends(require("events.view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = _regs_stmt(event_id, status, q)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(stmt.order_by(EventRegistration.created_at).offset((p.page - 1) * p.page_size).limit(p.page_size))).all()
    people = await authors(db, {u.id for _, u, _ in rows})
    return {
        "data": [
            {
                "id": str(r.id),
                "user": people.get(u.id),
                "email": u.email,
                "phone": u.phone,
                "status": r.status,
                "guests": r.guests,
                "note": r.note,
                "registered_at": r.created_at,
                "checked_in_at": at,
            }
            for r, u, at in rows
        ],
        "meta": _meta(p, total),
    }


@admin.get("/{event_id}/registrations/export", summary="Export registrations and attendance (CSV)")
async def export_regs(
    event_id: uuid.UUID, request: Request, me: Principal = Depends(require("events.export")), db: AsyncSession = Depends(get_db)
):
    ev = await db.get(Event, event_id)
    if not ev:
        raise not_found("Event")
    rows = (await db.execute(_regs_stmt(event_id, None, None).order_by(EventRegistration.created_at))).all()
    await record(
        db,
        actor_id=me.id,
        action="export",
        entity="event",
        entity_id=event_id,
        summary=f"Exported registrations of {ev.title}",
        ip=client_ip(request),
    )
    await db.commit()
    return csv_response(
        f"event-{event_id}-registrations.csv",
        ["Name", "Email", "Mobile", "Status", "Guests", "Note", "Registered", "Checked in"],
        (
            [u.full_name, u.email, u.phone or "", r.status, r.guests, r.note or "", r.created_at.isoformat(), at.isoformat() if at else ""]
            for r, u, at in rows
        ),
    )


class CheckinIn(BaseModel):
    code: str | None = Field(None, max_length=60)
    user_id: uuid.UUID | None = None


@admin.post("/{event_id}/checkin", summary="Check in an attendee (QR code or manual)")
async def checkin(
    event_id: uuid.UUID, body: CheckinIn, me: Principal = Depends(require("events.edit")), db: AsyncSession = Depends(get_db)
):
    ev = await db.get(Event, event_id)
    if not ev:
        raise not_found("Event")
    if body.code:
        code = body.code.strip().split("/")[-1].split(":")[-1]
        reg = (await db.execute(select(EventRegistration).where(EventRegistration.checkin_code == code))).scalar_one_or_none()
        if not reg or reg.event_id != ev.id:
            raise AppError(404, "UNKNOWN_TICKET", "This ticket does not belong to this event.")
    elif body.user_id:
        reg = (
            await db.execute(
                select(EventRegistration).where(EventRegistration.event_id == ev.id, EventRegistration.user_id == body.user_id)
            )
        ).scalar_one_or_none()
        if not reg:
            raise not_found("Registration")
    else:
        raise AppError(422, "VALIDATION_ERROR", "Scan a ticket or choose an attendee.")
    if reg.status not in ("registered", "attended"):
        raise conflict("NOT_REGISTERED", "This person is not registered (waitlisted or cancelled).")
    u = await db.get(User, reg.user_id)
    already = await db.execute(
        select(EventAttendance.checked_in_at).where(EventAttendance.event_id == ev.id, EventAttendance.user_id == reg.user_id)
    )
    first = already.scalar_one_or_none()
    if first is None:
        db.add(EventAttendance(event_id=ev.id, user_id=reg.user_id, method="qr" if body.code else "manual", checked_in_by=me.id))
        reg.status = "attended"
        live.emit_to_room(db, f"event:{ev.id}", "event:checkin", {"event_id": str(ev.id), "user_id": str(u.id)})
    await db.flush()
    people = await authors(db, {u.id})
    return {
        "data": {
            "user": people.get(u.id),
            "guests": reg.guests,
            "already_checked_in": first is not None,
            "checked_in_at": first or svc.now(),
        }
    }


@admin.delete("/{event_id}/checkin/{user_id}", summary="Undo a check-in")
async def undo_checkin(
    event_id: uuid.UUID, user_id: uuid.UUID, me: Principal = Depends(require("events.edit")), db: AsyncSession = Depends(get_db)
):
    await db.execute(delete(EventAttendance).where(EventAttendance.event_id == event_id, EventAttendance.user_id == user_id))
    reg = (
        await db.execute(select(EventRegistration).where(EventRegistration.event_id == event_id, EventRegistration.user_id == user_id))
    ).scalar_one_or_none()
    if reg and reg.status == "attended":
        reg.status = "registered"
    return {"data": {"ok": True}}


@admin.post("/{event_id}/media", status_code=201, summary="Add a photo to the event gallery")
async def add_photo(
    event_id: uuid.UUID, file: UploadFile = File(...), me: Principal = Depends(require("events.edit")), db: AsyncSession = Depends(get_db)
):
    ev = await db.get(Event, event_id)
    if not ev:
        raise not_found("Event")
    m = await media.upload(
        db, data=await file.read(), filename=file.filename or "photo", folder="events", alt=ev.title, images_only=True, actor=me.id
    )
    pos = (await db.execute(select(func.coalesce(func.max(EventMedia.position), -1)).where(EventMedia.event_id == ev.id))).scalar_one() + 1
    db.add(EventMedia(event_id=ev.id, media_id=m.id, position=pos))
    await db.flush()
    return {"data": await svc.image(db, m.id)}


@admin.delete("/{event_id}/media/{media_id}", summary="Remove a gallery photo")
async def remove_photo(
    event_id: uuid.UUID, media_id: uuid.UUID, me: Principal = Depends(require("events.edit")), db: AsyncSession = Depends(get_db)
):
    await db.execute(delete(EventMedia).where(EventMedia.event_id == event_id, EventMedia.media_id == media_id))
    return {"data": {"ok": True}}


@admin.get("/{event_id}/feedback", summary="Feedback from attendees")
async def list_feedback(event_id: uuid.UUID, me: Principal = Depends(require("events.view")), db: AsyncSession = Depends(get_db)):
    rows = (
        (await db.execute(select(EventFeedback).where(EventFeedback.event_id == event_id).order_by(EventFeedback.created_at.desc())))
        .scalars()
        .all()
    )
    people = await authors(db, {r.user_id for r in rows})
    return {"data": [{"user": people.get(r.user_id), "rating": r.rating, "comment": r.comment, "created_at": r.created_at} for r in rows]}


async def send_reminders(db: AsyncSession) -> int:
    """Celery beat: remind registered attendees about 24 hours before the start (once per event)."""
    now = svc.now()
    events = (
        (
            await db.execute(
                select(Event)
                .where(
                    Event.status == "published",
                    Event.reminder_sent_at.is_(None),
                    Event.starts_at > now,
                    Event.starts_at <= now + timedelta(hours=24),
                )
                .with_for_update(skip_locked=True)
            )
        )
        .scalars()
        .all()
    )
    general = await settings_store.get_group(db, "general")
    sent = 0
    for ev in events:
        regs = (
            (
                await db.execute(
                    select(User)
                    .join(EventRegistration, EventRegistration.user_id == User.id)
                    .where(EventRegistration.event_id == ev.id, EventRegistration.status == "registered")
                )
            )
            .scalars()
            .all()
        )
        for u in regs:
            await notifications.notify(
                db,
                u.id,
                "events",
                "reminder",
                f"Tomorrow: {ev.title}",
                link=f"/portal/events/{ev.id}",
                email=(
                    "events.reminder",
                    {
                        "event": ev.title,
                        "when": ev.starts_at.strftime("%d %b %Y %H:%M UTC"),
                        "where": "Online — the link is on the event page" if ev.is_online else (ev.venue or ""),
                        "link": f"{general.app_url}/portal/events/{ev.id}",
                    },
                ),
            )
            sent += 1
        ev.reminder_sent_at = now
    return sent
