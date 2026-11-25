"""Administration: alumni management, verification queue, verification codes and profile reports."""

import uuid
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.audit import record
from ...core.db import get_db
from ...core.deps import Principal, client_ip, require
from ...core.errors import AppError, conflict, not_found
from ...core.pagination import PageParams, csv_response, page_params
from ...core.security import hash_password, random_token, token_hash
from ...models import (
    AlumniProfile,
    Batch,
    Media,
    ProfileReport,
    Role,
    StudentRecord,
    User,
    VerificationCode,
    VerificationEvent,
)
from ...services import media, messaging
from ..auth import service as auth_svc
from . import service as svc
from .schemas import PHONE, PresentFields, SchoolFields, fail, validate_school

router = APIRouter(prefix="/api/v1/admin", tags=["Admin: alumni"])

STATUSES = Literal["pending", "verified", "rejected"]


def _filtered(
    q: str | None,
    status: str | None,
    batch: uuid.UUID | None,
    year: int | None,
    country: str | None,
    kind: str | None,
    account: str | None,
    match: str | None = None,
) -> Select:
    stmt = select(User, AlumniProfile).join(AlumniProfile, AlumniProfile.user_id == User.id).where(User.deleted_at.is_(None))
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(User.full_name).like(like),
                func.lower(User.email).like(like),
                User.phone.like(like),
                func.lower(AlumniProfile.registration_no).like(like),
                func.lower(AlumniProfile.organization).like(like),
            )
        )
    if status:
        stmt = stmt.where(AlumniProfile.verification_status == status)
    if batch:
        stmt = stmt.where(AlumniProfile.batch_id == batch)
    if year:
        stmt = stmt.where(AlumniProfile.graduation_year == year)
    if country:
        stmt = stmt.where(func.lower(AlumniProfile.country) == country.strip().lower())
    if kind:
        stmt = stmt.where(AlumniProfile.kind == kind)
    if account:
        stmt = stmt.where(User.status == account)
    if match == "any":
        stmt = stmt.where(AlumniProfile.match_strength.is_not(None))
    elif match:
        stmt = stmt.where(AlumniProfile.match_strength == match)
    return stmt


async def _rows_out(db: AsyncSession, rows) -> list[dict]:
    names = await svc.batch_names(db, {pr.batch_id for _, pr in rows})
    out = []
    for u, pr in rows:
        out.append(
            {
                "id": str(u.id),
                "full_name": u.full_name,
                "email": u.email,
                "phone": u.phone,
                "account_status": u.status,
                "email_verified": bool(u.email_verified_at),
                "phone_verified": bool(u.phone_verified_at),
                "kind": pr.kind,
                "graduation_year": pr.graduation_year,
                "admission_year": pr.admission_year,
                "batch_id": str(pr.batch_id) if pr.batch_id else None,
                "batch": names.get(pr.batch_id),
                "registration_no": pr.registration_no,
                "city": pr.city,
                "country": pr.country,
                "designation": pr.designation,
                "organization": pr.organization,
                "verification_status": pr.verification_status,
                "verification_method": pr.verification_method,
                "match_strength": pr.match_strength,
                "submitted_at": pr.submitted_at,
                "verified_at": pr.verified_at,
                "documents": len(pr.evidence_ids or []),
                "completion": pr.completion,
                "photo": await svc.photo_out(db, pr.photo_id),
                "created_at": u.created_at,
            }
        )
    return out


