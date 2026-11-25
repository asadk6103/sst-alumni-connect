"""Invite alumni: members email classmates a link to join; the inviter is told when someone joins."""

import secrets

from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.db import get_db
from ...core.deps import Principal, require
from ...core.errors import AppError
from ...core.redis import enforce
from ...models import Invitation, User
from ...services import messaging, notifications

router = APIRouter(prefix="/api/v1/invitations", tags=["Invitations"])


class InviteIn(BaseModel):
    emails: list[EmailStr] = Field(..., min_length=1, max_length=50)
    message: str = Field("", max_length=500)


@router.post("", status_code=201, summary="Invite people to join the alumni network by email")
async def invite(body: InviteIn, me: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    emails = list(dict.fromkeys(str(e).lower() for e in body.emails))
    await enforce(f"invites:{me.id}", 100, 86400, "You have sent many invitations today. Please try again tomorrow.")
    if len(emails) > 50:
        raise AppError(422, "VALIDATION_ERROR", "Invite at most 50 people at a time.")
    general = await settings_store.get_group(db, "general")
    registered = set((await db.execute(select(func.lower(User.email)).where(func.lower(User.email).in_(emails)))).scalars())
    sent = 0
    for email in emails:
        if email in registered or email == me.email.lower():
            continue  # already a member: nothing is sent (and the inviter is not told who is registered)
        existing = (
            await db.execute(select(Invitation).where(Invitation.inviter_id == me.id, Invitation.email == email))
        ).scalar_one_or_none()
        token = existing.token if existing else secrets.token_urlsafe(24)
        if not existing:
            await db.execute(pg_insert(Invitation).values(inviter_id=me.id, email=email, token=token).on_conflict_do_nothing())
        link = f"{general.app_url}/register?invite={token}&email={email}"
        await messaging.queue_email(
            db, email, "invite.alumni", {"inviter": me.full_name, "message": body.message.strip(), "link": link}, general.default_language
        )
        sent += 1
    await db.commit()
    return {"data": {"processed": len(emails)}, "meta": {"queued": sent}}


@router.get("", summary="People you invited")
async def my_invitations(me: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    rows = (
        await db.execute(select(Invitation).where(Invitation.inviter_id == me.id).order_by(Invitation.created_at.desc()).limit(200))
    ).scalars()
    return {"data": [{"email": r.email, "status": r.status, "created_at": r.created_at} for r in rows]}


async def mark_joined(db: AsyncSession, user: User, token: str | None) -> None:
    """Called after registration: every invitation to this address is marked joined; inviters are notified."""
    rows = list(
        (
            await db.execute(select(Invitation).where(func.lower(Invitation.email) == user.email.lower(), Invitation.status == "sent"))
        ).scalars()
    )
    if token and not any(r.token == token for r in rows):
        rows += list((await db.execute(select(Invitation).where(Invitation.token == token, Invitation.status == "sent"))).scalars())
    for r in rows:
        r.status, r.joined_user_id = "joined", user.id
        await notifications.notify(
            db,
            r.inviter_id,
            "connections",
            "invite_joined",
            f"{user.full_name} joined the alumni network",
            body="Someone you invited has registered.",
            link=f"/portal/alumni/{user.id}",
            actor_id=user.id,
        )
