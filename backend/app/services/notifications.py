"""One entry point for member notifications: in-app (bell), live push and email, each by the member's preference.

Account-security emails (password reset, sign-in alerts …) do not go through here: they are always sent.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Notification, NotificationPreference, User
from . import live, messaging

# category → (label, description) shown on the preferences page
CATEGORIES: dict[str, tuple[str, str]] = {
    "connections": ("Connections", "Connection requests and accepted requests."),
    "verification": ("Verification", "Decisions on your profile verification."),
    "community": ("Community", "Group decisions and moderation of your posts."),
    "events": ("Events", "Registrations, waitlist places, reminders and cancellations."),
    "jobs": ("Jobs", "Applications to your jobs and updates on your applications."),
    "mentorship": ("Mentorship", "Requests, replies, sessions and feedback."),
    "achievements": ("Achievements", "When your achievement is published."),
    "donations": ("Donations", "Pledges, confirmations and receipts."),
}


async def preference(db: AsyncSession, user_id: uuid.UUID, category: str) -> NotificationPreference:
    pref = await db.get(NotificationPreference, (user_id, category))
    return pref or NotificationPreference(user_id=user_id, category=category, in_app=True, email=True)


async def notify(
    db: AsyncSession,
    user_id: uuid.UUID,
    category: str,
    kind: str,
    title: str,
    *,
    body: str = "",
    link: str | None = None,
    actor_id: uuid.UUID | None = None,
    email: tuple[str, dict] | None = None,
) -> Notification | None:
    """Create the in-app notification (pushed live after commit) and queue the email template if wanted."""
    pref = await preference(db, user_id, category)
    note = None
    if pref.in_app:
        note = Notification(user_id=user_id, category=category, kind=kind, title=title[:200], body=body[:500], link=link, actor_id=actor_id)
        db.add(note)
        await db.flush()
        live.emit_to_user(db, user_id, "notification:new", {"id": note.id, "category": category, "title": note.title, "link": link})
    if email and pref.email:
        u = await db.get(User, user_id)
        if u and not u.deleted_at and u.status != "deactivated":
            template, data = email
            await messaging.queue_email(db, u.email, template, {"name": u.full_name, **data}, u.language or "en")
    return note


async def unread_count(db: AsyncSession, user_id: uuid.UUID) -> int:
    from sqlalchemy import func

    return (
        await db.execute(
            select(func.count()).select_from(Notification).where(Notification.user_id == user_id, Notification.read_at.is_(None))
        )
    ).scalar_one()
