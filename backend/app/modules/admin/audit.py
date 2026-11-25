from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.audit import record
from ...core.db import get_db
from ...core.deps import Principal, require
from ...core.pagination import PageParams, csv_response, page_params, paginate
from ...models import AuditLog, User

router = APIRouter(prefix="/api/v1/admin/audit-logs", tags=["Admin: audit logs"])


def _query(q, action, entity, actor, date_from, date_to):
    stmt = select(AuditLog)
    if q:
        stmt = stmt.where(AuditLog.summary.ilike(f"%{q}%"))
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if entity:
        stmt = stmt.where(AuditLog.entity == entity)
    if actor:
        stmt = stmt.join(User, User.id == AuditLog.actor_id).where(or_(User.email.ilike(f"%{actor}%"), User.full_name.ilike(f"%{actor}%")))
    if date_from:
        stmt = stmt.where(AuditLog.created_at >= datetime.combine(date_from, time.min))
    if date_to:
        stmt = stmt.where(AuditLog.created_at < datetime.combine(date_to + timedelta(days=1), time.min))
    return stmt.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())


async def _actors(db: AsyncSession, rows) -> dict:
    ids = {r.actor_id for r in rows if r.actor_id}
    if not ids:
        return {}
    users = (await db.execute(select(User.id, User.full_name, User.email).where(User.id.in_(ids)))).all()
    return {u.id: {"name": u.full_name, "email": u.email} for u in users}


@router.get("", summary="Search the audit log")
async def list_logs(
    q: str | None = Query(None, max_length=100),
    action: str | None = None,
    entity: str | None = None,
    actor: str | None = Query(None, max_length=100),
    date_from: date | None = None,
    date_to: date | None = None,
    p: PageParams = Depends(page_params),
    _: Principal = Depends(require("audit.view")),
    db: AsyncSession = Depends(get_db),
):
    rows, meta = await paginate(db, _query(q, action, entity, actor, date_from, date_to), p)
    actors = await _actors(db, rows)
    return {
        "data": [
            {
                "id": r.id,
                "action": r.action,
                "entity": r.entity,
                "entity_id": r.entity_id,
                "summary": r.summary,
                "data": r.data,
                "ip": str(r.ip) if r.ip else None,
                "created_at": r.created_at,
                "actor": actors.get(r.actor_id),
            }
            for r in rows
        ],
        "meta": meta,
    }


@router.get("/export", summary="Export the audit log as CSV")
async def export_logs(
    q: str | None = None,
    action: str | None = None,
    entity: str | None = None,
    actor: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    me: Principal = Depends(require("audit.export")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(_query(q, action, entity, actor, date_from, date_to).limit(50000))).scalars().all()
    actors = await _actors(db, rows)
    await record(db, actor_id=me.id, action="export", entity="audit_log", summary=f"Exported {len(rows)} audit entries")
    await db.commit()
    return csv_response(
        "audit-log.csv",
        ["Time (UTC)", "Actor", "Action", "Entity", "Entity ID", "Summary", "IP"],
        (
            [
                r.created_at.isoformat(),
                (actors.get(r.actor_id) or {}).get("email", "system"),
                r.action,
                r.entity,
                r.entity_id or "",
                r.summary,
                str(r.ip) if r.ip else "",
            ]
            for r in rows
        ),
    )
