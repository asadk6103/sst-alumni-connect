"""News, announcements and success stories: drafting, scheduling, website and portal feeds."""

import re
import unicodedata
import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.audit import record
from ...core.db import get_db
from ...core.deps import Principal, require
from ...core.errors import AppError, not_found
from ...core.pagination import PageParams, page_params, paginate
from ...models import NewsPost, User
from ...services.templates import simple_html
from . import blocks as B

admin = APIRouter(prefix="/api/v1/admin/news", tags=["Admin: news"])
public = APIRouter(prefix="/api/v1/public/news", tags=["Public"])
router = APIRouter(prefix="/api/v1/news", tags=["News"])

Category = Literal["news", "announcement", "success_story"]
CATEGORIES = {"news": "News", "announcement": "Announcement", "success_story": "Success story"}


def slugify(text: str) -> str:
    s = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:100] or "post"


async def unique_slug(db: AsyncSession, base: str, exclude: uuid.UUID | None = None) -> str:
    slug, n = base, 1
    while True:
        stmt = select(NewsPost.id).where(NewsPost.slug == slug, NewsPost.deleted_at.is_(None))
        if exclude:
            stmt = stmt.where(NewsPost.id != exclude)
        if not (await db.execute(stmt)).first():
            return slug
        n += 1
        slug = f"{base}-{n}"


def state(n: NewsPost) -> str:
    if n.status == "published" and n.publish_at and n.publish_at > B.now():
        return "scheduled"
    return n.status


async def news_out(db: AsyncSession, n: NewsPost, full: bool = False, staff: bool = False) -> dict:
    out = {**await B.news_card(db, n), "members_only": n.members_only}
    if staff:
        author = await db.get(User, n.author_id) if n.author_id else None
        out.update(
            {
                "status": state(n),
                "publish_at": n.publish_at,
                "updated_at": n.updated_at,
                "author": author.full_name if author else None,
                "cover_id": str(n.cover_id) if n.cover_id else None,
                "seo_title": n.seo_title,
                "seo_description": n.seo_description,
            }
        )
    if full:
        out.update(
            {
                "body": n.body if staff else None,
                "html": simple_html(n.body),
                "seo_title": n.seo_title or n.title,
                "seo_description": n.seo_description or n.summary,
            }
        )
    return out


