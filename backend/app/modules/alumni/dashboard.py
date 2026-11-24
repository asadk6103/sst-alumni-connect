"""Personalised alumni dashboard: configured widgets with their data in one request."""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import and_, case, func, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.db import get_db
from ...core.deps import Principal, require
from ...core.settings_schemas import DASHBOARD_WIDGETS, DashboardSettings
from ...models import AlumniConnection, AlumniProfile, User
from . import service as svc

router = APIRouter(prefix="/api/v1/alumni", tags=["Alumni portal"])


async def community_stats(db: AsyncSession) -> dict:
    """Aggregate figures (no individual data); shared by every viewer and cached."""

    async def load():
        live = and_(User.deleted_at.is_(None), User.status == "active")
        base = select(AlumniProfile).join(User, User.id == AlumniProfile.user_id).where(live).subquery()
        alumni = base.c.kind == "alumni"
        totals = (await db.execute(select(
            func.count().filter(alumni), func.count().filter(alumni, base.c.verification_status == "verified"),
            func.count().filter(base.c.kind == "student"),
            func.count(func.distinct(base.c.country)).filter(alumni),
            func.count(func.distinct(base.c.batch_id)).filter(alumni),
            func.count().filter(alumni, base.c.created_at >= datetime.now(UTC) - timedelta(days=30)),
        ).select_from(base))).one()
        by_country = (await db.execute(select(base.c.country, func.count()).where(alumni, base.c.country.is_not(None))
                                       .group_by(base.c.country).order_by(func.count().desc(), base.c.country).limit(10))).all()
        by_year = (await db.execute(select(base.c.graduation_year, func.count()).where(alumni, base.c.graduation_year.is_not(None))
                                    .group_by(base.c.graduation_year).order_by(base.c.graduation_year.desc()).limit(20))).all()
        return {
            "registered_alumni": totals[0], "verified_alumni": totals[1], "students": totals[2], "countries": totals[3],
            "batches": totals[4], "new_last_30_days": totals[5],
            "by_country": [{"country": c, "count": n} for c, n in by_country],
            "by_year": [{"year": y, "count": n} for y, n in sorted(by_year)],
        }

    return await settings_store.cached("alumni-community-stats", load)


async def suggestions(db: AsyncSession, me: Principal, profile: AlumniProfile, limit: int = 6) -> list[dict]:
    C = AlumniConnection
    linked = select(case((C.requester_id == me.id, C.addressee_id), else_=C.requester_id)).where(
        or_(C.requester_id == me.id, C.addressee_id == me.id))
    career_pub = func.coalesce(AlumniProfile.privacy["career"].astext, "members") == "members"
    loc_pub = func.coalesce(AlumniProfile.privacy["location"].astext, "members") == "members"

    def same(col, value, public=None, weight=1):
        if value is None:
            return literal(0)
        cond = func.lower(col) == value.lower() if isinstance(value, str) else col == value
        return case((and_(cond, public) if public is not None else cond, weight), else_=0)

    score = (same(AlumniProfile.batch_id, profile.batch_id, weight=4)
             + same(AlumniProfile.graduation_year, profile.graduation_year, weight=3)
             + same(AlumniProfile.city, profile.city, loc_pub, 2)
             + same(AlumniProfile.industry, profile.industry, career_pub, 2)
             + same(AlumniProfile.organization, profile.organization, career_pub, 2))
    rows = (await db.execute(
        select(User, AlumniProfile).join(AlumniProfile, AlumniProfile.user_id == User.id)
        .where(*await svc.directory_visible_clause(db), AlumniProfile.visibility == "members",
               User.id != me.id, User.id.not_in(linked))
        .order_by(score.desc(), AlumniProfile.completion.desc(), User.id).limit(limit))).all()
    viewer = svc.Viewer(me)
    names = await svc.batch_names(db, {pr.batch_id for _, pr in rows})
    out = []
    for u, pr in rows:
        reason = ("Same batch" if profile.batch_id and pr.batch_id == profile.batch_id
                  else f"Class of {pr.graduation_year}" if profile.graduation_year and pr.graduation_year == profile.graduation_year
                  else f"Also in {pr.city}"
                  if profile.city and pr.city and pr.city.lower() == profile.city.lower() and viewer.sees(pr, "location")
                  else f"Works in {pr.industry}" if profile.industry and pr.industry == profile.industry and viewer.sees(pr, "career")
                  else None)
        out.append({**svc.card(u, pr, viewer, names.get(pr.batch_id), await svc.photo_out(db, pr.photo_id),
                               {"connection": None, "connection_id": None, "following": False}), "reason": reason})
    return out


@router.get("/dashboard", summary="Your dashboard (widgets chosen by the administrators)")
async def dashboard(me: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    user = await db.get(User, me.id)
    profile = await svc.ensure_profile(db, user)
    cfg: DashboardSettings = await settings_store.get_group(db, "dashboard")  # type: ignore[assignment]
    mods = await settings_store.modules(db)
    can_dir = mods.get("directory", True) and me.can("portal.directory")
    roles = set(me.roles)
    widgets = []
    for w in cfg.widgets:
        if not w.enabled or (w.roles and not roles.intersection(w.roles)):
            continue
        if w.key == "verification" and profile.verification_status == "verified":
            continue
        if w.key in ("suggestions", "connection_requests") and not can_dir:
            continue
        widgets.append(w.key)
    data: dict = {"widgets": [{"key": k, "title": DASHBOARD_WIDGETS[k][0]} for k in widgets]}
    score, missing = await svc.completion(db, user, profile)
    sec = await settings_store.get_group(db, "security")
    names = await svc.batch_names(db, {profile.batch_id})
    data["me"] = {
        "full_name": user.full_name, "kind": profile.kind, "graduation_year": profile.graduation_year,
        "batch": names.get(profile.batch_id), "photo": await svc.photo_out(db, profile.photo_id),
        "verification_status": profile.verification_status, "rejection_reason": profile.rejection_reason,
        "completion": score, "next_steps": missing[:4],
        "phone_verified": bool(user.phone_verified_at), "phone_verification_required": sec.require_phone_verification,
    }
    if {"stats", "by_country", "by_year"} & set(widgets):
        data["stats"] = await community_stats(db)
    if "connection_requests" in widgets:
        C = AlumniConnection
        rows = (await db.execute(select(User, AlumniProfile, C).join(C, C.requester_id == User.id)
                                 .join(AlumniProfile, AlumniProfile.user_id == User.id)
                                 .where(C.addressee_id == me.id, C.status == "pending", User.deleted_at.is_(None))
                                 .order_by(C.created_at.desc()).limit(5))).all()
        total = (await db.execute(select(func.count()).select_from(C).where(C.addressee_id == me.id, C.status == "pending"))).scalar_one()
        viewer = svc.Viewer(me)
        bn = await svc.batch_names(db, {pr.batch_id for _, pr, _ in rows})
        data["requests"] = {"total": total, "items": [
            {**svc.card(u, pr, viewer, bn.get(pr.batch_id), await svc.photo_out(db, pr.photo_id), None),
             "request_id": str(c.id), "message": c.message, "since": c.created_at} for u, pr, c in rows]}
    if "suggestions" in widgets:
        data["suggestions"] = await suggestions(db, me, profile)
    return {"data": data}


