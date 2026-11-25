"""CMS pages: drafts, publishing and scheduling, SEO, slugs, preview tokens, public delivery."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

import jwt
from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import secrets, settings_store
from ...core.audit import record
from ...core.db import get_db
from ...core.deps import Principal, require
from ...core.errors import AppError, not_found
from ...core.pagination import PageParams, page_params, paginate
from ...models import CmsPage, User
from ..events.service import image
from . import blocks as B

admin = APIRouter(prefix="/api/v1/admin/cms/pages", tags=["Admin: pages"])
public = APIRouter(prefix="/api/v1/public", tags=["Public"])

SLUG = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"
# Paths the website or apps already use — a page cannot take them.
RESERVED = {
    "admin",
    "portal",
    "login",
    "register",
    "logout",
    "setup",
    "api",
    "media",
    "news",
    "events",
    "gallery",
    "contact",
    "newsletter",
    "distinguished-alumni",
    "forgot-password",
    "reset-password",
    "verify-email",
    "preview",
    "health",
    "metrics",
    "static",
    "_next",
    "favicon.ico",
    "robots.txt",
    "sitemap.xml",
}


class PageIn(BaseModel):
    title: str = Field(..., min_length=2, max_length=200)
    slug: str = Field(..., min_length=1, max_length=120, pattern=SLUG)
    seo_title: str = Field("", max_length=200)
    seo_description: str = Field("", max_length=300)
    featured_image_id: uuid.UUID | None = None
    blocks: list[dict] = Field(default_factory=list, max_length=60)


def _validate_blocks(raw: list[dict]) -> list[dict]:
    try:
        return [b.model_dump(mode="json") for b in B.BlockList.validate_python(raw)]
    except ValidationError as e:
        details = []
        for err in e.errors()[:20]:
            loc = [str(x) for x in err["loc"]]
            # loc: [index, type, field, ...] → blocks.0.button_url
            path = ".".join([loc[0], *loc[2:]]) if len(loc) > 1 else loc[0]
            details.append({"field": f"blocks.{path}", "message": err["msg"].removeprefix("Value error, ")})
        raise AppError(422, "VALIDATION_ERROR", details[0]["message"] if details else "Some blocks are not valid.", details) from e


def effective_status(p: CmsPage) -> str:
    if p.status == "scheduled" and p.publish_at and p.publish_at <= B.now():
        return "published"
    return p.status


async def page_out(db: AsyncSession, p: CmsPage, full: bool = False) -> dict:
    d = p.draft or {}
    out = {
        "id": str(p.id),
        "slug": p.slug,
        "title": p.title,
        "status": effective_status(p),
        "publish_at": p.publish_at,
        "published_at": p.published_at,
        "has_unpublished_changes": p.has_unpublished_changes,
        "updated_at": p.updated_at,
        "created_at": p.created_at,
        "blocks_count": len(d.get("blocks") or []),
    }
    if p.updated_by:
        u = await db.get(User, p.updated_by)
        out["updated_by"] = u.full_name if u else None
    if full:
        out.update(
            {
                "seo_title": d.get("seo_title", ""),
                "seo_description": d.get("seo_description", ""),
                "featured_image_id": d.get("featured_image_id"),
                "featured_image": await image(db, d.get("featured_image_id")),
                "blocks": d.get("blocks") or [],
                "images": await _block_images(db, d.get("blocks") or []),
            }
        )
    return out


async def _block_images(db: AsyncSession, blocks: list[dict]) -> dict[str, dict]:
    """Thumbnails for the editor: every image referenced by the blocks."""
    ids = set()
    for b in blocks:
        if b.get("image_id"):
            ids.add(b["image_id"])
        for it in b.get("items") or []:
            if isinstance(it, dict) and it.get("photo_id"):
                ids.add(it["photo_id"])
    out = {}
    for i in ids:
        try:
            img = await image(db, uuid.UUID(str(i)))
        except ValueError:
            img = None
        if img:
            out[str(i)] = img
    return out


async def _get(db: AsyncSession, page_id: uuid.UUID) -> CmsPage:
    p = await db.get(CmsPage, page_id)
    if not p or p.deleted_at:
        raise not_found("Page")
    return p


async def _check_slug(db: AsyncSession, slug: str, page_id: uuid.UUID | None = None) -> None:
    if slug in RESERVED:
        raise AppError(
            422,
            "SLUG_RESERVED",
            "This address is used by the website. Choose another.",
            [{"field": "slug", "message": "This address is reserved."}],
        )
    stmt = select(CmsPage.id).where(CmsPage.slug == slug, CmsPage.deleted_at.is_(None))
    if page_id:
        stmt = stmt.where(CmsPage.id != page_id)
    if (await db.execute(stmt)).first():
        raise AppError(
            409,
            "SLUG_TAKEN",
            "Another page already uses this address.",
            [{"field": "slug", "message": "Another page already uses this address."}],
        )


def _draft(body: PageIn) -> dict:
    return {
        "title": body.title,
        "seo_title": body.seo_title,
        "seo_description": body.seo_description,
        "featured_image_id": str(body.featured_image_id) if body.featured_image_id else None,
        "blocks": _validate_blocks(body.blocks),
    }


@admin.get("", summary="Pages")
async def list_pages(
    q: str | None = Query(None, max_length=100),
    status: Literal["draft", "scheduled", "published", "archived"] | None = None,
    p: PageParams = Depends(page_params),
    _: Principal = Depends(require("cms.view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(CmsPage).where(CmsPage.deleted_at.is_(None))
    if q:
        stmt = stmt.where(or_(CmsPage.title.ilike(f"%{q}%"), CmsPage.slug.ilike(f"%{q}%")))
    if status:
        stmt = stmt.where(CmsPage.status == status)
    rows, meta = await paginate(db, stmt.order_by(CmsPage.updated_at.desc()), p)
    web = await settings_store.get_group(db, "website")
    return {
        "data": [{**await page_out(db, r), "is_home": r.slug == web.home_page} for r in rows],
        "meta": {**meta, "block_types": B.BLOCK_TYPES},
    }


@admin.post("", status_code=201, summary="Create a page (as a draft)")
async def create_page(body: PageIn, me: Principal = Depends(require("cms.create")), db: AsyncSession = Depends(get_db)):
    await _check_slug(db, body.slug)
    p = CmsPage(
        slug=body.slug,
        title=body.title,
        status="draft",
        draft=_draft(body),
        created_by=me.id,
        updated_by=me.id,
        has_unpublished_changes=True,
    )
    db.add(p)
    await db.flush()
    await record(db, actor_id=me.id, action="create", entity="cms_page", entity_id=p.id, summary=f"Created page '{p.title}'")
    await db.commit()
    return {"data": await page_out(db, p, full=True)}


@admin.get("/{page_id}", summary="A page with its draft")
async def get_page(page_id: uuid.UUID, _: Principal = Depends(require("cms.view")), db: AsyncSession = Depends(get_db)):
    return {"data": await page_out(db, await _get(db, page_id), full=True)}


@admin.put("/{page_id}", summary="Save the draft (the published version is unchanged until you publish)")
async def save_page(page_id: uuid.UUID, body: PageIn, me: Principal = Depends(require("cms.edit")), db: AsyncSession = Depends(get_db)):
    p = await _get(db, page_id)
    if body.slug != p.slug:
        await _check_slug(db, body.slug, p.id)
        web = await settings_store.get_group(db, "website")
        if web.home_page == p.slug:
            raise AppError(422, "PAGE_IS_HOME", "This page is the home page — choose another home page before changing its address.")
        p.slug = body.slug  # the address changes immediately (links in menus follow the page)
    p.draft, p.updated_by, p.has_unpublished_changes = _draft(body), me.id, True
    if p.status != "published":
        p.title = body.title
    await record(db, actor_id=me.id, action="update", entity="cms_page", entity_id=p.id, summary=f"Saved draft of '{body.title}'")
    await db.commit()
    return {"data": await page_out(db, p, full=True)}


class PublishIn(BaseModel):
    publish_at: datetime | None = None  # future = scheduled


@admin.post("/{page_id}/publish", summary="Publish the draft now or at a scheduled time")
async def publish_page(
    page_id: uuid.UUID, body: PublishIn, me: Principal = Depends(require("cms.publish")), db: AsyncSession = Depends(get_db)
):
    p = await _get(db, page_id)
    _validate_blocks((p.draft or {}).get("blocks") or [])
    when = body.publish_at.astimezone(UTC) if body.publish_at else None
    scheduled = bool(when and when > B.now() + timedelta(seconds=30))
    p.published = dict(p.draft)
    p.title = p.draft.get("title") or p.title
    p.status = "scheduled" if scheduled else "published"
    p.publish_at = when if scheduled else None
    p.published_at = when if scheduled else B.now()
    p.has_unpublished_changes = False
    p.updated_by = me.id
    await record(
        db,
        actor_id=me.id,
        action="publish",
        entity="cms_page",
        entity_id=p.id,
        summary=f"{'Scheduled' if scheduled else 'Published'} page '{p.title}'" + (f" for {when:%d %b %Y %H:%M} UTC" if scheduled else ""),
    )
    await db.commit()
    await settings_store.changed()
    return {"data": await page_out(db, p, full=True)}


@admin.post("/{page_id}/unpublish", summary="Take a page off the website (kept as a draft)")
async def unpublish_page(page_id: uuid.UUID, me: Principal = Depends(require("cms.publish")), db: AsyncSession = Depends(get_db)):
    p = await _get(db, page_id)
    web = await settings_store.get_group(db, "website")
    if web.home_page == p.slug:
        raise AppError(422, "PAGE_IS_HOME", "This page is the home page — choose another home page first.")
    p.status, p.publish_at, p.has_unpublished_changes = "archived", None, True
    await record(db, actor_id=me.id, action="unpublish", entity="cms_page", entity_id=p.id, summary=f"Unpublished page '{p.title}'")
    await db.commit()
    await settings_store.changed()
    return {"data": await page_out(db, p, full=True)}


@admin.post("/{page_id}/discard", summary="Discard draft changes (back to the published version)")
async def discard_draft(page_id: uuid.UUID, me: Principal = Depends(require("cms.edit")), db: AsyncSession = Depends(get_db)):
    p = await _get(db, page_id)
    if not p.published:
        raise AppError(422, "NEVER_PUBLISHED", "This page has never been published.")
    p.draft, p.has_unpublished_changes = dict(p.published), False
    await db.commit()
    return {"data": await page_out(db, p, full=True)}


@admin.post("/{page_id}/duplicate", status_code=201, summary="Copy a page as a new draft")
async def duplicate_page(page_id: uuid.UUID, me: Principal = Depends(require("cms.create")), db: AsyncSession = Depends(get_db)):
    src = await _get(db, page_id)
    base, n = f"{src.slug}-copy", 1
    slug = base
    while (await db.execute(select(CmsPage.id).where(CmsPage.slug == slug, CmsPage.deleted_at.is_(None)))).first():
        n += 1
        slug = f"{base}-{n}"
    p = CmsPage(
        slug=slug,
        title=f"{src.title} (copy)",
        status="draft",
        draft={**src.draft, "title": f"{src.title} (copy)"},
        created_by=me.id,
        updated_by=me.id,
    )
    db.add(p)
    await db.flush()
    await record(db, actor_id=me.id, action="create", entity="cms_page", entity_id=p.id, summary=f"Duplicated page '{src.title}'")
    await db.commit()
    return {"data": await page_out(db, p, full=True)}


@admin.delete("/{page_id}", summary="Delete a page")
async def delete_page(page_id: uuid.UUID, me: Principal = Depends(require("cms.delete")), db: AsyncSession = Depends(get_db)):
    p = await _get(db, page_id)
    web = await settings_store.get_group(db, "website")
    if web.home_page == p.slug:
        raise AppError(422, "PAGE_IS_HOME", "This page is the home page — choose another home page first.")
    p.deleted_at = B.now()
    await record(db, actor_id=me.id, action="delete", entity="cms_page", entity_id=p.id, summary=f"Deleted page '{p.title}'")
    await db.commit()
    await settings_store.changed()
    return {"data": {"ok": True}}


@admin.post("/{page_id}/preview-token", summary="A short-lived link to preview the draft on the website")
async def preview_token(page_id: uuid.UUID, me: Principal = Depends(require("cms.view")), db: AsyncSession = Depends(get_db)):
    p = await _get(db, page_id)
    exp = B.now() + timedelta(minutes=30)
    token = jwt.encode(
        {"typ": "page_preview", "pid": str(p.id), "sub": str(me.id), "exp": exp}, secrets.get("jwt_signing_key"), algorithm="HS256"
    )
    return {"data": {"token": token, "path": f"/preview?token={token}", "expires_at": exp}}


# ── website ─────────────────────────────────────────────────────────────────
async def rendered(db: AsyncSession, p: CmsPage, version: dict) -> dict:
    return {
        "id": str(p.id),
        "slug": p.slug,
        "title": version.get("title") or p.title,
        "seo_title": version.get("seo_title") or version.get("title") or p.title,
        "seo_description": version.get("seo_description") or "",
        "featured_image": await image(db, version.get("featured_image_id")),
        "published_at": p.published_at,
        "updated_at": p.updated_at,
        "blocks": await B.resolve(db, version.get("blocks") or []),
    }


def _live():
    return (
        CmsPage.deleted_at.is_(None)
        & CmsPage.published.is_not(None)
        & ((CmsPage.status == "published") | ((CmsPage.status == "scheduled") & (CmsPage.publish_at <= func.now())))
    )


async def published_page(db: AsyncSession, slug: str) -> dict | None:
    async def load():
        p = (await db.execute(select(CmsPage).where(CmsPage.slug == slug, _live()))).scalar_one_or_none()
        return await rendered(db, p, p.published) if p else None

    return await settings_store.cached(f"page:{slug}", load)


@public.get("/pages/{slug}", summary="A published page, ready to render")
async def get_public_page(slug: str, response: Response, db: AsyncSession = Depends(get_db)):
    if len(slug) > 120:
        raise not_found("Page")
    data = await published_page(db, slug)
    if not data:
        raise not_found("Page")
    response.headers["Cache-Control"] = "public, max-age=15"
    return {"data": data}


@public.get("/home", summary="The website home page (null = the built-in landing page)")
async def get_home(response: Response, db: AsyncSession = Depends(get_db)):
    web = await settings_store.get_group(db, "website")
    response.headers["Cache-Control"] = "public, max-age=15"
    return {"data": await published_page(db, web.home_page) if web.home_page else None}


@public.get("/preview", summary="Preview a draft with a link from the page editor")
async def get_preview(response: Response, token: str = Query(..., max_length=2000), db: AsyncSession = Depends(get_db)):
    try:
        claims = jwt.decode(token, secrets.get("jwt_signing_key"), algorithms=["HS256"], options={"require": ["exp", "pid"]})
    except jwt.PyJWTError as e:
        raise AppError(401, "PREVIEW_EXPIRED", "This preview link has expired. Open the preview again from the editor.") from e
    if claims.get("typ") != "page_preview":
        raise AppError(401, "PREVIEW_EXPIRED", "This preview link is not valid.")
    p = await db.get(CmsPage, uuid.UUID(claims["pid"]))
    if not p or p.deleted_at:
        raise not_found("Page")
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Robots-Tag"] = "noindex"
    return {"data": await rendered(db, p, p.draft or {})}


@public.get("/sitemap", summary="Published pages and news for the sitemap")
async def sitemap(db: AsyncSession = Depends(get_db)):
    from ...models import NewsPost

    pages = (await db.execute(select(CmsPage.slug, CmsPage.updated_at).where(_live()))).all()
    news = (await db.execute(select(NewsPost.slug, NewsPost.updated_at).where(B.news_visible()))).all()
    return {"data": {"pages": [{"slug": s, "updated_at": u} for s, u in pages], "news": [{"slug": s, "updated_at": u} for s, u in news]}}
