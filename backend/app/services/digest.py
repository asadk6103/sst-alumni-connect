"""Weekly email digest for members who turned it on (Settings › Preferences)."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core import settings_store
from ..models import Event, JobPost, Notification, Post, User
from . import member_settings, messaging


async def digest_for(db: AsyncSession, user: User) -> dict:
    since = datetime.now(UTC) - timedelta(days=7)
    posts = (
        await db.execute(
            select(func.count()).select_from(Post).where(Post.status == "published", Post.group_id.is_(None), Post.created_at >= since)
        )
    ).scalar_one()
    events = (
        await db.execute(
            select(func.count())
            .select_from(Event)
            .where(Event.status == "published", Event.starts_at >= datetime.now(UTC), Event.batch_id.is_(None))
        )
    ).scalar_one()
    jobs = (
        await db.execute(select(func.count()).select_from(JobPost).where(JobPost.status == "approved", JobPost.approved_at >= since))
    ).scalar_one()
    unread = (
        await db.execute(
            select(func.count()).select_from(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
        )
    ).scalar_one()
    return {"posts": posts, "events": events, "jobs": jobs, "unread": unread}


async def send_weekly_digests(db: AsyncSession) -> int:
    general = await settings_store.get_group(db, "general")
    users = (
        (
            await db.execute(
                select(User).where(
                    User.id.in_(member_settings.opted_in("weekly_digest")), User.deleted_at.is_(None), User.status == "active"
                )
            )
        )
        .scalars()
        .all()
    )
    sent = 0
    for u in users:
        data = await digest_for(db, u)
        await messaging.queue_email(
            db, u.email, "digest.weekly", {"name": u.full_name, **data, "link": f"{general.app_url}/portal"}, u.language or "en"
        )
        sent += 1
    await db.commit()
    return sent
