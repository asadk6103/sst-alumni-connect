"""Self-registration of alumni and current students."""

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.audit import record
from ...core.db import get_db
from ...core.deps import client_ip
from ...core.errors import AppError
from ...core.redis import enforce
from ...core.security import hash_password
from ...models import AlumniProfile, Batch, Role, User
from ...services import custom_fields, messaging
from ..auth import service as auth_svc
from . import service as svc
from .schemas import RegisterIn, fail, validate_school

router = APIRouter(tags=["Registration"])

DONE = "Thank you for registering. Check your inbox for a link to confirm your email address."


@router.post("/api/v1/auth/register", status_code=201, summary="Register as an alumnus or current student")
async def register(body: RegisterIn, request: Request, db: AsyncSession = Depends(get_db)):
    ip = client_ip(request)
    await enforce(f"register-ip:{ip}", 10, 3600, "Too many registrations from this network. Please try again later.")
    cfg = await svc.settings(db)
    if not cfg.registration_open or not await settings_store.is_installed(db):
        raise AppError(403, "REGISTRATION_CLOSED", "Registration is currently closed. Please contact the alumni office.")
    if not body.accept_terms:
        fail("accept_terms", "Please accept the terms and privacy policy.")
    if cfg.require_phone and not body.phone:
        fail("phone", "Enter your mobile number.")
    await validate_school(db, body, cfg, registering=True)
    extra = await custom_fields.clean(db, "alumni_profile", body.custom_fields, registration=True)
    sec = await settings_store.get_group(db, "security")
    auth_svc.check_password_policy(body.password, sec)
    await enforce(f"register:{body.email.lower()}", 3, 3600, "Please check your inbox — we already sent you an email.")

    general = await settings_store.get_group(db, "general")
    existing = (
        await db.execute(select(User).where(func.lower(User.email) == body.email.lower(), User.deleted_at.is_(None)))
    ).scalar_one_or_none()
    if existing:
        # Same answer as a new registration (no account discovery); the owner is told instead.
        await messaging.queue_email(
            db,
            existing.email,
            "auth.account_exists",
            {"name": existing.full_name, "login": f"{general.app_url}/login", "reset": f"{general.app_url}/forgot-password"},
            existing.language or "en",
        )
        return {"data": {"message": DONE, "email_verification_required": True}}

    role = (await db.execute(select(Role).where(Role.key == svc.UNVERIFIED_ROLE))).scalar_one()
    verify_email = sec.require_email_verification
    user = User(
        full_name=body.full_name,
        email=body.email.lower(),
        phone=body.phone.replace(" ", "") if body.phone else None,
        password_hash=hash_password(body.password),
        status="pending" if verify_email else "active",
        password_changed_at=svc.now(),
        roles=[role],
        language=general.default_language,
    )
    db.add(user)
    await db.flush()
    batch_id = body.batch_id
    if not batch_id and body.graduation_year:
        # A single batch for the year is unambiguous.
        ids = (
            (await db.execute(select(Batch.id).where(Batch.graduation_year == body.graduation_year, Batch.is_active.is_(True))))
            .scalars()
            .all()
        )
        batch_id = ids[0] if len(ids) == 1 else None
    profile = AlumniProfile(
        user_id=user.id,
        kind=body.kind,
        gender=body.gender,
        date_of_birth=body.date_of_birth,
        admission_year=body.admission_year,
        graduation_year=body.graduation_year,
        batch_id=batch_id,
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
        custom_fields=extra,
    )
    db.add(profile)
    await db.flush()
    await svc.refresh_match(db, user, profile)
    await svc.log(db, user.id, "submitted", note="Registered online.")
    from ..community.invitations import mark_joined

    await mark_joined(db, user, body.invite)
    await svc.refresh_search(db, user.id)
    if verify_email:
        from ..auth.router import send_email_verification

        await send_email_verification(db, user)
    else:
        await svc.try_auto_verify(db, user)
    if cfg.new_registration_email:
        await messaging.queue_email(
            db,
            cfg.new_registration_email,
            "admin.new_registration",
            {
                "name": user.full_name,
                "email": user.email,
                "year": body.graduation_year or "—",
                "kind": "Current student" if body.kind == "student" else "Alumnus",
                "match": {"strong": "matches a school record", "partial": "partly matches a school record"}.get(
                    profile.match_strength or "", "no matching school record"
                ),
                "link": f"{general.app_url}/admin/verification",
            },
        )
    await record(
        db, actor_id=user.id, action="register", entity="user", entity_id=user.id, summary=f"Registered {user.email} ({body.kind})", ip=ip
    )
    msg = DONE if verify_email else "Thank you for registering. You can now sign in."
    return {"data": {"message": msg, "email_verification_required": verify_email}}


@router.get("/api/v1/public/batches", tags=["Public"], summary="Active batches (for registration and filters)")
async def public_batches(db: AsyncSession = Depends(get_db)):
    async def load():
        rows = (
            (await db.execute(select(Batch).where(Batch.is_active.is_(True)).order_by(Batch.graduation_year.desc(), Batch.name)))
            .scalars()
            .all()
        )
        return [{"id": str(b.id), "name": b.name, "graduation_year": b.graduation_year} for b in rows]

    cfg = await svc.settings(db)
    return {
        "data": await settings_store.cached("public-batches", load),
        "meta": {
            "registration_open": cfg.registration_open,
            "allow_students": cfg.allow_student_registration,
            "require_phone": cfg.require_phone,
            "require_registration_no": cfg.require_registration_no,
            "require_admission_year": cfg.require_admission_year,
            "founding_year": cfg.founding_year,
            "terms_url": cfg.terms_url,
        },
    }