# ── staff ───────────────────────────────────────────────────────────────────
class NewsIn(BaseModel):
    title: str = Field(..., min_length=3, max_length=200)
    slug: str | None = Field(None, max_length=160, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    category: Category = "news"
    summary: str = Field("", max_length=400)
    body: str = Field("", max_length=50000)
    cover_id: uuid.UUID | None = None
    pinned: bool = False
    members_only: bool = False
    seo_title: str | None = Field(None, max_length=200)
    seo_description: str | None = Field(None, max_length=300)


async def _get(db: AsyncSession, news_id: uuid.UUID) -> NewsPost:
    n = await db.get(NewsPost, news_id)
    if not n or n.deleted_at:
        raise not_found("Article")
    return n


async def _apply(db: AsyncSession, n: NewsPost, body: NewsIn) -> None:
    for f in ("title", "category", "summary", "body", "cover_id", "pinned", "members_only", "seo_title", "seo_description"):
        setattr(n, f, getattr(body, f))
    wanted = body.slug or (n.slug if n.slug else slugify(body.title))
    if body.slug and body.slug != n.slug:
        taken = (
            await db.execute(select(NewsPost.id).where(NewsPost.slug == body.slug, NewsPost.deleted_at.is_(None), NewsPost.id != n.id))
        ).first()
        if taken:
            raise AppError(
                409,
                "SLUG_TAKEN",
                "Another article already uses this address.",
                [{"field": "slug", "message": "Another article already uses this address."}],
            )
        n.slug = body.slug
    elif not n.slug:
        n.slug = await unique_slug(db, wanted, n.id)


@admin.get("", summary="Articles")
async def list_news(
    q: str | None = Query(None, max_length=100),
    category: Category | None = None,
    status: Literal["draft", "published", "scheduled"] | None = None,
    p: PageParams = Depends(page_params),
    _: Principal = Depends(require("news.view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(NewsPost).where(NewsPost.deleted_at.is_(None))
    if q:
        stmt = stmt.where(or_(NewsPost.title.ilike(f"%{q}%"), NewsPost.summary.ilike(f"%{q}%")))
    if category:
        stmt = stmt.where(NewsPost.category == category)
    if status == "draft":
        stmt = stmt.where(NewsPost.status == "draft")
    elif status == "published":
        stmt = stmt.where(NewsPost.status == "published", or_(NewsPost.publish_at.is_(None), NewsPost.publish_at <= func.now()))
    elif status == "scheduled":
        stmt = stmt.where(NewsPost.status == "published", NewsPost.publish_at > func.now())
    rows, meta = await paginate(db, stmt.order_by(NewsPost.updated_at.desc()), p)
    return {"data": [await news_out(db, n, staff=True) for n in rows], "meta": {**meta, "categories": CATEGORIES}}


@admin.post("", status_code=201, summary="Write an article (draft)")
async def create_news(body: NewsIn, me: Principal = Depends(require("news.create")), db: AsyncSession = Depends(get_db)):
    n = NewsPost(slug="", status="draft", author_id=me.id)
    await _apply(db, n, body)
    db.add(n)
    await db.flush()
    await record(db, actor_id=me.id, action="create", entity="news", entity_id=n.id, summary=f"Wrote article '{n.title}'")
    await db.commit()
    return {"data": await news_out(db, n, full=True, staff=True)}


@admin.get("/{news_id}", summary="An article")
async def get_news(news_id: uuid.UUID, _: Principal = Depends(require("news.view")), db: AsyncSession = Depends(get_db)):
    return {"data": await news_out(db, await _get(db, news_id), full=True, staff=True)}


@admin.put("/{news_id}", summary="Edit an article")
async def edit_news(news_id: uuid.UUID, body: NewsIn, me: Principal = Depends(require("news.edit")), db: AsyncSession = Depends(get_db)):
    n = await _get(db, news_id)
    await _apply(db, n, body)
    await record(db, actor_id=me.id, action="update", entity="news", entity_id=n.id, summary=f"Edited article '{n.title}'")
    await db.commit()
    await settings_store.changed()
    return {"data": await news_out(db, n, full=True, staff=True)}


class PublishIn(BaseModel):
    publish: bool = True
    publish_at: datetime | None = None


@admin.post("/{news_id}/publish", summary="Publish now, schedule, or return to draft")
async def publish_news(
    news_id: uuid.UUID, body: PublishIn, me: Principal = Depends(require("news.publish")), db: AsyncSession = Depends(get_db)
):
    n = await _get(db, news_id)
    if body.publish:
        n.status = "published"
        n.publish_at = body.publish_at.astimezone(UTC) if body.publish_at else B.now()
        verb = "Scheduled" if n.publish_at > B.now() else "Published"
        if verb == "Published" and n.category == "announcement":
            from ...services import push

            await push.broadcast(db, n.title, n.summary or "", {"link": f"/portal/news/{n.slug}", "slug": n.slug})
    else:
        n.status, verb = "draft", "Unpublished"
    await record(
        db,
        actor_id=me.id,
        action="publish" if body.publish else "unpublish",
        entity="news",
        entity_id=n.id,
        summary=f"{verb} article '{n.title}'",
    )
    await db.commit()
    await settings_store.changed()
    return {"data": await news_out(db, n, full=True, staff=True)}


@admin.delete("/{news_id}", summary="Delete an article")
async def delete_news(news_id: uuid.UUID, me: Principal = Depends(require("news.delete")), db: AsyncSession = Depends(get_db)):
    n = await _get(db, news_id)
    n.deleted_at = B.now()
    await record(db, actor_id=me.id, action="delete", entity="news", entity_id=n.id, summary=f"Deleted article '{n.title}'")
    await db.commit()
    await settings_store.changed()
    return {"data": {"ok": True}}


# ── website and portal ──────────────────────────────────────────────────────
def _meta(p: PageParams, total: int) -> dict:
    return {"page": p.page, "page_size": p.page_size, "total": total, "pages": max(1, -(-total // p.page_size))}


async def _feed(db: AsyncSession, members: bool, category: str | None, q: str | None, p: PageParams):
    stmt = select(NewsPost).where(B.news_visible(members))
    if category:
        stmt = stmt.where(NewsPost.category == category)
    if q:
        stmt = stmt.where(or_(NewsPost.title.ilike(f"%{q}%"), NewsPost.summary.ilike(f"%{q}%")))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        (
            await db.execute(
                stmt.order_by(NewsPost.pinned.desc(), func.coalesce(NewsPost.publish_at, NewsPost.created_at).desc())
                .offset((p.page - 1) * p.page_size)
                .limit(p.page_size)
            )
        )
        .scalars()
        .all()
    )
    return {"data": [await news_out(db, n) for n in rows], "meta": _meta(p, total)}


async def _article(db: AsyncSession, slug: str, members: bool) -> dict:
    n = (await db.execute(select(NewsPost).where(NewsPost.slug == slug, B.news_visible(members)))).scalar_one_or_none()
    if not n:
        raise not_found("Article")
    out = await news_out(db, n, full=True)
    related = (
        (
            await db.execute(
                select(NewsPost)
                .where(B.news_visible(members), NewsPost.id != n.id, NewsPost.category == n.category)
                .order_by(func.coalesce(NewsPost.publish_at, NewsPost.created_at).desc())
                .limit(3)
            )
        )
        .scalars()
        .all()
    )
    out["related"] = [await B.news_card(db, r) for r in related]
    return out


@public.get("", summary="Published news for the website")
async def public_feed(
    response: Response,
    category: Category | None = None,
    q: str | None = Query(None, max_length=100),
    p: PageParams = Depends(page_params),
    db: AsyncSession = Depends(get_db),
):
    response.headers["Cache-Control"] = "public, max-age=15"
    return await _feed(db, False, category, q, p)


@public.get("/{slug}", summary="A published article")
async def public_article(slug: str, response: Response, db: AsyncSession = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=15"
    return {"data": await _article(db, slug[:160], False)}


@router.get("", summary="News and announcements (includes members-only posts)")
async def member_feed(
    category: Category | None = None,
    q: str | None = Query(None, max_length=100),
    p: PageParams = Depends(page_params),
    _: Principal = Depends(require("portal.access")),
    db: AsyncSession = Depends(get_db),
):
    return await _feed(db, True, category, q, p)


@router.get("/{slug}", summary="An article")
async def member_article(slug: str, _: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    return {"data": await _article(db, slug[:160], True)}
