"""Mobile push notifications through the Expo Push Service (which delivers via FCM on Android and APNs on iOS).

Devices register their Expo push token against the signed-in account (several devices per account). Pushes are
queued after the database commit and sent by a Celery task; tokens the service reports as no longer registered are
removed. Members choose per category whether they want pushes (Notifications → Preferences).
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import PushDevice

EXPO_URL = "https://exp.host/--/api/v2/push/send"


async def tokens_of(db: AsyncSession, user_ids: list[uuid.UUID]) -> list[str]:
    if not user_ids:
        return []
    return list((await db.execute(select(PushDevice.token).where(PushDevice.user_id.in_(user_ids)))).scalars())


async def queue(
    db: AsyncSession,
    user_ids: list[uuid.UUID],
    title: str,
    body: str = "",
    data: dict | None = None,
    *,
    category: str = "general",
    collapse: str | None = None,
) -> int:
    """Queue one push for every device of these members (sent after the current transaction commits)."""
    tokens = await tokens_of(db, user_ids)
    if not tokens:
        return 0
    from ..worker import dispatch

    payload = {
        "tokens": tokens,
        "title": title[:120],
        "body": body[:240],
        "data": {**(data or {}), "category": category},
        "collapse": collapse,
    }
    dispatch("app.tasks.send_push", payload, after_commit_of=db)
    return len(tokens)


def messages(payload: dict) -> list[dict]:
    """Expo message objects (Android channel per category so members can silence a category in system settings)."""
    out = []
    for t in payload["tokens"]:
        m = {
            "to": t,
            "title": payload["title"],
            "body": payload["body"],
            "data": payload["data"],
            "sound": "default",
            "channelId": payload["data"].get("category", "general"),
            "priority": "high",
        }
        if payload.get("collapse"):
            m["collapseId"] = payload["collapse"]  # iOS: replace earlier pushes of the same conversation
            m["tag"] = payload["collapse"]
        out.append(m)
    return out


async def broadcast(db: AsyncSession, title: str, body: str, data: dict, category: str = "announcements") -> int:
    """Push to every registered device, except members who turned this category's pushes off."""
    from ..models import NotificationPreference, User

    off = select(NotificationPreference.user_id).where(NotificationPreference.category == category, NotificationPreference.push.is_(False))
    stmt = (
        select(PushDevice.token)
        .join(User, User.id == PushDevice.user_id)
        .where(User.deleted_at.is_(None), User.status == "active", PushDevice.user_id.not_in(off))
    )
    tokens = list((await db.execute(stmt)).scalars())
    if not tokens:
        return 0
    from ..worker import dispatch

    dispatch(
        "app.tasks.send_push",
        {"tokens": tokens, "title": title[:120], "body": body[:240], "data": {**data, "category": category}, "collapse": None},
        after_commit_of=db,
    )
    return len(tokens)
