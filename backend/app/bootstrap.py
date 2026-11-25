"""Idempotent start-up synchronisation (run after migrations: `python -m app.bootstrap`).

- permissions catalogue; default roles (new default grants are added, admin removals are kept)
- module settings, feature flags, built-in message templates, branding row
Safe to run concurrently from several API replicas (PostgreSQL advisory lock).
"""

import asyncio
import logging

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .core import secrets
from .core.db import SessionLocal, engine
from .core.permissions import DEFAULT_ROLES, all_permissions
from .core.settings_schemas import DEFAULT_MODULES, Branding
from .models import BrandingSetting, FeatureFlag, MessageTemplate, ModuleSetting, Permission, Role, SystemSetting
from .services.templates import DEFAULT_TEMPLATES

log = logging.getLogger("app.bootstrap")
LOCK_ID = 7_312_004  # arbitrary, stable

DEFAULT_FLAGS = [
    ("realtime_feed", "Live community feed", "Push new posts and reactions to open feeds in real time.", True),
    ("read_receipts", "Message read receipts", "Show when messages have been read.", True),
    ("alumni_of_month", "Alumni of the month", "Feature one alumnus each month on the dashboard.", False),
    ("beta_dark_mode", "Dark mode (beta)", "Let members switch the portal to dark mode.", False),
]


async def sync(db: AsyncSession) -> dict:
    stats = {"permissions_added": 0, "roles_added": 0, "grants_added": 0}
    # permissions
    existing = {p.key: p for p in (await db.execute(select(Permission))).scalars()}
    for key, module, action, desc in all_permissions():
        if key not in existing:
            p = Permission(key=key, module=module, action=action, description=desc)
            db.add(p)
            existing[key] = p
            stats["permissions_added"] += 1
        else:
            existing[key].description = desc
    await db.flush()

    # roles: remember which default grants were already applied, so admin removals stick
    applied_row = await db.get(SystemSetting, "_rbac_applied")
    applied: dict[str, list[str]] = dict(applied_row.value) if applied_row else {}
    roles = {r.key: r for r in (await db.execute(select(Role).options(selectinload(Role.permissions)))).scalars()}
    for key, (name, desc, is_staff, perms) in DEFAULT_ROLES.items():
        role = roles.get(key)
        if not role:
            role = Role(key=key, name=name, description=desc, is_system=True, is_staff=is_staff, permissions=[])
            db.add(role)
            stats["roles_added"] += 1
        role.is_system, role.is_staff = True, is_staff
        have = {p.key for p in role.permissions}
        new_defaults = set(perms) - set(applied.get(key, []))
        for pk in sorted(new_defaults - have):
            role.permissions.append(existing[pk])
            stats["grants_added"] += 1
        applied[key] = sorted(set(applied.get(key, [])) | set(perms))
    if applied_row:
        applied_row.value = applied
    else:
        db.add(SystemSetting(key="_rbac_applied", value=applied))

    # modules
    have_mods = {m.key for m in (await db.execute(select(ModuleSetting))).scalars()}
    for key in DEFAULT_MODULES:
        if key not in have_mods:
            db.add(ModuleSetting(key=key, enabled=True, config={}))

    # feature flags
    have_flags = {f.key for f in (await db.execute(select(FeatureFlag))).scalars()}
    for key, name, desc, enabled in DEFAULT_FLAGS:
        if key not in have_flags:
            db.add(FeatureFlag(key=key, name=name, description=desc, enabled=enabled, roles=[]))

    # message templates (only missing ones; admin edits are kept)
    have_tpl = {(t.key, t.channel, t.language) for t in (await db.execute(select(MessageTemplate))).scalars()}
    for key, channel, name, subject, body, ph in DEFAULT_TEMPLATES:
        if (key, channel, "en") not in have_tpl:
            db.add(MessageTemplate(key=key, channel=channel, language="en", name=name, subject=subject, body=body, placeholders=ph))

    # job categories (first start only; admins manage them afterwards)
    from .models import JobCategory
    from .modules.jobs.router import DEFAULT_CATEGORIES

    if not (await db.execute(select(JobCategory.id).limit(1))).first():
        for i, name in enumerate(DEFAULT_CATEGORIES):
            db.add(JobCategory(name=name, position=i))

    # languages (English and Urdu) and a starter About page for the website (first start only)
    from .models import CmsPage
    from .modules.administration.localization import ensure_languages
    from .modules.cms.seed import ABOUT_PAGE

    await ensure_languages(db)
    if not (await db.execute(select(CmsPage.id).limit(1))).first():
        db.add(
            CmsPage(
                slug="about",
                title=ABOUT_PAGE["title"],
                status="published",
                draft=ABOUT_PAGE,
                published=ABOUT_PAGE,
                has_unpublished_changes=False,
                published_at=func.now(),
            )
        )

    # branding
    if not await db.get(BrandingSetting, 1):
        default = Branding().model_dump(mode="json")
        db.add(BrandingSetting(id=1, draft=default, published=default, version=1))
    return stats


async def run() -> dict:
    secrets.load()  # generate keys on first start
    async with SessionLocal() as db:
        await db.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": LOCK_ID})
        stats = await sync(db)
        await db.commit()
    return stats


async def _main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    stats = await run()
    log.info("bootstrap complete: %s", stats)
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(_main())
