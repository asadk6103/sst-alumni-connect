from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AuditLog


async def record(db: AsyncSession, *, actor_id, action: str, entity: str, summary: str,
                 entity_id=None, data: dict | None = None, ip: str | None = None) -> None:
    db.add(AuditLog(actor_id=actor_id, action=action, entity=entity, entity_id=str(entity_id) if entity_id else None,
                    summary=summary[:300], data=data, ip=ip))
