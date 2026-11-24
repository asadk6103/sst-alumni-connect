import asyncio
import time

from fastapi import APIRouter, Depends
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import engine, get_db
from ...core.deps import Principal, require
from ...core.metrics import latency_summary
from ...core.redis import redis
from ...models import NotificationLog, User
from ...services import storage

router = APIRouter(tags=["Health"])


@router.get("/api/v1/health/live", summary="Liveness probe")
async def live():
    return {"status": "ok"}


@router.get("/api/v1/health/ready", summary="Readiness probe (database + Redis)")
async def ready(db: AsyncSession = Depends(get_db)):
    await db.execute(text("SELECT 1"))
    await redis().ping()
    return {"status": "ok"}


async def _timed(coro):
    t = time.perf_counter()
    try:
        msg = await coro
        return {"ok": True, "ms": round((time.perf_counter() - t) * 1000, 1), "message": msg}
    except Exception as e:
        return {"ok": False, "ms": round((time.perf_counter() - t) * 1000, 1), "message": f"{type(e).__name__}: {e}"[:300]}


@router.get("/api/v1/admin/health", summary="System health, queue backlog and recent API latency (p50/p95/p99)")
async def health(_: Principal = Depends(require("health.view")), db: AsyncSession = Depends(get_db)):
    async def database():
        v = (await db.execute(text("SHOW server_version"))).scalar_one()
        return f"PostgreSQL {v}"

    async def cache():
        await redis().ping()
        try:
            info = await redis().info("memory")
            return f"Redis OK, memory used {info.get('used_memory_human', '?')}"
        except Exception:
            return "Redis OK"

    async def files():
        return await (await storage.backend(db)).check()

    async def queue():
        r = redis()
        lengths = await asyncio.gather(r.llen("default"), r.llen("notifications"))
        return f"{sum(lengths)} task(s) waiting"

    checks = {"database": await _timed(database()), "redis": await _timed(cache()), "storage": await _timed(files()),
              "queue": await _timed(queue())}
    pool = engine.pool
    stats = {
        "users": (await db.execute(select(func.count()).select_from(User).where(User.deleted_at.is_(None)))).scalar_one(),
        "deliveries_failed_24h": (await db.execute(select(func.count()).select_from(NotificationLog).where(
            NotificationLog.status == "failed", NotificationLog.created_at > func.now() - text("interval '24 hours'")
        ))).scalar_one(),
        "db_pool": {"size": pool.size(), "checked_out": pool.checkedout(), "overflow": pool.overflow()}
        if hasattr(pool, "size") else None,
    }
    return {"data": {"checks": checks, "stats": stats, "latency": latency_summary(),
                     "note": "Latency covers recent requests handled by this API instance."}}
