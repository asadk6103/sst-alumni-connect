import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.audit import record
from ...core.db import get_db
from ...core.deps import Principal, client_ip, current_user, forget_principals
from ...core.errors import AppError, not_found
from ...core.redis import enforce
from ...core.security import (
    code_hash,
    decrypt,
    encrypt,
    hash_password,
    needs_rehash,
    new_totp_secret,
    random_code,
    random_token,
    token_hash,
    totp_uri,
    verify_password,
    verify_totp,
)
from ...core.settings_schemas import GeneralSettings, SecuritySettings
from ...models import Session, User
from ...services import integrations, messaging
from . import service as svc

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=256)
    remember: bool = True  # false: the sign-in ends when the browser is closed


class MfaLoginIn(BaseModel):
    challenge: str = Field(..., min_length=10, max_length=200)
    code: str = Field(..., min_length=6, max_length=20)


class EmailIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    token: str = Field(..., min_length=10, max_length=200)
    password: str = Field(..., min_length=1, max_length=256)


class ChangePasswordIn(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=256)
    new_password: str = Field(..., min_length=1, max_length=256)


class TokenIn(BaseModel):
    token: str = Field(..., min_length=10, max_length=200)


class CodeIn(BaseModel):
    code: str = Field(..., min_length=6, max_length=20)


class PasswordCodeIn(BaseModel):
    password: str = Field(..., min_length=1, max_length=256)
    code: str = Field(..., min_length=6, max_length=20)


class PhoneIn(BaseModel):
    phone: str | None = Field(None, pattern=r"^\+?[0-9 ()\-]{7,20}$")


async def _sec(db) -> SecuritySettings:
    return await settings_store.get_group(db, "security")  # type: ignore[return-value]


async def _general(db) -> GeneralSettings:
    return await settings_store.get_group(db, "general")  # type: ignore[return-value]


async def user_payload(db: AsyncSession, user: User) -> dict:
    sec = await _sec(db)
    from ...models import Permission, role_permissions

    role_ids = [r.id for r in user.roles]
    perms = (
        sorted(
            (
                await db.execute(
                    select(Permission.key)
                    .join(role_permissions, role_permissions.c.permission_id == Permission.id)
                    .where(role_permissions.c.role_id.in_(role_ids))
                    .distinct()
                )
            )
            .scalars()
            .all()
        )
        if role_ids
        else []
    )
    is_staff = any(r.is_staff for r in user.roles)
    mfa_required = sec.mfa_policy == "required_all" or (sec.mfa_policy == "required_staff" and is_staff)
    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "phone": user.phone,
        "status": user.status,
        "language": user.language,
        "email_verified": bool(user.email_verified_at),
        "phone_verified": bool(user.phone_verified_at),
        "roles": [{"key": r.key, "name": r.name} for r in user.roles],
        "permissions": perms,
        "is_staff": is_staff,
        "mfa_enabled": user.totp_enabled,
        "mfa_setup_required": mfa_required and not user.totp_enabled,
        "password_expired": svc.password_expired(user, sec),
    }


async def _find_user(db: AsyncSession, email: str) -> User | None:
    return (await db.execute(select(User).where(func.lower(User.email) == email.lower(), User.deleted_at.is_(None)))).scalar_one_or_none()


async def _login_alert(db: AsyncSession, request: Request, user: User) -> None:
    sec = await _sec(db)
    if not sec.login_notifications:
        return
    ua = (request.headers.get("user-agent") or "")[:300]
    known = (
        await db.execute(select(func.count()).select_from(Session).where(Session.user_id == user.id, Session.user_agent == ua))
    ).scalar_one()
    if known == 0 and user.last_login_at is not None:
        await messaging.queue_email(
            db,
            user.email,
            "auth.login_alert",
            {
                "name": user.full_name,
                "device": ua or "Unknown device",
                "ip": client_ip(request) or "unknown",
                "time": svc.now().strftime("%d %b %Y %H:%M UTC"),
            },
            user.language or "en",
        )