async def _page(db: AsyncSession, stmt: Select, order, p: PageParams) -> dict:
    total = (await db.execute(select(func.count()).select_from(stmt.order_by(None).subquery()))).scalar_one()
    rows = (await db.execute(stmt.order_by(*order, User.id).offset((p.page - 1) * p.page_size).limit(p.page_size))).all()
    return {
        "data": await _rows_out(db, rows),
        "meta": {"page": p.page, "page_size": p.page_size, "total": total, "pages": max(1, -(-total // p.page_size))},
    }


SORTS = {
    "name": [User.full_name.asc()],
    "-created": [User.created_at.desc()],
    "-year": [AlumniProfile.graduation_year.desc().nulls_last()],
    "year": [AlumniProfile.graduation_year.asc().nulls_last()],
    "submitted": [AlumniProfile.submitted_at.asc().nulls_last()],
    "-completion": [AlumniProfile.completion.desc()],
}


# ── alumni management ───────────────────────────────────────────────────────
@router.get("/alumni", summary="List alumni and students")
async def list_alumni(
    q: str | None = Query(None, max_length=100),
    status: STATUSES | None = None,
    batch: uuid.UUID | None = None,
    year: int | None = Query(None, ge=1900, le=2100),
    country: str | None = Query(None, max_length=100),
    kind: Literal["alumni", "student"] | None = None,
    account: Literal["active", "pending", "deactivated"] | None = None,
    sort: Literal["name", "-created", "-year", "year", "-completion"] = "-created",
    p: PageParams = Depends(page_params),
    _: Principal = Depends(require("alumni.view")),
    db: AsyncSession = Depends(get_db),
):
    return await _page(db, _filtered(q, status, batch, year, country, kind, account), SORTS[sort], p)


@router.get("/alumni/export", summary="Export alumni as CSV")
async def export_alumni(
    q: str | None = None,
    status: STATUSES | None = None,
    batch: uuid.UUID | None = None,
    year: int | None = None,
    country: str | None = None,
    kind: Literal["alumni", "student"] | None = None,
    account: Literal["active", "pending", "deactivated"] | None = None,
    me: Principal = Depends(require("alumni.export")),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(_filtered(q, status, batch, year, country, kind, account).order_by(AlumniProfile.graduation_year, User.full_name))
    ).all()
    names = await svc.batch_names(db, {pr.batch_id for _, pr in rows})
    await record(db, actor_id=me.id, action="export", entity="alumni", summary=f"Exported {len(rows)} alumni records")
    await db.commit()
    return csv_response(
        "alumni.csv",
        [
            "Name",
            "Email",
            "Mobile",
            "Type",
            "Graduation year",
            "Admission year",
            "Batch",
            "Class",
            "Registration no.",
            "City",
            "Country",
            "Designation",
            "Organisation",
            "Industry",
            "Verification",
            "Method",
            "Verified at",
            "Account",
            "Profile completion %",
            "Registered",
        ],
        (
            [
                u.full_name,
                u.email,
                u.phone or "",
                pr.kind,
                pr.graduation_year or "",
                pr.admission_year or "",
                names.get(pr.batch_id, ""),
                pr.class_name or "",
                pr.registration_no or "",
                pr.city or "",
                pr.country or "",
                pr.designation or "",
                pr.organization or "",
                pr.industry or "",
                pr.verification_status,
                pr.verification_method or "",
                pr.verified_at.isoformat() if pr.verified_at else "",
                u.status,
                pr.completion,
                u.created_at.isoformat(),
            ]
            for u, pr in rows
        ),
    )


async def _load(db: AsyncSession, user_id: uuid.UUID) -> tuple[User, AlumniProfile]:
    row = (
        await db.execute(
            select(User, AlumniProfile)
            .join(AlumniProfile, AlumniProfile.user_id == User.id)
            .where(User.id == user_id, User.deleted_at.is_(None))
        )
    ).first()
    if not row:
        raise not_found("Alumni record")
    return row[0], row[1]


async def _record_out(db: AsyncSession, rec: StudentRecord | None) -> dict | None:
    if not rec:
        return None
    names = await svc.batch_names(db, {rec.batch_id})
    return {
        "id": str(rec.id),
        "registration_no": rec.registration_no,
        "full_name": rec.full_name,
        "father_name": rec.father_name,
        "date_of_birth": rec.date_of_birth,
        "admission_year": rec.admission_year,
        "graduation_year": rec.graduation_year,
        "class_name": rec.class_name,
        "batch": names.get(rec.batch_id),
        "email": rec.email,
        "phone": rec.phone,
        "matched_user_id": str(rec.matched_user_id) if rec.matched_user_id else None,
    }


@router.get("/alumni/{user_id}", summary="Full alumni record (all sections, documents, history, record match)")
async def get_alumni(
    user_id: uuid.UUID,
    me: Principal = Depends(require("alumni.view", "verification.view", any_of=True)),
    db: AsyncSession = Depends(get_db),
):
    user, profile = await _load(db, user_id)
    out = (await _rows_out(db, [(user, profile)]))[0]
    full = await svc.detail(db, user, profile, svc.Viewer(me))
    docs = []
    for mid in profile.evidence_ids or []:
        m = await db.get(Media, uuid.UUID(mid))
        if m and not m.deleted_at:
            docs.append({"id": str(m.id), "filename": m.filename, "size": m.size, "mime": m.mime, "created_at": m.created_at})
    history = (
        await db.execute(
            select(VerificationEvent, User.full_name)
            .outerjoin(User, User.id == VerificationEvent.actor_id)
            .where(VerificationEvent.user_id == user_id)
            .order_by(VerificationEvent.created_at.desc())
            .limit(50)
        )
    ).all()
    reports = (
        await db.execute(
            select(func.count()).select_from(ProfileReport).where(ProfileReport.user_id == user_id, ProfileReport.status == "open")
        )
    ).scalar_one()
    rec = await db.get(StudentRecord, profile.matched_record_id) if profile.matched_record_id else None
    out.update(
        {
            **{
                k: full[k]
                for k in ("bio", "skills", "employment", "education", "achievements", "followers", "connections", "website", "linkedin")
            },
            "gender": profile.gender,
            "date_of_birth": profile.date_of_birth,
            "class_name": profile.class_name,
            "industry": profile.industry,
            "visibility": profile.visibility,
            "privacy": svc.privacy_of(profile),
            "verification_note": profile.verification_note,
            "rejection_reason": profile.rejection_reason,
            "documents": docs,
            "open_reports": reports,
            "record": await _record_out(db, rec),
            "roles": [{"key": r.key, "name": r.name} for r in user.roles],
            "last_login_at": user.last_login_at,
            "history": [
                {"action": e.action, "method": e.method, "note": e.note, "actor": name, "created_at": e.created_at} for e, name in history
            ],
        }
    )
    return {"data": out}


class AlumniEditIn(SchoolFields, PresentFields):
    full_name: str | None = Field(None, min_length=2, max_length=150)
    phone: str | None = Field(None, pattern=PHONE)
    industry: str | None = Field(None, max_length=100)


@router.patch("/alumni/{user_id}", summary="Correct an alumni record (including verified school details)")
async def edit_alumni(
    user_id: uuid.UUID,
    body: AlumniEditIn,
    request: Request,
    me: Principal = Depends(require("alumni.edit")),
    db: AsyncSession = Depends(get_db),
):
    user, profile = await _load(db, user_id)
    sent = body.model_fields_set
    school = {"kind", "admission_year", "graduation_year", "batch_id", "date_of_birth"} & sent
    if school:
        merged = body.model_copy(
            update={f: getattr(profile, f) for f in ("kind", "admission_year", "graduation_year", "batch_id") if f not in sent}
        )
        await validate_school(db, merged, await svc.settings(db), registering=False, fields=school)
    changes = {}
    if "full_name" in sent and body.full_name:
        user.full_name = changes["full_name"] = body.full_name
    if "phone" in sent and (body.phone or None) != user.phone:
        user.phone, user.phone_verified_at = (body.phone or "").replace(" ", "") or None, None
        changes["phone"] = user.phone
    for f in (
        "kind",
        "gender",
        "date_of_birth",
        "admission_year",
        "graduation_year",
        "batch_id",
        "class_name",
        "city",
        "country",
        "designation",
        "organization",
        "industry",
    ):
        if f in sent and getattr(profile, f) != getattr(body, f):
            setattr(profile, f, getattr(body, f))
            changes[f] = str(getattr(body, f)) if getattr(body, f) is not None else None
    if "registration_no" in sent and body.registration_no != profile.registration_no:
        profile.registration_no, profile.reg_norm = body.registration_no, svc.norm_reg(body.registration_no)
        changes["registration_no"] = body.registration_no
    if "kind" in changes and profile.verification_status == "verified":
        await svc.set_member_role(db, user, profile.kind, True)
    if profile.verification_status != "verified":
        await svc.refresh_match(db, user, profile)
    await svc.refresh_search(db, user.id)
    await record(
        db,
        actor_id=me.id,
        action="update",
        entity="alumni",
        entity_id=user.id,
        summary=f"Updated alumni record of {user.email}",
        data=changes,
        ip=client_ip(request),
    )
    return await get_alumni(user.id, me, db)


class AlumniCreateIn(SchoolFields, PresentFields):
    full_name: str = Field(..., min_length=2, max_length=150)
    email: EmailStr
    phone: str | None = Field(None, pattern=PHONE)
    verified: bool = True


@router.post("/alumni", status_code=201, summary="Add an alumnus (emails a link to set a password)")
async def create_alumni(
    body: AlumniCreateIn, request: Request, me: Principal = Depends(require("alumni.create")), db: AsyncSession = Depends(get_db)
):
    if body.verified and not me.can("verification.approve"):
        raise AppError(403, "FORBIDDEN", "You cannot verify alumni.")
    cfg = await svc.settings(db)
    await validate_school(db, body, cfg, registering=True)
    user = await _new_member(db, body.full_name, str(body.email), body.phone)
    profile = AlumniProfile(
        user_id=user.id,
        kind=body.kind,
        gender=body.gender,
        date_of_birth=body.date_of_birth,
        admission_year=body.admission_year,
        graduation_year=body.graduation_year,
        batch_id=body.batch_id,
        class_name=body.class_name,
        registration_no=body.registration_no,
        reg_norm=svc.norm_reg(body.registration_no),
        city=body.city,
        country=body.country,
        designation=body.designation,
        organization=body.organization,
        visibility=cfg.default_profile_visibility,
        privacy=svc.default_privacy(cfg),
        verification_status="pending",
        submitted_at=svc.now(),
        evidence_ids=[],
    )
    db.add(profile)
    await db.flush()
    await svc.log(db, user.id, "submitted", note="Added by an administrator.", actor_id=me.id)
    if body.verified:
        await svc.approve(db, user, profile, method="manual", actor_id=me.id, note="Added by an administrator.", notify=False)
    else:
        await svc.refresh_match(db, user, profile)
    await svc.refresh_search(db, user.id)
    await _invite_email(db, user)
    await record(
        db, actor_id=me.id, action="create", entity="alumni", entity_id=user.id, summary=f"Added alumni {user.email}", ip=client_ip(request)
    )
    return await get_alumni(user.id, me, db)


async def _new_member(db: AsyncSession, full_name: str, email: str, phone: str | None) -> User:
    exists = (await db.execute(select(User.id).where(func.lower(User.email) == email.lower(), User.deleted_at.is_(None)))).first()
    if exists:
        raise conflict("EMAIL_TAKEN", "A user with this email already exists.")
    role = (await db.execute(select(Role).where(Role.key == svc.UNVERIFIED_ROLE))).scalar_one()
    general = await settings_store.get_group(db, "general")
    user = User(
        full_name=full_name.strip(),
        email=email.lower(),
        phone=phone.replace(" ", "") if phone else None,
        password_hash=hash_password(random_token(32)),
        status="pending",
        roles=[role],
        language=general.default_language,
    )
    db.add(user)
    await db.flush()
    return user


async def _invite_email(db: AsyncSession, user: User) -> None:
    """Invitation = a 7-day set-password link; using it proves the mailbox and activates the account."""
    token = random_token(32)
    await auth_svc.create_verification(db, user, "password_reset", token_hash(token), timedelta(days=7))
    general = await settings_store.get_group(db, "general")
    await messaging.queue_email(
        db,
        user.email,
        "alumni.invite",
        {"name": user.full_name, "link": f"{general.app_url}/reset-password?token={token}&welcome=1", "days": 7},
        user.language or "en",
    )


# ── verification queue ──────────────────────────────────────────────────────
@router.get("/verification", summary="Verification queue")
async def verification_queue(
    status: STATUSES = "pending",
    q: str | None = Query(None, max_length=100),
    match: Literal["strong", "partial", "any", "none"] | None = None,
    year: int | None = Query(None, ge=1900, le=2100),
    p: PageParams = Depends(page_params),
    _: Principal = Depends(require("verification.view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = _filtered(q, status, None, year, None, None, None, None if match == "none" else match)
    if match == "none":
        stmt = stmt.where(AlumniProfile.match_strength.is_(None))
    if status == "pending":
        stmt = stmt.where(User.status != "deactivated")
    order = SORTS["submitted"] if status == "pending" else [AlumniProfile.updated_at.desc()]
    page = await _page(db, stmt, order, p)
    counts = dict(
        (
            await db.execute(
                select(AlumniProfile.verification_status, func.count())
                .join(User, User.id == AlumniProfile.user_id)
                .where(User.deleted_at.is_(None))
                .group_by(AlumniProfile.verification_status)
            )
        ).all()
    )
    page["meta"]["counts"] = {k: counts.get(k, 0) for k in ("pending", "verified", "rejected")}
    return page


class ApproveIn(BaseModel):
    note: str | None = Field(None, max_length=500)
    record_id: uuid.UUID | None = None  # confirms the match with this institutional record


class RejectIn(BaseModel):
    reason: str = Field(..., min_length=3, max_length=500)


@router.post("/verification/{user_id}/approve", summary="Verify a member")
async def approve(
    user_id: uuid.UUID,
    body: ApproveIn,
    request: Request,
    me: Principal = Depends(require("verification.approve")),
    db: AsyncSession = Depends(get_db),
):
    user, profile = await _load(db, user_id)
    if profile.verification_status == "verified":
        raise conflict("ALREADY_VERIFIED", "This member is already verified.")
    rec = None
    if body.record_id:
        rec = await db.get(StudentRecord, body.record_id)
        if not rec:
            raise not_found("Student record")
        if rec.matched_user_id and rec.matched_user_id != user.id:
            raise conflict("RECORD_IN_USE", "This school record already belongs to another member.")
    await svc.approve(db, user, profile, method="record_match" if rec else "manual", actor_id=me.id, record=rec, note=body.note)
    await record(
        db,
        actor_id=me.id,
        action="approve",
        entity="alumni",
        entity_id=user.id,
        summary=f"Verified {user.full_name}",
        ip=client_ip(request),
    )
    return {"data": {"verification_status": "verified"}}


@router.post("/verification/{user_id}/reject", summary="Reject a registration (the member can correct and resubmit)")
async def reject(
    user_id: uuid.UUID,
    body: RejectIn,
    request: Request,
    me: Principal = Depends(require("verification.reject")),
    db: AsyncSession = Depends(get_db),
):
    user, profile = await _load(db, user_id)
    if profile.verification_status == "verified":
        raise conflict("ALREADY_VERIFIED", "Use “Revoke verification” for a verified member.")
    await svc.reject(db, user, profile, reason=body.reason, actor_id=me.id)
    await record(
        db,
        actor_id=me.id,
        action="reject",
        entity="alumni",
        entity_id=user.id,
        summary=f"Rejected verification of {user.full_name}",
        data={"reason": body.reason},
        ip=client_ip(request),
    )
    return {"data": {"verification_status": "rejected"}}


@router.post("/verification/{user_id}/revoke", summary="Revoke a verification")
async def revoke(
    user_id: uuid.UUID,
    body: RejectIn,
    request: Request,
    me: Principal = Depends(require("verification.reject")),
    db: AsyncSession = Depends(get_db),
):
    user, profile = await _load(db, user_id)
    if profile.verification_status != "verified":
        raise conflict("NOT_VERIFIED", "This member is not verified.")
    await svc.reject(db, user, profile, reason=body.reason, actor_id=me.id, revoke=True)
    await record(
        db,
        actor_id=me.id,
        action="revoke",
        entity="alumni",
        entity_id=user.id,
        summary=f"Revoked verification of {user.full_name}",
        data={"reason": body.reason},
        ip=client_ip(request),
    )
    return {"data": {"verification_status": "rejected"}}


class BulkApproveIn(BaseModel):
    user_ids: list[uuid.UUID] = Field(..., min_length=1, max_length=100)
    note: str | None = Field(None, max_length=500)


@router.post("/verification/bulk-approve", summary="Verify several members (strong record matches use the record)")
async def bulk_approve(
    body: BulkApproveIn, request: Request, me: Principal = Depends(require("verification.approve")), db: AsyncSession = Depends(get_db)
):
    done, skipped = 0, []
    for uid in body.user_ids:
        try:
            user, profile = await _load(db, uid)
        except AppError:
            skipped.append({"id": str(uid), "reason": "Not found"})
            continue
        if profile.verification_status == "verified":
            continue
        rec = await db.get(StudentRecord, profile.matched_record_id) if profile.match_strength == "strong" else None
        try:
            async with db.begin_nested():
                await svc.approve(db, user, profile, method="record_match" if rec else "manual", actor_id=me.id, record=rec, note=body.note)
            done += 1
        except AppError as e:
            skipped.append({"id": str(uid), "name": user.full_name, "reason": e.message})
    await record(db, actor_id=me.id, action="approve", entity="alumni", summary=f"Verified {done} members (bulk)", ip=client_ip(request))
    return {"data": {"approved": done, "skipped": skipped}}


@router.get("/verification/{user_id}/documents/{media_id}", summary="Open a supporting document")
async def document(
    user_id: uuid.UUID,
    media_id: uuid.UUID,
    request: Request,
    me: Principal = Depends(require("verification.view")),
    db: AsyncSession = Depends(get_db),
):
    _, profile = await _load(db, user_id)
    m = await db.get(Media, media_id)
    if str(media_id) not in (profile.evidence_ids or []) or not m or m.deleted_at:
        raise not_found("Document")
    await record(
        db,
        actor_id=me.id,
        action="view_document",
        entity="alumni",
        entity_id=user_id,
        summary=f"Opened verification document {m.filename}",
        ip=client_ip(request),
    )
    await db.commit()
    return media.download_response(m, await media.read(db, m))


# ── verification codes (institutional process) ──────────────────────────────
class CodesIn(BaseModel):
    label: str = Field(..., min_length=2, max_length=150)
    count: int = Field(1, ge=1, le=200)
    max_uses: int = Field(1, ge=1, le=1000)
    expires_in_days: int | None = Field(30, ge=1, le=730)
    batch_id: uuid.UUID | None = None


def _code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I
    import secrets as _s

    raw = "".join(_s.choice(alphabet) for _ in range(12))
    return f"{raw[:4]}-{raw[4:8]}-{raw[8:]}"


@router.get("/verification-codes", summary="Verification codes issued by the alumni office")
async def list_codes(
    p: PageParams = Depends(page_params), _: Principal = Depends(require("verification.approve")), db: AsyncSession = Depends(get_db)
):
    stmt = (
        select(VerificationCode, Batch.name, User.full_name)
        .outerjoin(Batch, Batch.id == VerificationCode.batch_id)
        .outerjoin(User, User.id == VerificationCode.created_by)
    )
    total = (await db.execute(select(func.count()).select_from(VerificationCode))).scalar_one()
    rows = (await db.execute(stmt.order_by(VerificationCode.created_at.desc()).offset((p.page - 1) * p.page_size).limit(p.page_size))).all()
    now = svc.now()
    return {
        "data": [
            {
                "id": str(c.id),
                "label": c.label,
                "hint": c.hint,
                "batch": b,
                "max_uses": c.max_uses,
                "uses": c.uses,
                "expires_at": c.expires_at,
                "created_by": who,
                "created_at": c.created_at,
                "state": "revoked"
                if c.revoked_at
                else "expired"
                if c.expires_at and c.expires_at <= now
                else "used"
                if c.uses >= c.max_uses
                else "active",
            }
            for c, b, who in rows
        ],
        "meta": {"page": p.page, "page_size": p.page_size, "total": total, "pages": max(1, -(-total // p.page_size))},
    }


@router.post("/verification-codes", status_code=201, summary="Issue verification codes (shown once)")
async def create_codes(
    body: CodesIn, request: Request, me: Principal = Depends(require("verification.approve")), db: AsyncSession = Depends(get_db)
):
    if body.batch_id and not await db.get(Batch, body.batch_id):
        fail("batch_id", "This batch does not exist.")
    expires = svc.now() + timedelta(days=body.expires_in_days) if body.expires_in_days else None
    codes = []
    for _ in range(body.count):
        code = _code()
        plain = code.replace("-", "")
        db.add(
            VerificationCode(
                code_hash=token_hash(plain),
                hint=plain[-4:],
                label=body.label,
                batch_id=body.batch_id,
                max_uses=body.max_uses,
                expires_at=expires,
                created_by=me.id,
            )
        )
        codes.append(code)
    await record(
        db,
        actor_id=me.id,
        action="create",
        entity="verification_code",
        summary=f"Issued {body.count} verification code(s): {body.label}",
        ip=client_ip(request),
    )
    return {"data": {"codes": codes, "expires_at": expires}}


@router.post("/verification-codes/{code_id}/revoke", summary="Revoke a verification code")
async def revoke_code(
    code_id: uuid.UUID, request: Request, me: Principal = Depends(require("verification.approve")), db: AsyncSession = Depends(get_db)
):
    c = await db.get(VerificationCode, code_id)
    if not c:
        raise not_found("Code")
    c.revoked_at = c.revoked_at or svc.now()
    await record(
        db,
        actor_id=me.id,
        action="revoke",
        entity="verification_code",
        entity_id=c.id,
        summary=f"Revoked verification code {c.label} (…{c.hint})",
        ip=client_ip(request),
    )
    return {"data": {"ok": True}}


# ── profile reports ─────────────────────────────────────────────────────────
@router.get("/profile-reports", summary="Reported profiles")
async def list_reports(
    status: Literal["open", "resolved", "dismissed"] = "open",
    p: PageParams = Depends(page_params),
    _: Principal = Depends(require("alumni.view")),
    db: AsyncSession = Depends(get_db),
):
    reported = User.__table__.alias("reported")
    reporter = User.__table__.alias("reporter")
    stmt = (
        select(ProfileReport, reported.c.full_name, reported.c.email, reporter.c.full_name)
        .join(reported, reported.c.id == ProfileReport.user_id)
        .outerjoin(reporter, reporter.c.id == ProfileReport.reporter_id)
        .where(ProfileReport.status == status)
    )
    total = (await db.execute(select(func.count()).select_from(ProfileReport).where(ProfileReport.status == status))).scalar_one()
    rows = (await db.execute(stmt.order_by(ProfileReport.created_at.desc()).offset((p.page - 1) * p.page_size).limit(p.page_size))).all()
    return {
        "data": [
            {
                "id": str(r.id),
                "user_id": str(r.user_id),
                "user_name": n,
                "user_email": e,
                "reporter": rn,
                "reason": r.reason,
                "details": r.details,
                "status": r.status,
                "resolution_note": r.resolution_note,
                "created_at": r.created_at,
                "resolved_at": r.resolved_at,
            }
            for r, n, e, rn in rows
        ],
        "meta": {"page": p.page, "page_size": p.page_size, "total": total, "pages": max(1, -(-total // p.page_size))},
    }


class ResolveIn(BaseModel):
    status: Literal["resolved", "dismissed"]
    note: str | None = Field(None, max_length=500)


@router.post("/profile-reports/{report_id}/resolve", summary="Close a profile report")
async def resolve_report(
    report_id: uuid.UUID,
    body: ResolveIn,
    request: Request,
    me: Principal = Depends(require("alumni.edit")),
    db: AsyncSession = Depends(get_db),
):
    r = await db.get(ProfileReport, report_id)
    if not r:
        raise not_found("Report")
    r.status, r.resolution_note, r.resolved_by, r.resolved_at = body.status, body.note, me.id, svc.now()
    await record(
        db,
        actor_id=me.id,
        action=body.status,
        entity="profile_report",
        entity_id=r.id,
        summary=f"Report on a profile {body.status}",
        data={"note": body.note},
        ip=client_ip(request),
    )
    return {"data": {"ok": True}}
