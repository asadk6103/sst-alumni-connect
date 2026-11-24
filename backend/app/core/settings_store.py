"""Reads UI-managed settings with a short in-process cache (fast hot path for p95 latency).

Writes go to PostgreSQL and bump a Redis version counter, so every API instance drops its cache
within one request after a change (the check piggybacks on an already-cheap Redis GET, at most
once per CACHE_SECONDS).
"""

import time
from typing import TypeVar

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import BrandingSetting, FeatureFlag, ModuleSetting, SystemSetting
from .redis import redis
from .settings_schemas import SETTINGS_GROUPS, Branding

T = TypeVar("T", bound=BaseModel)
CACHE_SECONDS = 5.0
_cache: dict[str, tuple[float, object]] = {}
_version: tuple[float, str | None] = (0.0, None)
VERSION_KEY = "settings:version"


async def _check_version() -> None:
    """Clear the local cache when another instance changed settings."""
    global _version
    now = time.monotonic()
    if now - _version[0] < CACHE_SECONDS:
        return
    try:
        v = await redis().get(VERSION_KEY)
    except Exception:  # Redis down: fall back to time-based expiry only
        v = _version[1]
    if v != _version[1]:
        _cache.clear()
    _version = (now, v)


async def changed() -> None:
    _cache.clear()
    try:
        await redis().incr(VERSION_KEY)
    except Exception:
        pass


async def cached(key: str, loader):
    """Public helper: cache any derived value until settings change (or CACHE_SECONDS pass)."""
    return await _cached(key, loader)


async def _cached(key: str, loader):
    await _check_version()
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1]
    value = await loader()
    _cache[key] = (time.monotonic(), value)
    return value


async def get_group(db: AsyncSession, group: str) -> BaseModel:
    model = SETTINGS_GROUPS[group]

    async def load():
        row = await db.get(SystemSetting, group)
        return model.model_validate(row.value if row else {})

    return await _cached(f"group:{group}", load)


async def save_group(db: AsyncSession, group: str, value: BaseModel, actor) -> None:
    row = await db.get(SystemSetting, group)
    data = value.model_dump(mode="json")
    if row:
        row.value = data
        row.updated_by = actor
    else:
        db.add(SystemSetting(key=group, value=data, updated_by=actor))
    await db.flush()
    await changed()


async def get_raw(db: AsyncSession, key: str) -> dict:
    row = await db.get(SystemSetting, key)
    return dict(row.value) if row else {}


async def set_raw(db: AsyncSession, key: str, value: dict, actor=None) -> None:
    row = await db.get(SystemSetting, key)
    if row:
        row.value = value
    else:
        db.add(SystemSetting(key=key, value=value, updated_by=actor))
    await db.flush()
    await changed()


async def branding(db: AsyncSession, draft: bool = False) -> Branding:
    async def load():
        row = await db.get(BrandingSetting, 1)
        return (dict(row.draft or {}), dict(row.published or {}), row.version) if row else ({}, {}, 0)

    d, p, _ = await _cached("branding", load)
    return Branding.model_validate((d if draft else p) or {})


async def branding_version(db: AsyncSession) -> int:
    async def load():
        row = await db.get(BrandingSetting, 1)
        return (dict(row.draft or {}), dict(row.published or {}), row.version) if row else ({}, {}, 0)

    return (await _cached("branding", load))[2]


async def modules(db: AsyncSession) -> dict[str, bool]:
    async def load():
        rows = (await db.execute(select(ModuleSetting))).scalars().all()
        return {r.key: r.enabled for r in rows}

    return await _cached("modules", load)


async def flags(db: AsyncSession) -> dict[str, tuple[bool, list[str]]]:
    async def load():
        rows = (await db.execute(select(FeatureFlag))).scalars().all()
        return {r.key: (r.enabled, list(r.roles or [])) for r in rows}

    return await _cached("flags", load)


async def is_installed(db: AsyncSession) -> bool:
    async def load():
        row = await db.get(SystemSetting, "installation")
        return bool(row and row.value.get("completed_at"))

    return await _cached("installed", load)
