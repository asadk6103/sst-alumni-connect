import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.audit import record
from ...core.db import get_db
from ...core.deps import Principal, client_ip, require
from ...core.errors import not_found
from ...core.pagination import PageParams, page_params, paginate
from ...models import Media
from ...services import media

router = APIRouter(prefix="/api/v1/admin/media", tags=["Admin: media library"])


@router.get("", summary="Browse the media library")
async def list_media(q: str | None = Query(None, max_length=100), folder: str | None = Query(None, max_length=60),
                     kind: str | None = Query(None, pattern="^(image|document)$"), p: PageParams = Depends(page_params),
                     _: Principal = Depends(require("media.view")), db: AsyncSession = Depends(get_db)):
    stmt = select(Media).where(Media.deleted_at.is_(None))
    if q:
        stmt = stmt.where(Media.filename.ilike(f"%{q}%") | Media.alt.ilike(f"%{q}%"))
    if folder:
        stmt = stmt.where(Media.folder == folder)
    if kind == "image":
        stmt = stmt.where(Media.mime.like("image/%"))
    elif kind == "document":
        stmt = stmt.where(~Media.mime.like("image/%"))
    rows, meta = await paginate(db, stmt.order_by(Media.created_at.desc(), Media.id), p)
    return {"data": [await media.to_public(db, m) for m in rows], "meta": meta}


@router.post("", status_code=201, summary="Upload a file")
async def upload(request: Request, file: UploadFile = File(...), folder: str = Form("general", max_length=60),
                 alt: str = Form("", max_length=300), images_only: bool = Form(False),
                 me: Principal = Depends(require("media.create")), db: AsyncSession = Depends(get_db)):
    data = await file.read()
    m = await media.upload(db, data=data, filename=file.filename or "upload", folder=folder, alt=alt,
                           images_only=images_only, actor=me.id)
    await record(db, actor_id=me.id, action="upload", entity="media", entity_id=m.id, summary=f"Uploaded {m.filename}",
                 ip=client_ip(request))
    return {"data": await media.to_public(db, m)}


class MediaUpdate(BaseModel):
    alt: str = Field("", max_length=300)


@router.patch("/{media_id}", summary="Edit alternative text")
async def update(media_id: uuid.UUID, body: MediaUpdate, _: Principal = Depends(require("media.edit")),
                 db: AsyncSession = Depends(get_db)):
    m = await db.get(Media, media_id)
    if not m or m.deleted_at:
        raise not_found("File")
    m.alt = body.alt
    return {"data": await media.to_public(db, m)}


@router.delete("/{media_id}", summary="Delete a file (kept in storage until purged)")
async def delete(media_id: uuid.UUID, request: Request, me: Principal = Depends(require("media.delete")),
                 db: AsyncSession = Depends(get_db)):
    m = await db.get(Media, media_id)
    if not m or m.deleted_at:
        raise not_found("File")
    m.deleted_at = datetime.now(UTC)
    await record(db, actor_id=me.id, action="delete", entity="media", entity_id=m.id, summary=f"Deleted {m.filename}",
                 ip=client_ip(request))
    return {"data": {"ok": True}}
