"""Public, cache-friendly endpoints used by every frontend before sign-in."""

import uuid

from fastapi import APIRouter, Depends, Response
from fastapi.responses import Response as RawResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.db import get_db
from ...core.deps import Principal, optional_user
from ...core.errors import not_found
from ...models import Media
from ...services import media, storage

router = APIRouter(tags=["Public"])


async def _site_payload(db: AsyncSession) -> dict:
    general = await settings_store.get_group(db, "general")
    brand = await settings_store.branding(db)
    assets = {}
    for f in ("institution_logo", "logo_light", "logo_dark", "favicon", "login_background", "dashboard_banner"):
        mid = getattr(brand, f)
        if mid:
            try:
                m = await db.get(Media, uuid.UUID(mid))
            except ValueError:
                m = None
            if m and not m.deleted_at:
                assets[f] = await media.to_public(db, m)
    sec = await settings_store.get_group(db, "security")
    alumni_cfg = await settings_store.get_group(db, "alumni")
    return {
        "terms_url": alumni_cfg.terms_url,
        "installed": await settings_store.is_installed(db),
        "app_name": general.app_name,
        "app_description": general.app_description,
        "app_url": general.app_url,
        "institution_name": general.institution_name,
        "contact_email": general.contact_email,
        "contact_phone": general.contact_phone,
        "address": general.address,
        "default_language": general.default_language,
        "timezone": general.timezone,
        "date_format": general.date_format,
        "time_format": general.time_format,
        "currency": general.currency,
        "branding": brand.model_dump(mode="json"),
        "branding_version": await settings_store.branding_version(db),
        "assets": assets,
        "modules": await settings_store.modules(db),
        "auth": {
            "require_email_verification": sec.require_email_verification,
            "require_phone_verification": sec.require_phone_verification,
            "min_password_length": sec.min_password_length,
            "require_uppercase": sec.require_uppercase,
            "require_lowercase": sec.require_lowercase,
            "require_digit": sec.require_digit,
            "require_symbol": sec.require_symbol,
        },
    }


@router.get("/api/v1/public/site", summary="Site identity, published branding, enabled modules")
async def site(response: Response, user: Principal | None = Depends(optional_user), db: AsyncSession = Depends(get_db)):
    # Shared part is cached in-process until settings change; feature flags depend on the viewer's roles.
    payload = await settings_store.cached("site-payload", lambda: _site_payload(db))
    flags = await settings_store.flags(db)
    roles = set(user.roles) if user else set()
    features = {k: en and (not r or bool(roles.intersection(r))) for k, (en, r) in flags.items()}
    # Never cache before installation (the wizard flips this); shared caches only for anonymous visitors.
    response.headers["Cache-Control"] = "no-store" if not payload["installed"] else "private, max-age=15" if user else "public, max-age=15"
    return {"data": {**payload, "features": features}}


@router.get("/media/{key:path}", include_in_schema=False)
async def serve_media(key: str, db: AsyncSession = Depends(get_db)):
    """Streams public objects (nginx serves local files directly; this covers private S3 buckets and dev)."""
    if ".." in key or key.startswith("/"):
        raise not_found("File")
    from sqlalchemy import or_, select

    base = key.rsplit("-", 1)[0] if key.endswith(".webp") else key
    m = (await db.execute(select(Media).where(or_(Media.key == key, Media.key.like(f"{base}.%"))).limit(1))).scalars().first()
    if not m or m.deleted_at or m.private:
        raise not_found("File")
    store = await storage.backend(db) if m.storage != "local" else storage.LocalStorage(storage.infra().storage_dir)
    try:
        data = await store.get(key)
    except Exception as e:
        raise not_found("File") from e
    mime = "image/webp" if key.endswith(".webp") and key != m.key else m.mime
    headers = {"Cache-Control": "public, max-age=2592000, immutable", "X-Content-Type-Options": "nosniff"}
    if not mime.startswith("image/"):
        headers["Content-Disposition"] = f'attachment; filename="{m.filename}"'
    return RawResponse(content=data, media_type=mime, headers=headers)
