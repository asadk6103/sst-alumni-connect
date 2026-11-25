"""Privacy: members download their personal data and ask for account deletion; administrators review requests.

Deletion anonymises the account instead of removing rows other people depend on: the person's identity, profile,
contact details, network, files and preferences are erased; posts and messages they wrote stay in conversations but
show "Deleted member"; donation records are kept for the institution's financial records without the donor's name
or email. Exports and deletions are audit-logged.
"""

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Literal

import orjson
from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.audit import record
from ...core.db import get_db
from ...core.deps import Principal, require
from ...core.errors import AppError, not_found
from ...core.pagination import PageParams, page_params, paginate
from ...core.redis import enforce
from ...core.security import verify_password
from ...models import (
    AlumniAchievement,
    AlumniConnection,
    AlumniEducation,
    AlumniEmployment,
    AlumniFollow,
    AlumniProfile,
    AlumniSkill,
    Comment,
    Donation,
    EventRegistration,
    GroupMember,
    JobApplication,
    Mentor,
    MentorshipRequest,
    Message,
    NewsletterSubscriber,
    Notification,
    NotificationPreference,
    Post,
    PrivacyRequest,
    Resume,
    SavedJob,
    User,
)
from ..auth.service import revoke_all

router = APIRouter(prefix="/api/v1/account", tags=["Privacy"])
admin = APIRouter(prefix="/api/v1/admin/privacy", tags=["Admin: privacy"])

SECRET = ("hash", "secret", "token", "search", "reg_norm", "recovery", "totp", "otp")
# (section, model, owner column) — everything the member owns
SECTIONS = [
    ("profile", AlumniProfile, "user_id"),
    ("education", AlumniEducation, "user_id"),
    ("employment", AlumniEmployment, "user_id"),
    ("profile_achievements", AlumniAchievement, "user_id"),
    ("skills", AlumniSkill, "user_id"),
    ("following", AlumniFollow, "follower_id"),
    ("groups", GroupMember, "user_id"),
    ("posts", Post, "author_id"),
    ("comments", Comment, "author_id"),
    ("messages_sent", Message, "sender_id"),
    ("event_registrations", EventRegistration, "user_id"),
    ("cvs", Resume, "user_id"),
    ("job_applications", JobApplication, "user_id"),
    ("saved_jobs", SavedJob, "user_id"),
    ("mentor_profile", Mentor, "user_id"),
    ("mentorship_as_mentee", MentorshipRequest, "mentee_id"),
    ("donations", Donation, "user_id"),
    ("notification_preferences", NotificationPreference, "user_id"),
    ("newsletter", NewsletterSubscriber, "user_id"),
]


def _row(obj) -> dict:
    out = {}
    for c in obj.__table__.columns:
        if any(s in c.name for s in SECRET):
            continue
        v = getattr(obj, c.key, None)
        out[c.name] = str(v) if isinstance(v, uuid.UUID | Decimal) else v.isoformat() if isinstance(v, datetime | date) else v
    return out


async def personal_data(db: AsyncSession, uid: uuid.UUID) -> dict:
    user = await db.get(User, uid)
    data: dict = {"generated_at": datetime.now(UTC).isoformat(), "account": {**_row(user), "roles": [r.name for r in user.roles]}}
    for name, model, col in SECTIONS:
        rows = (await db.execute(select(model).where(getattr(model, col) == uid))).scalars().all()
        data[name] = [_row(r) for r in rows]
    conns = (
        (await db.execute(select(AlumniConnection).where(or_(AlumniConnection.requester_id == uid, AlumniConnection.addressee_id == uid))))
        .scalars()
        .all()
    )
    data["connections"] = [_row(c) for c in conns]
    data["notifications"] = [
        _row(n)
        for n in (
            await db.execute(select(Notification).where(Notification.user_id == uid).order_by(Notification.id.desc()).limit(500))
        ).scalars()
    ]
    return data


