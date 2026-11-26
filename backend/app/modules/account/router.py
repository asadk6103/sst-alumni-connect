"""Account settings (redesign phase 6): member settings, deactivation, login activity, security summary, trusted devices."""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.audit import record
from ...core.db import get_db
from ...core.deps import Principal, client_ip, current_user, forget_principals
from ...core.errors import AppError, not_found
from ...core.redis import enforce
from ...core.security import random_token, token_hash, verify_password
from ...models import LoginAttempt, Session, TrustedDevice, User
from ...services import member_settings
from ..auth import service as auth_svc

router = APIRouter(prefix="/api/v1/me", tags=["Account settings"])


def _now() -> datetime:
    return datetime.now(UTC)


@router.get("/settings", summary="Your settings (privacy, connections, preferences, language & region, consents)")
async def get_settings(p: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return {"data": await member_settings.get(db, p.id)}


@router.put("/settings", summary="Change some of your settings")
async def put_settings(body: dict, p: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    ok, bad = member_settings.clean(body)
    if bad:
        raise AppError(
            422, "VALIDATION_ERROR", "Some settings are not valid.", [{"field": k, "message": "Not a valid value."} for k in bad]
        )
    return {"data": await member_settings.save(db, p.id, ok)}


@router.post("/settings/reset", summary="Reset a group of settings to their defaults")
async def reset_settings(keys: list[str], p: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return {"data": await member_settings.save(db, p.id, {k: member_settings.DEFAULTS[k] for k in keys if k in member_settings.DEFAULTS})}


class PasswordIn(BaseModel):
    password: str = Field(..., min_length=1, max_length=200)


@router.post("/deactivate", summary="Deactivate your account (sign in again to reactivate)")
async def deactivate(
    body: PasswordIn, request: Request, response: Response, p: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)
):
    user = await db.get(User, p.id)
    if not verify_password(user.password_hash, body.password):
        raise AppError(400, "WRONG_PASSWORD", "The password is not correct.", [{"field": "password", "message": "Not correct."}])
    if p.is_staff:
        raise AppError(409, "STAFF_ACCOUNT", "Staff accounts are deactivated by a system administrator.")
    user.status = "deactivated"
    await member_settings.save(db, user.id, {"self_deactivated": True})
    await auth_svc.revoke_all(db, user.id)
    forget_principals(user.id)
    auth_svc.clear_refresh_cookie(request, response)
    await record(
        db,
        actor_id=user.id,
        action="deactivate",
        entity="user",
        entity_id=user.id,
        summary="Deactivated their own account",
        ip=client_ip(request),
    )
    return {"data": {"ok": True}}


def _device(ua: str | None) -> dict:
    ua = ua or ""
    low = ua.lower()
    os_ = next(
        (
            n
            for k, n in (
                ("windows", "Windows"),
                ("android", "Android"),
                ("iphone", "iOS"),
                ("ipad", "iPadOS"),
                ("mac os", "macOS"),
                ("linux", "Linux"),
            )
            if k in low
        ),
        "Unknown",
    )
    browser = next(
        (
            n
            for k, n in (
                ("edg/", "Edge"),
                ("chrome/", "Chrome"),
                ("firefox/", "Firefox"),
                ("safari/", "Safari"),
                ("okhttp", "Mobile app"),
                ("expo", "Mobile app"),
            )
            if k in low
        ),
        "Browser",
    )
    kind = "mobile" if any(x in low for x in ("android", "iphone", "mobile")) else "desktop"
    return {"os": os_, "browser": browser, "kind": kind}


@router.get("/login-activity", summary="Recent sign-in attempts on your account")
async def login_activity(limit: int = 20, p: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    user = await db.get(User, p.id)
    rows = (
        (
            await db.execute(
                select(LoginAttempt)
                .where(LoginAttempt.email == user.email.lower())
                .order_by(LoginAttempt.created_at.desc())
                .limit(min(limit, 100))
            )
        )
        .scalars()
        .all()
    )
    current = await db.get(Session, p.session_id) if p.session_id else None
    out, marked = [], False
    for r in rows:
        is_current = bool(r.success and not marked and current and (r.user_agent or "") == (current.user_agent or ""))
        marked = marked or is_current
        out.append(
            {
                "id": r.id,
                **_device(r.user_agent),
                "user_agent": r.user_agent,
                "ip": str(r.ip) if r.ip else None,
                "at": r.created_at,
                "success": r.success,
                "reason": r.reason,
                "current": is_current,
            }
        )
    return {"data": out}


@router.get("/security", summary="Security summary for the Security settings page")
async def security(p: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    user = await db.get(User, p.id)
    prefs = await member_settings.get(db, p.id)
    since = _now() - timedelta(days=30)
    failed = (
        await db.execute(
            select(func.count())
            .select_from(LoginAttempt)
            .where(LoginAttempt.email == user.email.lower(), LoginAttempt.success.is_(False), LoginAttempt.created_at >= since)
        )
    ).scalar_one()
    devices = (
        await db.execute(
            select(func.count()).select_from(TrustedDevice).where(TrustedDevice.user_id == p.id, TrustedDevice.expires_at > _now())
        )
    ).scalar_one()
    sessions = (
        await db.execute(
            select(func.count())
            .select_from(Session)
            .where(Session.user_id == p.id, Session.revoked_at.is_(None), Session.expires_at > _now())
        )
    ).scalar_one()
    checks = {
        "password": bool(user.password_changed_at is None or user.password_changed_at > _now() - timedelta(days=365)),
        "mfa": bool(user.totp_enabled),
        "login_alerts": bool(prefs["login_alerts"]),
        "no_suspicious": failed < 5,
    }
    return {
        "data": {
            "password_changed_at": user.password_changed_at,
            "mfa_enabled": bool(user.totp_enabled),
            "recovery_codes_left": len(user.recovery_codes or []),
            "login_alerts": prefs["login_alerts"],
            "failed_30d": failed,
            "trusted_devices": devices,
            "sessions": sessions,
            "checks": checks,
            "score": round(100 * sum(checks.values()) / len(checks)),
            "checked_at": _now(),
        }
    }


@router.get("/trusted-devices", summary="Browsers that skip the two-factor step")
async def trusted_devices(p: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = (
        (
            await db.execute(
                select(TrustedDevice)
                .where(TrustedDevice.user_id == p.id, TrustedDevice.expires_at > _now())
                .order_by(TrustedDevice.last_used_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return {
        "data": [
            {
                "id": str(d.id),
                **_device(d.user_agent),
                "ip": d.ip,
                "created_at": d.created_at,
                "last_used_at": d.last_used_at,
                "expires_at": d.expires_at,
            }
            for d in rows
        ]
    }


@router.delete("/trusted-devices/{device_id}", summary="Stop trusting a browser")
async def forget_device(device_id: uuid.UUID, p: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    d = await db.get(TrustedDevice, device_id)
    if not d or d.user_id != p.id:
        raise not_found("Device")
    await db.delete(d)
    return {"data": {"ok": True}}


@router.delete("/trusted-devices", summary="Stop trusting every browser")
async def forget_all_devices(p: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(TrustedDevice).where(TrustedDevice.user_id == p.id))
    return {"data": {"ok": True}}


@router.post("/recovery-codes", summary="Create new two-factor recovery codes (old ones stop working)")
async def new_recovery_codes(body: PasswordIn, request: Request, p: Principal = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await enforce(f"recovery-codes:{p.id}", 5, 3600)
    user = await db.get(User, p.id)
    if not user.totp_enabled:
        raise AppError(409, "MFA_OFF", "Turn on two-factor authentication first.")
    if not verify_password(user.password_hash, body.password):
        raise AppError(400, "WRONG_PASSWORD", "The password is not correct.", [{"field": "password", "message": "Not correct."}])
    codes = [random_token(6).upper().replace("-", "X").replace("_", "Y")[:10] for _ in range(8)]
    user.recovery_codes = [token_hash(c) for c in codes]
    await record(
        db,
        actor_id=p.id,
        action="recovery_codes",
        entity="user",
        entity_id=p.id,
        summary="Created new recovery codes",
        ip=client_ip(request),
    )
    return {"data": {"codes": codes}}
