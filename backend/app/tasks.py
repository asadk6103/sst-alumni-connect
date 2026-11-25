"""Background tasks. Each task runs its async body on a fresh event loop with a non-pooled engine."""

import asyncio
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from .core.config import infra
from .models import LoginAttempt, NotificationLog, Session, UserVerification
from .worker import celery_app, dispatch


def _run(coro_fn, *args):
    async def main():
        engine = create_async_engine(infra().database_url, poolclass=NullPool)
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as db:
                result = await coro_fn(db, *args)
                await db.commit()
                return result
        finally:
            await engine.dispose()

    return asyncio.run(main())


async def _deliver(db, channel: str, payload: dict) -> str:
    from .services.messaging import deliver

    entry = await db.get(NotificationLog, payload["log_id"])
    if entry and entry.status in ("sent", "skipped"):
        return "already-done"  # idempotent consumer
    try:
        await deliver(db, channel, payload)
    except Exception:
        await db.commit()  # keep the failure in the delivery log, then let Celery retry
        raise
    return "ok"


@celery_app.task(name="app.tasks.send_email", bind=True, max_retries=5, default_retry_delay=30)
def send_email(self, payload: dict):
    try:
        return _run(_deliver, "email", payload)
    except Exception as e:
        raise self.retry(exc=e, countdown=min(30 * 2**self.request.retries, 1800)) from e


@celery_app.task(name="app.tasks.send_sms", bind=True, max_retries=5, default_retry_delay=30)
def send_sms(self, payload: dict):
    try:
        return _run(_deliver, "sms", payload)
    except Exception as e:
        raise self.retry(exc=e, countdown=min(30 * 2**self.request.retries, 1800)) from e


async def _sweep(db) -> int:
    """Re-dispatch deliveries still queued (never picked up, e.g. the broker was down)."""
    cutoff = datetime.now(UTC) - timedelta(minutes=2)
    oldest = datetime.now(UTC) - timedelta(days=1)
    rows = (
        (
            await db.execute(
                select(NotificationLog)
                .where(
                    NotificationLog.status == "queued",
                    NotificationLog.created_at < cutoff,
                    NotificationLog.created_at > oldest,
                    NotificationLog.attempts == 0,
                    NotificationLog.payload.is_not(None),
                )
                .limit(200)
            )
        )
        .scalars()
        .all()
    )
    for r in rows:
        dispatch("app.tasks.send_email" if r.channel == "email" else "app.tasks.send_sms", {"log_id": r.id, **r.payload})
    stale = (
        await db.execute(
            update(NotificationLog)
            .where(NotificationLog.status == "queued", NotificationLog.created_at <= oldest)
            .values(status="failed", error="Expired in queue.")
        )
    ).rowcount
    return len(rows) + (stale or 0)


@celery_app.task(name="app.tasks.sweep_outbox")
def sweep_outbox():
    return _run(_sweep)


async def _cleanup(db) -> dict:
    now = datetime.now(UTC)
    s = (
        await db.execute(
            delete(Session).where(or_(Session.expires_at < now - timedelta(days=7), Session.revoked_at < now - timedelta(days=7)))
        )
    ).rowcount
    v = (await db.execute(delete(UserVerification).where(UserVerification.expires_at < now - timedelta(days=7)))).rowcount
    a = (await db.execute(delete(LoginAttempt).where(LoginAttempt.created_at < now - timedelta(days=90)))).rowcount
    return {"sessions": s, "verifications": v, "login_attempts": a}


@celery_app.task(name="app.tasks.cleanup")
def cleanup():
    return _run(_cleanup)


async def _event_reminders(db) -> int:
    from .modules.events.router import send_reminders

    return await send_reminders(db)


@celery_app.task(name="app.tasks.event_reminders")
def event_reminders():
    return _run(_event_reminders)


async def _send_newsletter(db, newsletter_id: str) -> int:
    import uuid

    from .modules.institutional.newsletters import send_issue

    return await send_issue(db, uuid.UUID(newsletter_id))


@celery_app.task(name="app.tasks.send_newsletter")
def send_newsletter(payload: dict):
    return _run(_send_newsletter, payload["newsletter_id"])


async def _scheduled_newsletters(db) -> int:
    from .modules.institutional.newsletters import due_issues, send_issue

    sent = 0
    for nid in await due_issues(db):
        sent += await send_issue(db, nid)
    return sent


@celery_app.task(name="app.tasks.scheduled_newsletters")
def scheduled_newsletters():
    return _run(_scheduled_newsletters)


__all__ = ["dispatch"]


async def _push(db, payload: dict) -> dict:
    """Send to the Expo Push Service in batches of 100; drop tokens that are no longer registered."""
    import os

    import httpx

    from .models import PushDevice
    from .services.push import EXPO_URL, messages

    msgs = messages(payload)
    headers = {"accept": "application/json", "content-type": "application/json"}
    if os.environ.get("EXPO_ACCESS_TOKEN"):
        headers["authorization"] = f"Bearer {os.environ['EXPO_ACCESS_TOKEN']}"
    dead, sent = [], 0
    async with httpx.AsyncClient(timeout=15) as client:
        for i in range(0, len(msgs), 100):
            chunk = msgs[i : i + 100]
            r = await client.post(EXPO_URL, json=chunk, headers=headers)
            r.raise_for_status()
            for m, ticket in zip(chunk, r.json().get("data", []), strict=False):
                if ticket.get("status") == "ok":
                    sent += 1
                elif (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
                    dead.append(m["to"])
    if dead:
        await db.execute(delete(PushDevice).where(PushDevice.token.in_(dead)))
    return {"sent": sent, "removed": len(dead)}


@celery_app.task(name="app.tasks.send_push", bind=True, max_retries=3, default_retry_delay=20)
def send_push(self, payload: dict):
    try:
        return _run(_push, payload)
    except Exception as e:
        raise self.retry(exc=e, countdown=min(20 * 2**self.request.retries, 600)) from e
