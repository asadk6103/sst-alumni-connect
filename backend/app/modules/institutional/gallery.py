"""Photo gallery: albums (members-only or public), photos with captions, publishing."""

import uuid
from datetime import UTC, date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.audit import record
from ...core.db import get_db
from ...core.deps import Principal, client_ip, require, require_module
from ...core.errors import AppError, not_found
from ...core.pagination import PageParams, page_params
from ...models import Album, AlbumPhoto, Event, Media
from ...services import media
from ..events.service import image

router = APIRouter(prefix="/api/v1/gallery", tags=["Gallery"], dependencies=[Depends(require_module("gallery"))])
public = APIRouter(prefix="/api/v1/public/gallery", tags=["Public"])
admin = APIRouter(prefix="/api/v1/admin/gallery", tags=["Admin: gallery"])


def _meta(p: PageParams, total: int) -> dict:
    return {"page": p.page, "page_size": p.page_size, "total": total, "pages": max(1, -(-total // p.page_size))}


async def album_out(db: AsyncSession, a: Album, photos: bool = False) -> dict:
    cover = await image(db, a.cover_id)
    if not cover:
        first = (
            await db.execute(select(AlbumPhoto.media_id).where(AlbumPhoto.album_id == a.id).order_by(AlbumPhoto.position).limit(1))
        ).scalar_one_or_none()
        cover = await image(db, first)
    ev = await db.get(Event, a.event_id) if a.event_id else None
    out = {
        "id": str(a.id),
        "title": a.title,
        "description": a.description,
        "cover": cover,
        "taken_on": a.taken_on,
        "visibility": a.visibility,
        "status": a.status,
        "photo_count": a.photo_count,
        "event": {"id": str(ev.id), "title": ev.title} if ev else None,
        "published_at": a.published_at,
        "cover_id": str(a.cover_id) if a.cover_id else None,
    }
    if photos:
        rows = (
            (await db.execute(select(AlbumPhoto).where(AlbumPhoto.album_id == a.id).order_by(AlbumPhoto.position, AlbumPhoto.created_at)))
            .scalars()
            .all()
        )
        out["photos"] = [
            p
            for p in [{**(await image(db, r.media_id) or {}), "caption": r.caption, "media_id": str(r.media_id)} for r in rows]
            if p.get("url")
        ]
    return out


# ── members and public ──────────────────────────────────────────────────────
@router.get("/albums", summary="Published albums")
async def albums(
    q: str | None = Query(None, max_length=100),
    p: PageParams = Depends(page_params),
    me: Principal = Depends(require("portal.access")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Album).where(Album.status == "published")
    if q:
        stmt = stmt.where(func.lower(Album.title).like(f"%{q.strip().lower()}%"))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        (
            await db.execute(
                stmt.order_by(Album.taken_on.desc().nulls_last(), Album.published_at.desc())
                .offset((p.page - 1) * p.page_size)
                .limit(p.page_size)
            )
        )
        .scalars()
        .all()
    )
    return {"data": [await album_out(db, a) for a in rows], "meta": _meta(p, total)}


@router.get("/albums/{album_id}", summary="An album with its photos")
async def album(album_id: uuid.UUID, me: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    a = await db.get(Album, album_id)
    if not a or (a.status != "published" and not me.can("gallery.view")):
        raise not_found("Album")
    return {"data": await album_out(db, a, photos=True)}


@public.get("", summary="Public albums for the website")
async def public_albums(limit: int = Query(12, ge=1, le=50), db: AsyncSession = Depends(get_db)):
    if not (await settings_store.modules(db)).get("gallery", True):
        return {"data": []}
    rows = (
        (
            await db.execute(
                select(Album)
                .where(Album.status == "published", Album.visibility == "public")
                .order_by(Album.published_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return {"data": [await album_out(db, a) for a in rows]}


@public.get("/{album_id}", summary="A public album")
async def public_album(album_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    a = await db.get(Album, album_id)
    if not a or a.status != "published" or a.visibility != "public" or not (await settings_store.modules(db)).get("gallery", True):
        raise not_found("Album")
    return {"data": await album_out(db, a, photos=True)}


# ── staff ───────────────────────────────────────────────────────────────────
class AlbumIn(BaseModel):
    title: str = Field(..., min_length=2, max_length=200)
    description: str = Field("", max_length=2000)
    event_id: uuid.UUID | None = None
    cover_id: uuid.UUID | None = None
    taken_on: date | None = None
    visibility: Literal["public", "members"] = "members"


@admin.get("", summary="All albums")
async def admin_albums(
    status: Literal["draft", "published"] | None = None,
    p: PageParams = Depends(page_params),
    me: Principal = Depends(require("gallery.view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Album)
    if status:
        stmt = stmt.where(Album.status == status)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(stmt.order_by(Album.created_at.desc()).offset((p.page - 1) * p.page_size).limit(p.page_size))).scalars().all()
    return {"data": [await album_out(db, a) for a in rows], "meta": _meta(p, total)}


async def _album(db: AsyncSession, album_id: uuid.UUID) -> Album:
    a = await db.get(Album, album_id)
    if not a:
        raise not_found("Album")
    return a


async def _check(db: AsyncSession, body: AlbumIn, album_id: uuid.UUID | None = None) -> None:
    if body.event_id and not await db.get(Event, body.event_id):
        raise AppError(422, "VALIDATION_ERROR", "Unknown event.", [{"field": "event_id", "message": "Unknown."}])
    if body.cover_id and album_id and not await db.get(AlbumPhoto, (album_id, body.cover_id)):
        raise AppError(
            422, "VALIDATION_ERROR", "The cover must be one of the album's photos.", [{"field": "cover_id", "message": "Not in album."}]
        )


@admin.post("", status_code=201, summary="Create an album (draft)")
async def create(body: AlbumIn, request: Request, me: Principal = Depends(require("gallery.create")), db: AsyncSession = Depends(get_db)):
    await _check(db, body.model_copy(update={"cover_id": None}))
    a = Album(**{**body.model_dump(), "cover_id": None}, status="draft", photo_count=0, created_by=me.id)
    db.add(a)
    await db.flush()
    await record(
        db, actor_id=me.id, action="create", entity="album", entity_id=a.id, summary=f"Created album {a.title}", ip=client_ip(request)
    )
    return {"data": await album_out(db, a, photos=True)}


@admin.get("/{album_id}", summary="An album (staff)")
async def admin_album(album_id: uuid.UUID, me: Principal = Depends(require("gallery.view")), db: AsyncSession = Depends(get_db)):
    return {"data": await album_out(db, await _album(db, album_id), photos=True)}


@admin.put("/{album_id}", summary="Edit an album")
async def edit(album_id: uuid.UUID, body: AlbumIn, me: Principal = Depends(require("gallery.edit")), db: AsyncSession = Depends(get_db)):
    a = await _album(db, album_id)
    await _check(db, body, a.id)
    for k, v in body.model_dump().items():
        setattr(a, k, v)
    await db.flush()
    return {"data": await album_out(db, a, photos=True)}


@admin.post("/{album_id}/photos", status_code=201, summary="Add a photo")
async def add_photo(
    album_id: uuid.UUID,
    file: UploadFile = File(...),
    caption: str = Form("", max_length=300),
    me: Principal = Depends(require("gallery.create")),
    db: AsyncSession = Depends(get_db),
):
    a = await _album(db, album_id)
    m = await media.upload(
        db,
        data=await file.read(),
        filename=file.filename or "photo",
        folder="gallery",
        alt=caption or a.title,
        images_only=True,
        actor=me.id,
    )
    pos = (await db.execute(select(func.coalesce(func.max(AlbumPhoto.position), -1)).where(AlbumPhoto.album_id == a.id))).scalar_one() + 1
    db.add(AlbumPhoto(album_id=a.id, media_id=m.id, caption=caption, position=pos))
    await db.execute(update(Album).where(Album.id == a.id).values(photo_count=Album.photo_count + 1))
    await db.flush()
    return {"data": {**(await image(db, m.id)), "caption": caption, "media_id": str(m.id)}}


class CaptionIn(BaseModel):
    caption: str = Field("", max_length=300)


@admin.patch("/{album_id}/photos/{media_id}", summary="Edit a caption")
async def caption(
    album_id: uuid.UUID,
    media_id: uuid.UUID,
    body: CaptionIn,
    me: Principal = Depends(require("gallery.edit")),
    db: AsyncSession = Depends(get_db),
):
    ph = await db.get(AlbumPhoto, (album_id, media_id))
    if not ph:
        raise not_found("Photo")
    ph.caption = body.caption
    if m := await db.get(Media, media_id):
        m.alt = body.caption or m.alt
    return {"data": {"ok": True}}


@admin.delete("/{album_id}/photos/{media_id}", summary="Remove a photo")
async def remove_photo(
    album_id: uuid.UUID, media_id: uuid.UUID, me: Principal = Depends(require("gallery.delete")), db: AsyncSession = Depends(get_db)
):
    res = await db.execute(delete(AlbumPhoto).where(AlbumPhoto.album_id == album_id, AlbumPhoto.media_id == media_id))
    if res.rowcount:
        await db.execute(update(Album).where(Album.id == album_id).values(photo_count=func.greatest(Album.photo_count - 1, 0)))
        await db.execute(update(Album).where(Album.id == album_id, Album.cover_id == media_id).values(cover_id=None))
    return {"data": {"ok": True}}


class PublishIn(BaseModel):
    published: bool


@admin.post("/{album_id}/publish", summary="Publish or unpublish")
async def publish(
    album_id: uuid.UUID,
    body: PublishIn,
    request: Request,
    me: Principal = Depends(require("gallery.publish")),
    db: AsyncSession = Depends(get_db),
):
    a = await _album(db, album_id)
    if body.published and not a.photo_count:
        raise AppError(409, "EMPTY_ALBUM", "Add photos before publishing.")
    a.status = "published" if body.published else "draft"
    a.published_at = a.published_at or (datetime.now(UTC) if body.published else None)
    await record(
        db,
        actor_id=me.id,
        action="publish" if body.published else "unpublish",
        entity="album",
        entity_id=a.id,
        summary=f"Album {a.title}: {a.status}",
        ip=client_ip(request),
    )
    return {"data": await album_out(db, a)}


@admin.delete("/{album_id}", summary="Delete an album")
async def delete_album(
    album_id: uuid.UUID, request: Request, me: Principal = Depends(require("gallery.delete")), db: AsyncSession = Depends(get_db)
):
    a = await _album(db, album_id)
    await db.delete(a)
    await record(
        db, actor_id=me.id, action="delete", entity="album", entity_id=album_id, summary=f"Deleted album {a.title}", ip=client_ip(request)
    )
    return {"data": {"ok": True}}