@router.post("/login", summary="Sign in with email and password")
async def login(body: LoginIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    await svc.guard_login(db, request, body.email)
    user = await _find_user(db, body.email)
    ok = verify_password(user.password_hash if user else None, body.password)
    if user and user.locked_until and user.locked_until > svc.now():
        await svc.record_attempt(db, request, body.email, False, "locked", user)
        await db.commit()
        minutes = max(1, int((user.locked_until - svc.now()).total_seconds() // 60) + 1)
        raise AppError(423, "ACCOUNT_LOCKED", f"Too many failed attempts. Try again in {minutes} minute(s).")
    if not user or not ok:
        await svc.record_attempt(db, request, body.email, False, "bad_credentials", user)
        await db.commit()  # keep the attempt and any lockout despite the error response
        raise AppError(401, "INVALID_CREDENTIALS", "The email or password is incorrect.")
    if user.status == "deactivated":
        await svc.record_attempt(db, request, body.email, False, "deactivated", user)
        await db.commit()
        raise AppError(403, "ACCOUNT_DEACTIVATED", "This account has been deactivated. Please contact the alumni office.")
    sec = await _sec(db)
    if user.status == "pending" and sec.require_email_verification and not user.email_verified_at:
        await svc.record_attempt(db, request, body.email, False, "unverified", user)
        await db.commit()
        raise AppError(403, "EMAIL_NOT_VERIFIED", "Please verify your email address first. Check your inbox for the link.")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    if user.totp_enabled:
        challenge = random_token(32)
        await svc.create_verification(
            db, user, "mfa_challenge", token_hash(challenge), timedelta(minutes=5), data={"remember": body.remember}
        )
        return {"data": {"mfa_required": True, "challenge": challenge}}
    if user.status == "pending":
        user.status = "active"
    await svc.record_attempt(db, request, body.email, True, None, user)
    await _login_alert(db, request, user)
    tokens = await svc.issue_session(db, request, response, user, remember=body.remember)
    return {"data": {**tokens, "user": await user_payload(db, user)}}


@router.post("/login/mfa", summary="Complete sign-in with a two-factor code")
async def login_mfa(body: MfaLoginIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    await enforce(f"mfa:{client_ip(request)}", 20, 300)
    from ...models import UserVerification

    v = (
        await db.execute(
            select(UserVerification).where(
                UserVerification.kind == "mfa_challenge", UserVerification.secret_hash == token_hash(body.challenge)
            )
        )
    ).scalar_one_or_none()
    if not v or v.consumed_at or v.expires_at <= svc.now() or v.attempts >= 5:
        raise AppError(400, "INVALID_CHALLENGE", "Your sign-in attempt expired. Please sign in again.")
    user = await db.get(User, v.user_id)
    secret = decrypt(user.totp_secret_enc) if user else None
    code = body.code.replace(" ", "").replace("-", "")
    ok = bool(secret and verify_totp(secret, code))
    if not ok and user and user.recovery_codes:
        h = token_hash(code.upper())
        if h in user.recovery_codes:
            user.recovery_codes = [c for c in user.recovery_codes if c != h]
            ok = True
    if not ok:
        v.attempts += 1
        await db.commit()
        raise AppError(401, "INVALID_CODE", "The code is not correct.")
    v.consumed_at = svc.now()
    if user.status == "pending":
        user.status = "active"
    await svc.record_attempt(db, request, user.email, True, "mfa", user)
    await _login_alert(db, request, user)
    tokens = await svc.issue_session(db, request, response, user, remember=(v.data or {}).get("remember", True))
    return {"data": {**tokens, "user": await user_payload(db, user)}}


@router.post("/refresh", summary="Exchange the refresh cookie for a new access token")
async def refresh(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    await svc.check_origin(request, db)
    if not svc.presented_refresh(request):
        return {"data": None}  # no session on this browser (anonymous visitor): not an error
    return {"data": await svc.rotate_session(db, request, response)}


@router.post("/logout", summary="Sign out of this device")
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    await svc.check_origin(request, db)
    token = svc.presented_refresh(request)
    if token:
        s = (await db.execute(select(Session).where(Session.refresh_hash == token_hash(token)))).scalar_one_or_none()
        if s and not s.revoked_at:
            s.revoked_at = svc.now()
            forget_principals(s.user_id)
    svc.clear_refresh_cookie(request, response)
    return {"data": {"ok": True}}


@router.post("/logout-all", summary="Sign out of every device")
async def logout_all(request: Request, response: Response, p: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    n = await svc.revoke_all(db, p.id)
    svc.clear_refresh_cookie(request, response)
    await record(
        db,
        actor_id=p.id,
        action="logout_all",
        entity="user",
        entity_id=p.id,
        summary=f"Signed out of {n} session(s)",
        ip=client_ip(request),
    )
    return {"data": {"sessions_ended": n}}


@router.get("/me", summary="Current user, roles and permissions")
async def me(p: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    user = await db.get(User, p.id)
    return {"data": await user_payload(db, user)}


@router.get("/sessions", summary="Active sessions of the current user")
async def sessions(p: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = (
        (
            await db.execute(
                select(Session)
                .where(Session.user_id == p.id, Session.revoked_at.is_(None), Session.expires_at > svc.now())
                .order_by(Session.last_used_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return {
        "data": [
            {
                "id": str(s.id),
                "user_agent": s.user_agent,
                "ip": str(s.ip) if s.ip else None,
                "created_at": s.created_at,
                "last_used_at": s.last_used_at,
                "current": s.id == p.session_id,
            }
            for s in rows
        ]
    }


@router.delete("/sessions/{session_id}", summary="End one session")
async def end_session(session_id: uuid.UUID, p: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    s = await db.get(Session, session_id)
    if not s or s.user_id != p.id:
        raise not_found("Session")
    s.revoked_at = svc.now()
    forget_principals(p.id)
    return {"data": {"ok": True}}


# ── passwords ────────────────────────────────────────────────────────────────
@router.post("/password/forgot", status_code=202, summary="Email a password-reset link")
async def forgot(body: EmailIn, request: Request, db: AsyncSession = Depends(get_db)):
    await enforce(f"forgot-ip:{client_ip(request)}", 10, 3600)
    await enforce(f"forgot:{body.email.lower()}", 3, 3600)
    user = await _find_user(db, body.email)
    if user and user.status != "deactivated":
        token = random_token(32)
        await svc.create_verification(db, user, "password_reset", token_hash(token), timedelta(minutes=60))
        general = await _general(db)
        await messaging.queue_email(
            db,
            user.email,
            "auth.password_reset",
            {"name": user.full_name, "link": f"{general.app_url}/reset-password?token={token}", "minutes": 60},
            user.language or "en",
        )
    # Same answer whether or not the account exists.
    return {"data": {"message": "If an account exists for that email, a reset link is on its way."}}


@router.post("/password/reset", summary="Set a new password using a reset link")
async def reset(body: ResetIn, request: Request, db: AsyncSession = Depends(get_db)):
    await enforce(f"reset-ip:{client_ip(request)}", 20, 3600)
    sec = await _sec(db)
    svc.check_password_policy(body.password, sec)
    v = await svc.consume_token(db, "password_reset", body.token)
    user = await db.get(User, v.user_id)
    user.password_hash = hash_password(body.password)
    user.password_changed_at = svc.now()
    user.locked_until = None
    if not user.email_verified_at:  # the reset link proves control of the mailbox
        user.email_verified_at = svc.now()
        if user.status == "pending":
            user.status = "active"
    await svc.revoke_all(db, user.id)
    await _alumni_contact_proven(db, user)
    await messaging.queue_email(db, user.email, "auth.password_changed", {"name": user.full_name}, user.language or "en")
    await record(
        db,
        actor_id=user.id,
        action="password_reset",
        entity="user",
        entity_id=user.id,
        summary="Password reset via email link",
        ip=client_ip(request),
    )
    return {"data": {"ok": True}}


@router.post("/password/change", summary="Change password (signs out other devices)")
async def change_password(
    body: ChangePasswordIn, request: Request, p: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)
):
    user = await db.get(User, p.id)
    if not verify_password(user.password_hash, body.current_password):
        raise AppError(
            400, "INVALID_PASSWORD", "Your current password is not correct.", [{"field": "current_password", "message": "Not correct."}]
        )
    if verify_password(user.password_hash, body.new_password):
        raise AppError(
            422,
            "SAME_PASSWORD",
            "Choose a password different from your current one.",
            [{"field": "new_password", "message": "Must differ from the current password."}],
        )
    svc.check_password_policy(body.new_password, await _sec(db))
    user.password_hash = hash_password(body.new_password)
    user.password_changed_at = svc.now()
    await svc.revoke_all(db, user.id, except_session=p.session_id)
    await messaging.queue_email(db, user.email, "auth.password_changed", {"name": user.full_name}, user.language or "en")
    await record(
        db, actor_id=p.id, action="password_change", entity="user", entity_id=p.id, summary="Password changed", ip=client_ip(request)
    )
    return {"data": {"ok": True}}


# ── email verification ──────────────────────────────────────────────────────
async def send_email_verification(db: AsyncSession, user: User) -> None:
    token = random_token(32)
    await svc.create_verification(db, user, "email", token_hash(token), timedelta(hours=48))
    general = await _general(db)
    await messaging.queue_email(
        db,
        user.email,
        "auth.verify_email",
        {"name": user.full_name, "link": f"{general.app_url}/verify-email?token={token}", "hours": 48},
        user.language or "en",
    )


@router.post("/email/verify", summary="Confirm an email address")
async def verify_email(body: TokenIn, request: Request, db: AsyncSession = Depends(get_db)):
    await enforce(f"verify-ip:{client_ip(request)}", 30, 3600)
    v = await svc.consume_token(db, "email", body.token)
    user = await db.get(User, v.user_id)
    user.email_verified_at = svc.now()
    if user.status == "pending":
        user.status = "active"
    forget_principals(user.id)
    await _alumni_contact_proven(db, user)
    return {"data": {"ok": True}}


@router.post("/email/resend", status_code=202, summary="Resend the verification email")
async def resend_verification(body: EmailIn, request: Request, db: AsyncSession = Depends(get_db)):
    await enforce(f"resend-ip:{client_ip(request)}", 10, 3600)
    await enforce(f"resend:{body.email.lower()}", 3, 3600)
    user = await _find_user(db, body.email)
    if user and not user.email_verified_at and user.status != "deactivated":
        await send_email_verification(db, user)
    return {"data": {"message": "If the address needs verifying, a new link is on its way."}}


# ── mobile verification ─────────────────────────────────────────────────────
@router.post("/phone/send-code", summary="Send a mobile verification code by SMS")
async def phone_send(body: PhoneIn, p: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    sms = await integrations.load(db, "sms")
    if not sms or not sms.enabled:
        raise AppError(409, "SMS_NOT_CONFIGURED", "Mobile verification is not available yet.")
    await enforce(f"otp:{p.id}", 3, 900, "Please wait before requesting another code.")
    user = await db.get(User, p.id)
    if body.phone:
        user.phone = body.phone.replace(" ", "")
        user.phone_verified_at = None
    if not user.phone:
        raise AppError(422, "PHONE_REQUIRED", "Add a mobile number first.", [{"field": "phone", "message": "Required."}])
    code = random_code(6)
    await svc.create_verification(db, user, "phone", code_hash(user.id, code), timedelta(minutes=10), {"phone": user.phone})
    await messaging.queue_sms(db, user.phone, "auth.phone_otp", {"code": code, "minutes": 10}, user.language or "en")
    return {"data": {"sent_to": "•" * max(0, len(user.phone) - 4) + user.phone[-4:]}}


@router.post("/phone/verify", summary="Confirm the mobile number with the SMS code")
async def phone_verify(body: CodeIn, p: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    from ...models import UserVerification

    v = (
        (
            await db.execute(
                select(UserVerification)
                .where(UserVerification.user_id == p.id, UserVerification.kind == "phone", UserVerification.consumed_at.is_(None))
                .order_by(UserVerification.created_at.desc())
            )
        )
        .scalars()
        .first()
    )
    if not v or v.expires_at <= svc.now() or v.attempts >= 5:
        raise AppError(400, "INVALID_CODE", "The code has expired. Please request a new one.")
    if v.secret_hash != code_hash(p.id, body.code.strip()):
        v.attempts += 1
        await db.commit()
        raise AppError(400, "INVALID_CODE", "The code is not correct.")
    v.consumed_at = svc.now()
    user = await db.get(User, p.id)
    if user.phone == (v.data or {}).get("phone"):
        user.phone_verified_at = svc.now()
        await _alumni_contact_proven(db, user)
    return {"data": {"ok": True}}


# ── two-factor authentication ───────────────────────────────────────────────
@router.post("/mfa/setup", summary="Start two-factor setup (returns the authenticator secret)")
async def mfa_setup(p: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    user = await db.get(User, p.id)
    if user.totp_enabled:
        raise AppError(409, "MFA_ALREADY_ENABLED", "Two-factor authentication is already on.")
    secret = new_totp_secret()
    user.totp_secret_enc = encrypt(secret)
    general = await _general(db)
    return {"data": {"secret": secret, "otpauth_uri": totp_uri(secret, user.email, general.app_name)}}


@router.post("/mfa/enable", summary="Confirm two-factor setup with a code; returns recovery codes")
async def mfa_enable(body: CodeIn, request: Request, p: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    user = await db.get(User, p.id)
    secret = decrypt(user.totp_secret_enc)
    if not secret or not verify_totp(secret, body.code):
        raise AppError(400, "INVALID_CODE", "The code is not correct. Check your authenticator app's clock.")
    codes = [random_token(6).upper().replace("-", "X").replace("_", "Y")[:10] for _ in range(8)]
    user.recovery_codes = [token_hash(c) for c in codes]
    user.totp_enabled = True
    forget_principals(p.id)
    await record(
        db,
        actor_id=p.id,
        action="mfa_enable",
        entity="user",
        entity_id=p.id,
        summary="Two-factor authentication enabled",
        ip=client_ip(request),
    )
    return {"data": {"recovery_codes": codes}}


@router.post("/mfa/disable", summary="Turn off two-factor authentication")
async def mfa_disable(body: PasswordCodeIn, request: Request, p: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    user = await db.get(User, p.id)
    sec = await _sec(db)
    is_staff = any(r.is_staff for r in user.roles)
    if sec.mfa_policy == "required_all" or (sec.mfa_policy == "required_staff" and is_staff):
        raise AppError(403, "MFA_REQUIRED", "Two-factor authentication is required for your account.")
    secret = decrypt(user.totp_secret_enc)
    if not verify_password(user.password_hash, body.password) or not secret or not verify_totp(secret, body.code):
        raise AppError(400, "INVALID_CODE", "Password or code is not correct.")
    user.totp_enabled, user.totp_secret_enc, user.recovery_codes = False, None, None
    forget_principals(p.id)
    await record(
        db,
        actor_id=p.id,
        action="mfa_disable",
        entity="user",
        entity_id=p.id,
        summary="Two-factor authentication disabled",
        ip=client_ip(request),
    )
    return {"data": {"ok": True}}


class ProfileIn(BaseModel):
    full_name: str | None = Field(None, min_length=2, max_length=150)
    phone: str | None = Field(None, pattern=r"^\+?[0-9 ()\-]{7,20}$")
    language: str | None = Field(None, pattern=r"^[a-z]{2}(-[A-Z]{2})?$")


@router.patch("/me", summary="Update your own name, mobile number or language")
async def update_me(body: ProfileIn, p: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    user = await db.get(User, p.id)
    if body.full_name is not None:
        user.full_name = body.full_name.strip()
    if body.phone is not None and body.phone.replace(" ", "") != (user.phone or ""):
        user.phone, user.phone_verified_at = body.phone.replace(" ", ""), None
    if body.language is not None:
        user.language = body.language
    forget_principals(p.id)
    return {"data": await user_payload(db, user)}


async def _alumni_contact_proven(db: AsyncSession, user: User) -> None:
    """A proven email/mobile may complete verification against an imported school record."""
    from ..alumni import service as alumni

    await alumni.try_auto_verify(db, user)