@router.get("/export", summary="Download a copy of your personal data (JSON)")
async def export_data(me: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    await enforce(f"data-export:{me.id}", 3, 86400, "You can download your data three times a day.")
    data = await personal_data(db, me.id)
    await record(db, actor_id=me.id, action="export", entity="personal_data", entity_id=me.id, summary="Downloaded their personal data")
    await db.commit()
    body = orjson.dumps(data, option=orjson.OPT_INDENT_2 | orjson.OPT_NON_STR_KEYS, default=str)
    return Response(
        body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="my-data-{date.today():%Y%m%d}.json"', "Cache-Control": "no-store"},
    )


def request_out(r: PrivacyRequest, user: User | None = None) -> dict:
    out = {
        "id": str(r.id),
        "kind": r.kind,
        "status": r.status,
        "reason": r.reason,
        "admin_note": r.admin_note,
        "created_at": r.created_at,
        "handled_at": r.handled_at,
    }
    if user is not None:
        out["user"] = {"id": str(user.id), "full_name": user.full_name, "email": user.email}
    return out


async def _open_request(db: AsyncSession, uid) -> PrivacyRequest | None:
    return (
        await db.execute(select(PrivacyRequest).where(PrivacyRequest.user_id == uid, PrivacyRequest.status == "pending"))
    ).scalar_one_or_none()


@router.get("/deletion-request", summary="Your account deletion request, if any")
async def my_request(me: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    r = (
        await db.execute(select(PrivacyRequest).where(PrivacyRequest.user_id == me.id).order_by(PrivacyRequest.created_at.desc()).limit(1))
    ).scalar_one_or_none()
    return {"data": request_out(r) if r else None}


class DeletionIn(BaseModel):
    password: str = Field(..., min_length=1, max_length=256)
    reason: str | None = Field(None, max_length=1000)


@router.post("/deletion-request", status_code=201, summary="Ask the alumni office to delete your account")
async def request_deletion(body: DeletionIn, me: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    await enforce(f"deletion-req:{me.id}", 5, 3600, "Too many attempts. Please try again later.")
    user = await db.get(User, me.id)
    if not verify_password(user.password_hash, body.password):
        raise AppError(
            422, "VALIDATION_ERROR", "The password is not correct.", [{"field": "password", "message": "The password is not correct."}]
        )
    if any(r.key == "super_admin" for r in user.roles):
        raise AppError(422, "NOT_ALLOWED", "A Super Administrator account cannot be deleted this way. Transfer the role first.")
    if await _open_request(db, me.id):
        raise AppError(409, "REQUEST_EXISTS", "You already have a pending deletion request.")
    r = PrivacyRequest(user_id=me.id, kind="deletion", status="pending", reason=(body.reason or "").strip() or None)
    db.add(r)
    await db.flush()
    await record(db, actor_id=me.id, action="request", entity="privacy_request", entity_id=r.id, summary="Asked for account deletion")
    await db.commit()
    return {"data": request_out(r)}


@router.delete("/deletion-request", summary="Withdraw your pending deletion request")
async def cancel_deletion(me: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    r = await _open_request(db, me.id)
    if not r:
        raise not_found("Request")
    r.status, r.handled_at = "cancelled", datetime.now(UTC)
    await db.commit()
    return {"data": request_out(r)}


# ── administration ──────────────────────────────────────────────────────────
@admin.get("/requests", summary="Account deletion requests")
async def list_requests(
    status: Literal["pending", "completed", "rejected", "cancelled"] | None = "pending",
    p: PageParams = Depends(page_params),
    _: Principal = Depends(require("users.view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(PrivacyRequest).order_by(PrivacyRequest.created_at.desc())
    if status:
        stmt = stmt.where(PrivacyRequest.status == status)
    rows, meta = await paginate(db, stmt, p)
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_({r.user_id for r in rows})))).scalars()} if rows else {}
    return {"data": [request_out(r, users.get(r.user_id)) for r in rows], "meta": meta}


async def anonymise(db: AsyncSession, uid: uuid.UUID) -> None:
    user = await db.get(User, uid)
    short = uid.hex[:12]
    await revoke_all(db, uid)
    user.full_name, user.email, user.phone = "Deleted member", f"deleted-{short}@deleted.invalid", None
    # "!" is never a valid argon2 hash, so no password can ever match again
    user.password_hash, user.status, user.deleted_at = "!", "deactivated", datetime.now(UTC)
    user.totp_secret_enc, user.totp_enabled, user.recovery_codes = None, False, None
    user.phone_verified_at, user.last_login_at = None, None
    profile = await db.get(AlumniProfile, uid)
    if profile:
        for f in (
            "gender",
            "date_of_birth",
            "class_name",
            "registration_no",
            "reg_norm",
            "city",
            "country",
            "designation",
            "organization",
            "industry",
            "bio",
            "photo_id",
            "website",
            "linkedin",
            "verification_note",
            "matched_record_id",
        ):
            setattr(profile, f, None)
        profile.custom_fields, profile.evidence_ids, profile.visibility, profile.search = {}, [], "hidden", None
    for model, col in (
        (AlumniEducation, "user_id"),
        (AlumniEmployment, "user_id"),
        (AlumniAchievement, "user_id"),
        (AlumniSkill, "user_id"),
        (AlumniFollow, "follower_id"),
        (AlumniFollow, "followee_id"),
        (GroupMember, "user_id"),
        (SavedJob, "user_id"),
        (Resume, "user_id"),
        (Mentor, "user_id"),
        (NewsletterSubscriber, "user_id"),
        (Notification, "user_id"),
        (NotificationPreference, "user_id"),
    ):
        await db.execute(delete(model).where(getattr(model, col) == uid))
    await db.execute(delete(AlumniConnection).where(or_(AlumniConnection.requester_id == uid, AlumniConnection.addressee_id == uid)))
    # financial records stay, without identity
    await db.execute(
        update(Donation)
        .where(Donation.user_id == uid)
        .values(donor_name="Anonymous (account deleted)", donor_email=None, custom_fields={}, message=None)
    )


class DecisionIn(BaseModel):
    note: str | None = Field(None, max_length=1000)


@admin.post("/requests/{request_id}/approve", summary="Delete (anonymise) the member's account")
async def approve(
    request_id: uuid.UUID, body: DecisionIn, me: Principal = Depends(require("users.delete")), db: AsyncSession = Depends(get_db)
):
    r = await db.get(PrivacyRequest, request_id)
    if not r or r.status != "pending":
        raise not_found("Request")
    if r.user_id == me.id:
        raise AppError(422, "NOT_ALLOWED", "Another administrator must handle your own request.")
    user = await db.get(User, r.user_id)
    if any(x.key == "super_admin" for x in user.roles):
        raise AppError(422, "NOT_ALLOWED", "Remove the Super Administrator role first.")
    await anonymise(db, r.user_id)
    r.status, r.admin_note, r.handled_by, r.handled_at = "completed", body.note, me.id, datetime.now(UTC)
    await record(
        db,
        actor_id=me.id,
        action="delete",
        entity="user",
        entity_id=r.user_id,
        summary="Deleted an account on the member's request (anonymised)",
    )
    await db.commit()
    return {"data": request_out(r)}


@admin.post("/requests/{request_id}/reject", summary="Decline a deletion request (explain why)")
async def reject(
    request_id: uuid.UUID, body: DecisionIn, me: Principal = Depends(require("users.delete")), db: AsyncSession = Depends(get_db)
):
    r = await db.get(PrivacyRequest, request_id)
    if not r or r.status != "pending":
        raise not_found("Request")
    if not body.note:
        raise AppError(422, "VALIDATION_ERROR", "Explain the reason to the member.", [{"field": "note", "message": "Required."}])
    r.status, r.admin_note, r.handled_by, r.handled_at = "rejected", body.note, me.id, datetime.now(UTC)
    await record(
        db, actor_id=me.id, action="reject", entity="privacy_request", entity_id=r.id, summary="Declined an account deletion request"
    )
    await db.commit()
    return {"data": request_out(r)}
