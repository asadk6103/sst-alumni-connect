"""Notification centre (the bell) and notification preferences."""

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.deps import Principal, current_user
from ...models import Notification, NotificationPreference
from ...services.notifications import CATEGORIES, OFF_BY_DEFAULT, SMS_CATEGORIES
from ..community.service import authors

router = APIRouter(prefix="/api/v1/notifications", tags=["Notifications"])


@router.get("", summary="Your notifications (newest first)")
async def list_notifications(
    unread: bool = False,
    category: str | None = Query(None, max_length=30),
    before: int | None = None,
    limit: int = Query(20, ge=1, le=50),
    me: Principal = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Notification).where(Notification.user_id == me.id)
    if unread:
        stmt = stmt.where(Notification.read_at.is_(None))
    if category:
        stmt = stmt.where(Notification.category == category)
    if before:
        stmt = stmt.where(Notification.id < before)
    rows = (await db.execute(stmt.order_by(Notification.id.desc()).limit(limit + 1))).scalars().all()
    more = len(rows) > limit
    rows = rows[:limit]
    people = await authors(db, {n.actor_id for n in rows})
    total_unread = (
        await db.execute(
            select(func.count()).select_from(Notification).where(Notification.user_id == me.id, Notification.read_at.is_(None))
        )
    ).scalar_one()
    return {
        "data": [
            {
                "id": n.id,
                "category": n.category,
                "kind": n.kind,
                "title": n.title,
                "body": n.body,
                "link": n.link,
                "actor": people.get(n.actor_id),
                "read": n.read_at is not None,
                "created_at": n.created_at,
            }
            for n in rows
        ],
        "meta": {"next_before": rows[-1].id if more and rows else None, "unread": total_unread},
    }


@router.get("/unread-count", summary="Number of unread notifications")
async def unread(me: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    n = (
        await db.execute(
            select(func.count()).select_from(Notification).where(Notification.user_id == me.id, Notification.read_at.is_(None))
        )
    ).scalar_one()
    return {"data": {"unread": n}}


@router.post("/{notification_id}/read", summary="Mark one notification as read")
async def mark_read(notification_id: int, me: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(
        update(Notification)
        .where(Notification.id == notification_id, Notification.user_id == me.id, Notification.read_at.is_(None))
        .values(read_at=func.now())
    )
    return {"data": {"ok": True}}


@router.post("/read-all", summary="Mark all as read")
async def read_all(me: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(update(Notification).where(Notification.user_id == me.id, Notification.read_at.is_(None)).values(read_at=func.now()))
    return {"data": {"ok": True}}


@router.delete("/{notification_id}", summary="Delete a notification")
async def remove(notification_id: int, me: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(Notification).where(Notification.id == notification_id, Notification.user_id == me.id))
    return {"data": {"ok": True}}


@router.get("/preferences", summary="Your notification preferences")
async def preferences(me: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    stored = {
        p.category: p for p in (await db.execute(select(NotificationPreference).where(NotificationPreference.user_id == me.id))).scalars()
    }
    return {
        "data": [
            {
                "category": k,
                "label": label,
                "description": desc,
                "in_app": stored[k].in_app if k in stored else True,
                "email": stored[k].email if k in stored else k not in OFF_BY_DEFAULT,
                "push": stored[k].push if k in stored else True,
                "sms": stored[k].sms if k in stored else False,
                "sms_available": k in SMS_CATEGORIES,
            }
            for k, (label, desc) in CATEGORIES.items()
        ]
    }


class PrefIn(BaseModel):
    category: str
    in_app: bool
    email: bool
    push: bool | None = None  # mobile app; omitted by older clients = keep
    sms: bool | None = None


@router.put("/preferences", summary="Update your notification preferences")
async def set_preferences(body: list[PrefIn], me: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    for p in body:
        if p.category not in CATEGORIES:
            continue
        row = await db.get(NotificationPreference, (me.id, p.category))
        if row:
            row.in_app, row.email = p.in_app, p.email
            if p.push is not None:
                row.push = p.push
            if p.sms is not None:
                row.sms = p.sms and p.category in SMS_CATEGORIES
        else:
            db.add(
                NotificationPreference(
                    user_id=me.id,
                    category=p.category,
                    in_app=p.in_app,
                    email=p.email,
                    push=True if p.push is None else p.push,
                    sms=bool(p.sms) and p.category in SMS_CATEGORIES,
                )
            )
    await db.flush()
    return await preferences(me, db)


# ── mobile devices (push notifications) ─────────────────────────────────────
devices = APIRouter(prefix="/api/v1/devices", tags=["Mobile devices"])


class DeviceIn(BaseModel):
    token: str = Field(..., min_length=10, max_length=200, pattern=r"^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_\-]+\]$")
    platform: Literal["android", "ios"]
    device_name: str | None = Field(None, max_length=120)
    app_version: str | None = Field(None, max_length=30)


@devices.post("", summary="Register this device for push notifications (idempotent)")
async def register_device(body: DeviceIn, me: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    from ...models import PushDevice

    row = (await db.execute(select(PushDevice).where(PushDevice.token == body.token))).scalar_one_or_none()
    if row:  # a token moves with the device: the latest signed-in member owns it
        row.user_id, row.platform, row.device_name, row.app_version = me.id, body.platform, body.device_name, body.app_version
        row.last_seen_at = datetime.now(UTC)
    else:
        db.add(
            PushDevice(user_id=me.id, token=body.token, platform=body.platform, device_name=body.device_name, app_version=body.app_version)
        )
    await db.commit()
    return {"data": {"ok": True}}


@devices.get("", summary="Your devices that receive push notifications")
async def list_devices(me: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    from ...models import PushDevice

    rows = (await db.execute(select(PushDevice).where(PushDevice.user_id == me.id).order_by(PushDevice.last_seen_at.desc()))).scalars()
    return {
        "data": [
            {
                "id": str(d.id),
                "platform": d.platform,
                "device_name": d.device_name,
                "app_version": d.app_version,
                "last_seen_at": d.last_seen_at,
                "created_at": d.created_at,
            }
            for d in rows
        ]
    }


class TokenOut(BaseModel):
    token: str = Field(..., max_length=200)


@devices.post("/unregister", summary="Stop push notifications on this device (on sign-out)")
async def unregister_device(body: TokenOut, me: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    from sqlalchemy import delete

    from ...models import PushDevice

    await db.execute(delete(PushDevice).where(PushDevice.token == body.token, PushDevice.user_id == me.id))
    await db.commit()
    return {"data": {"ok": True}}
