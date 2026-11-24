from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.deps import Principal, require
from ...models import AuditLog, Role, Session, User

router = APIRouter(prefix="/api/v1/admin/dashboard", tags=["Admin: dashboard"])


@router.get("", summary="Headline figures for the admin dashboard")
async def dashboard(_: Principal = Depends(require("dashboard.view")), db: AsyncSession = Depends(get_db)):
    # Same figures for every viewer: computed at most once per cache window per API process.
    from ...core import settings_store

    return {"data": await settings_store.cached("admin-dashboard", lambda: _figures(db))}


async def _figures(db: AsyncSession) -> dict:
    now = datetime.now(UTC)
    live = User.deleted_at.is_(None)
    by_status = dict((await db.execute(select(User.status, func.count()).where(live).group_by(User.status))).all())
    staff = (await db.execute(select(func.count(func.distinct(User.id))).where(live, User.roles.any(Role.is_staff.is_(True))))).scalar_one()
    count_users = select(func.count()).select_from(User)
    new_30 = (await db.execute(count_users.where(live, User.created_at >= now - timedelta(days=30)))).scalar_one()
    new_prev = (await db.execute(select(func.count()).select_from(User).where(
        live, User.created_at >= now - timedelta(days=60), User.created_at < now - timedelta(days=30)))).scalar_one()
    active_7 = (await db.execute(select(func.count(func.distinct(Session.user_id)))
                                 .where(Session.last_used_at >= now - timedelta(days=7)))).scalar_one()
    signups = (await db.execute(
        select(func.date_trunc("month", User.created_at).label("m"), func.count()).where(live, User.created_at >= now - timedelta(days=365))
        .group_by("m").order_by("m"))).all()
    recent = (await db.execute(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(8))).scalars().all()
    actors = {}
    if ids := {r.actor_id for r in recent if r.actor_id}:
        actors = {u.id: u.full_name for u in (await db.execute(select(User).where(User.id.in_(ids)))).scalars()}
    from ...models import AlumniProfile
    from ..alumni import service as alumni_svc
    from ..alumni.dashboard import community_stats

    recent_regs = (await db.execute(
        select(User.id, User.full_name, AlumniProfile.graduation_year, AlumniProfile.kind, AlumniProfile.verification_status,
               User.created_at).join(AlumniProfile, AlumniProfile.user_id == User.id).where(live)
        .order_by(User.created_at.desc()).limit(6))).all()
    return {
        "alumni": await community_stats(db), "pending_verification": await alumni_svc.pending_count(db),
        "recent_registrations": [{"id": str(i), "full_name": n, "graduation_year": y, "kind": k, "verification_status": s,
                                  "created_at": c} for i, n, y, k, s, c in recent_regs],
        "users_total": sum(by_status.values()), "users_by_status": by_status, "staff": staff,
        "new_last_30_days": new_30, "new_previous_30_days": new_prev, "active_last_7_days": active_7,
        "registrations_by_month": [{"month": m.strftime("%Y-%m"), "count": c} for m, c in signups],
        "recent_activity": [{"id": r.id, "summary": r.summary, "action": r.action, "entity": r.entity,
                             "actor": actors.get(r.actor_id), "created_at": r.created_at} for r in recent],
    }
