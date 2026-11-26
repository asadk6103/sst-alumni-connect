"""Resource hub: members browse, save, download and share resources; staff review uploads and curate collections."""

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, File, Query, UploadFile
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.deps import Principal, require, require_module
from ...core.errors import AppError, conflict, forbidden, not_found
from ...core.pagination import PageParams, page_params
from ...core.redis import enforce
from ...models import Media, Resource, ResourceCollection, ResourceCollectionItem, ResourceDownload, ResourceSave
from ...services import live, media, notifications
from ..community.service import authors

router = APIRouter(prefix="/api/v1/resources", tags=["Resources"], dependencies=[Depends(require_module("resources"))])
admin = APIRouter(prefix="/api/v1/admin/resources", tags=["Admin: resources"])
reader = require("portal.access", "resources.view", any_of=True)
CATEGORIES = Literal["career", "higher_studies", "scholarships", "publications", "archives", "forms", "guides", "videos"]
FILE_TYPES = ("pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "txt", "csv", "mp4", "webm", "mov")
TYPE_OF = {"docx": "doc", "pptx": "ppt", "xlsx": "xls", "webm": "video", "mov": "video", "mp4": "video"}


def _meta(p: PageParams, total: int) -> dict:
    return {"page": p.page, "page_size": p.page_size, "total": total, "pages": max(1, -(-total // p.page_size))}


async def resource_out(db: AsyncSession, me: Principal, r: Resource, saved: set | None = None, people: dict | None = None) -> dict:
    url = r.url
    if r.media_id and (m := await db.get(Media, r.media_id)) and not m.deleted_at:
        url = (await media.to_public(db, m))["url"]
    people = people if people is not None else await authors(db, {r.uploaded_by})
    mine = r.uploaded_by == me.id
    return {
        "id": str(r.id),
        "title": r.title,
        "description": r.description,
        "category": r.category,
        "kind": r.kind,
        "file_type": r.file_type,
        "size": r.size,
        "status": r.status,
        "rejection_reason": r.rejection_reason if (mine or me.can("resources.view")) else None,
        "featured": r.featured,
        "downloads": r.downloads,
        "uploaded_by": people.get(r.uploaded_by),
        "created_at": r.created_at,
        "updated_at": r.updated_at,
        "saved": r.id in (saved if saved is not None else await _saved(db, me, [r.id])),
        "is_mine": mine,
        # the file link is only handed out through /download (which counts it); links and videos are open
        "url": url if r.kind != "file" else None,
    }


async def _saved(db: AsyncSession, me: Principal, ids: list) -> set:
    if not ids:
        return set()
    return set(
        (
            await db.execute(select(ResourceSave.resource_id).where(ResourceSave.user_id == me.id, ResourceSave.resource_id.in_(ids)))
        ).scalars()
    )


async def _visible(db: AsyncSession, me: Principal, resource_id: uuid.UUID) -> Resource:
    r = await db.get(Resource, resource_id)
    if not r or (r.status != "published" and r.uploaded_by != me.id and not me.can("resources.view")):
        raise not_found("Resource")
    return r


async def _many(db: AsyncSession, me: Principal, rows: list[Resource]) -> list[dict]:
    saved = await _saved(db, me, [r.id for r in rows])
    people = await authors(db, {r.uploaded_by for r in rows})
    return [await resource_out(db, me, r, saved, people) for r in rows]


@router.get("", summary="Browse resources")
async def list_resources(
    q: str | None = Query(None, max_length=100),
    category: CATEGORIES | None = None,
    scope: Literal["all", "saved", "uploads", "downloads"] = "all",
    featured: bool | None = None,
    sort: Literal["recent", "popular"] = "recent",
    p: PageParams = Depends(page_params),
    me: Principal = Depends(reader),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Resource)
    if scope == "uploads":
        stmt = stmt.where(Resource.uploaded_by == me.id)
    else:
        stmt = stmt.where(Resource.status == "published")
        if scope == "saved":
            stmt = stmt.join(ResourceSave, (ResourceSave.resource_id == Resource.id) & (ResourceSave.user_id == me.id))
        elif scope == "downloads":
            stmt = stmt.join(ResourceDownload, (ResourceDownload.resource_id == Resource.id) & (ResourceDownload.user_id == me.id))
    if category:
        stmt = stmt.where(Resource.category == category)
    if featured is not None:
        stmt = stmt.where(Resource.featured.is_(featured))
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Resource.title).like(like), func.lower(Resource.description).like(like), func.lower(Resource.category).like(like)
            )
        )
    order = [Resource.downloads.desc()] if sort == "popular" else []
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        (await db.execute(stmt.order_by(*order, Resource.created_at.desc()).offset((p.page - 1) * p.page_size).limit(p.page_size)))
        .scalars()
        .all()
    )
    return {"data": await _many(db, me, list(rows)), "meta": _meta(p, total)}


@router.get("/summary", summary="Your counts and items per category")
async def summary(me: Principal = Depends(reader), db: AsyncSession = Depends(get_db)):
    async def count(model, *where) -> int:
        return (await db.execute(select(func.count()).select_from(model).where(*where))).scalar_one()

    cats = dict(
        (await db.execute(select(Resource.category, func.count()).where(Resource.status == "published").group_by(Resource.category))).all()
    )
    return {
        "data": {
            "downloads": await count(ResourceDownload, ResourceDownload.user_id == me.id),
            "saved": await count(ResourceSave, ResourceSave.user_id == me.id),
            "uploads": await count(Resource, Resource.uploaded_by == me.id),
            "categories": cats,
            "can_upload": me.can("portal.resources.upload") or me.can("resources.create"),
        }
    }


@router.get("/collections", summary="Curated collections")
async def collections(me: Principal = Depends(reader), db: AsyncSession = Depends(get_db)):
    rows = (
        await db.execute(
            select(ResourceCollection, func.count(Resource.id))
            .outerjoin(ResourceCollectionItem, ResourceCollectionItem.collection_id == ResourceCollection.id)
            .outerjoin(Resource, (Resource.id == ResourceCollectionItem.resource_id) & (Resource.status == "published"))
            .where(ResourceCollection.published.is_(True))
            .group_by(ResourceCollection.id)
            .order_by(ResourceCollection.position, ResourceCollection.title)
        )
    ).all()
    return {"data": [_collection_out(c, n) for c, n in rows]}


def _collection_out(c: ResourceCollection, n: int | None = None) -> dict:
    return {
        "id": str(c.id),
        "title": c.title,
        "subtitle": c.subtitle,
        "icon": c.icon,
        "position": c.position,
        "published": c.published,
        "count": n,
    }


@router.get("/collections/{collection_id}", summary="One collection and its resources")
async def collection(collection_id: uuid.UUID, me: Principal = Depends(reader), db: AsyncSession = Depends(get_db)):
    c = await db.get(ResourceCollection, collection_id)
    if not c or (not c.published and not me.can("resources.view")):
        raise not_found("Collection")
    rows = (
        (
            await db.execute(
                select(Resource)
                .join(ResourceCollectionItem, ResourceCollectionItem.resource_id == Resource.id)
                .where(ResourceCollectionItem.collection_id == c.id, Resource.status == "published")
                .order_by(ResourceCollectionItem.position)
            )
        )
        .scalars()
        .all()
    )
    return {"data": {**_collection_out(c, len(rows)), "resources": await _many(db, me, list(rows))}}


@router.get("/{resource_id}", summary="One resource")
async def get_resource(resource_id: uuid.UUID, me: Principal = Depends(reader), db: AsyncSession = Depends(get_db)):
    return {"data": await resource_out(db, me, await _visible(db, me, resource_id))}


@router.post("/{resource_id}/download", summary="Download or open a resource (counted)")
async def download(resource_id: uuid.UUID, me: Principal = Depends(reader), db: AsyncSession = Depends(get_db)):
    r = await _visible(db, me, resource_id)
    url = r.url
    if r.media_id and (m := await db.get(Media, r.media_id)) and not m.deleted_at:
        url = (await media.to_public(db, m))["url"]
    if not url:
        raise not_found("File")
    await db.execute(update(Resource).where(Resource.id == r.id).values(downloads=Resource.downloads + 1))
    row = await db.get(ResourceDownload, (me.id, r.id))
    if row:
        row.last_at = func.now()
    else:
        db.add(ResourceDownload(user_id=me.id, resource_id=r.id))
    return {"data": {"url": url, "filename": f"{r.title}.{r.file_type}" if r.kind == "file" and r.file_type else None}}


@router.put("/{resource_id}/save", summary="Save a resource")
async def save(resource_id: uuid.UUID, me: Principal = Depends(reader), db: AsyncSession = Depends(get_db)):
    r = await _visible(db, me, resource_id)
    if not await db.get(ResourceSave, (me.id, r.id)):
        db.add(ResourceSave(user_id=me.id, resource_id=r.id))
    return {"data": {"saved": True}}


@router.delete("/{resource_id}/save", summary="Remove a saved resource")
async def unsave(resource_id: uuid.UUID, me: Principal = Depends(reader), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(ResourceSave).where(ResourceSave.user_id == me.id, ResourceSave.resource_id == resource_id))
    return {"data": {"saved": False}}


@router.post("/uploads", status_code=201, summary="Upload a file for a resource (documents or video)")
async def upload(
    file: UploadFile = File(...),
    me: Principal = Depends(require("portal.resources.upload", "resources.create", any_of=True)),
    db: AsyncSession = Depends(get_db),
):
    await enforce(f"resource-upload:{me.id}", 30, 3600)
    name = file.filename or "file"
    ext = name.lower().rsplit(".", 1)[-1]
    if ext not in FILE_TYPES:
        raise AppError(415, "FILE_TYPE_NOT_ALLOWED", "Upload a PDF, Word, PowerPoint, Excel, text or video file.")
    m = await media.upload(db, data=await file.read(), filename=name, folder="resources", actor=me.id, extra_types=FILE_TYPES)
    return {"data": {"id": str(m.id), "filename": m.filename, "size": m.size, "file_type": TYPE_OF.get(ext, ext)}}


class ResourceIn(BaseModel):
    title: str = Field(..., min_length=3, max_length=200)
    description: str = Field("", max_length=5000)
    category: CATEGORIES
    kind: Literal["file", "link", "video"] = "file"
    media_id: uuid.UUID | None = None
    url: str | None = Field(None, max_length=500)

    @field_validator("url")
    @classmethod
    def _url(cls, v):
        if v and not v.strip().lower().startswith(("https://", "http://")):
            raise ValueError("Enter a full link starting with https://")
        return v.strip() if v else None

    @model_validator(mode="after")
    def _source(self):
        if self.kind == "file" and not self.media_id:
            raise ValueError("Upload the file first.")
        if self.kind != "file" and not self.url:
            raise ValueError("Enter the link.")
        return self


async def _apply(db: AsyncSession, me: Principal, r: Resource, body: ResourceIn) -> None:
    r.title, r.description, r.category, r.kind = body.title.strip(), body.description.strip(), body.category, body.kind
    if body.kind == "file":
        m = await db.get(Media, body.media_id)
        if not m or m.deleted_at or (m.uploaded_by != me.id and not me.can("resources.edit")):
            raise AppError(422, "INVALID_MEDIA", "Upload the file again.")
        ext = m.filename.lower().rsplit(".", 1)[-1]
        r.media_id, r.url, r.size, r.file_type = m.id, None, m.size, TYPE_OF.get(ext, ext)
    else:
        r.media_id, r.size, r.url = None, None, body.url
        r.file_type = "video" if body.kind == "video" else "link"


@router.post("", status_code=201, summary="Share a resource (reviewed before it is listed)")
async def create(
    body: ResourceIn,
    me: Principal = Depends(require("portal.resources.upload", "resources.create", any_of=True)),
    db: AsyncSession = Depends(get_db),
):
    await enforce(f"resource-create:{me.id}", 20, 86400, "You have shared many resources today.")
    auto = me.can("resources.approve")
    r = Resource(uploaded_by=me.id, status="published" if auto else "pending", downloads=0)
    await _apply(db, me, r, body)
    db.add(r)
    await db.flush()
    await db.refresh(r)
    if not auto:
        live.emit_to_room(db, "admin:alumni_admin", "moderation:resource", {"id": str(r.id)})
    return {"data": await resource_out(db, me, r)}


@router.put("/{resource_id}", summary="Edit your resource (goes back to review)")
async def edit(resource_id: uuid.UUID, body: ResourceIn, me: Principal = Depends(reader), db: AsyncSession = Depends(get_db)):
    r = await db.get(Resource, resource_id)
    if not r:
        raise not_found("Resource")
    staff = me.can("resources.edit")
    if r.uploaded_by != me.id and not staff:
        raise forbidden()
    await _apply(db, me, r, body)
    if not staff and not me.can("resources.approve"):
        r.status, r.rejection_reason = "pending", None
    await db.flush()
    await db.refresh(r)
    return {"data": await resource_out(db, me, r)}


@router.delete("/{resource_id}", summary="Delete your resource")
async def remove(resource_id: uuid.UUID, me: Principal = Depends(reader), db: AsyncSession = Depends(get_db)):
    r = await db.get(Resource, resource_id)
    if not r:
        raise not_found("Resource")
    if r.uploaded_by != me.id and not me.can("resources.delete"):
        raise forbidden()
    await db.delete(r)
    return {"data": {"ok": True}}


# ── staff ───────────────────────────────────────────────────────────────────
@admin.get("", summary="All resources (review queue)")
async def admin_list(
    status: Literal["pending", "published", "rejected"] | None = None,
    q: str | None = Query(None, max_length=100),
    p: PageParams = Depends(page_params),
    me: Principal = Depends(require("resources.view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Resource)
    if status:
        stmt = stmt.where(Resource.status == status)
    if q:
        stmt = stmt.where(func.lower(Resource.title).like(f"%{q.strip().lower()}%"))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        (await db.execute(stmt.order_by(Resource.created_at.desc()).offset((p.page - 1) * p.page_size).limit(p.page_size))).scalars().all()
    )
    data = await _many(db, me, list(rows))
    for d, r in zip(data, rows, strict=True):
        if r.kind == "file" and r.media_id and (m := await db.get(Media, r.media_id)):
            d["url"] = (await media.to_public(db, m))["url"]
    counts = dict((await db.execute(select(Resource.status, func.count()).group_by(Resource.status))).all())
    return {"data": data, "meta": {**_meta(p, total), "counts": counts}}


class Decision(BaseModel):
    approve: bool
    reason: str | None = Field(None, max_length=300)


@admin.post("/{resource_id}/decide", summary="Approve or reject a shared resource")
async def decide(
    resource_id: uuid.UUID, body: Decision, me: Principal = Depends(require("resources.approve")), db: AsyncSession = Depends(get_db)
):
    r = await db.get(Resource, resource_id)
    if not r:
        raise not_found("Resource")
    if not body.approve and not body.reason:
        raise AppError(
            422, "VALIDATION_ERROR", "Give a reason so the member can correct it.", [{"field": "reason", "message": "Required."}]
        )
    r.status, r.rejection_reason = ("published", None) if body.approve else ("rejected", body.reason)
    if r.uploaded_by and r.uploaded_by != me.id:
        await notifications.notify(
            db,
            r.uploaded_by,
            "community",
            "resource_approved" if body.approve else "resource_rejected",
            f"Your resource “{r.title}” was {'published' if body.approve else 'not approved'}",
            body=body.reason or "",
            link="/portal/resources?scope=uploads",
        )
    return {"data": await resource_out(db, me, r)}


class FeatureIn(BaseModel):
    featured: bool


@admin.post("/{resource_id}/feature", summary="Feature a resource on the hub")
async def feature(
    resource_id: uuid.UUID, body: FeatureIn, me: Principal = Depends(require("resources.edit")), db: AsyncSession = Depends(get_db)
):
    r = await db.get(Resource, resource_id)
    if not r:
        raise not_found("Resource")
    if body.featured and r.status != "published":
        raise conflict("NOT_PUBLISHED", "Publish the resource before featuring it.")
    r.featured = body.featured
    return {"data": await resource_out(db, me, r)}


class CollectionIn(BaseModel):
    title: str = Field(..., min_length=2, max_length=150)
    subtitle: str = Field("", max_length=300)
    icon: Literal["briefcase", "graduation", "archive", "video", "folder", "award", "book"] = "folder"
    position: int = Field(0, ge=0, le=1000)
    published: bool = True
    resource_ids: list[uuid.UUID] = Field(default_factory=list, max_length=200)


@admin.get("/collections", summary="All collections with their resources")
async def admin_collections(me: Principal = Depends(require("resources.view")), db: AsyncSession = Depends(get_db)):
    out = []
    for c in (await db.execute(select(ResourceCollection).order_by(ResourceCollection.position, ResourceCollection.title))).scalars():
        ids = (
            await db.execute(
                select(ResourceCollectionItem.resource_id)
                .where(ResourceCollectionItem.collection_id == c.id)
                .order_by(ResourceCollectionItem.position)
            )
        ).scalars()
        out.append({**_collection_out(c), "resource_ids": [str(i) for i in ids]})
    return {"data": out}


async def _save_collection(db: AsyncSession, c: ResourceCollection, body: CollectionIn) -> dict:
    c.title, c.subtitle, c.icon, c.position, c.published = (
        body.title.strip(),
        body.subtitle.strip(),
        body.icon,
        body.position,
        body.published,
    )
    await db.flush()
    await db.execute(delete(ResourceCollectionItem).where(ResourceCollectionItem.collection_id == c.id))
    found = set((await db.execute(select(Resource.id).where(Resource.id.in_(body.resource_ids or [uuid.UUID(int=0)])))).scalars())
    for i, rid in enumerate(dict.fromkeys(body.resource_ids)):
        if rid in found:
            db.add(ResourceCollectionItem(collection_id=c.id, resource_id=rid, position=i))
    await db.flush()
    return {**_collection_out(c, len(found)), "resource_ids": [str(r) for r in dict.fromkeys(body.resource_ids) if r in found]}


@admin.post("/collections", status_code=201, summary="Create a collection")
async def create_collection(body: CollectionIn, me: Principal = Depends(require("resources.create")), db: AsyncSession = Depends(get_db)):
    c = ResourceCollection()
    db.add(c)
    return {"data": await _save_collection(db, c, body)}


@admin.put("/collections/{collection_id}", summary="Edit a collection")
async def edit_collection(
    collection_id: uuid.UUID, body: CollectionIn, me: Principal = Depends(require("resources.edit")), db: AsyncSession = Depends(get_db)
):
    c = await db.get(ResourceCollection, collection_id)
    if not c:
        raise not_found("Collection")
    return {"data": await _save_collection(db, c, body)}


@admin.delete("/collections/{collection_id}", summary="Delete a collection (its resources stay)")
async def delete_collection(
    collection_id: uuid.UUID, me: Principal = Depends(require("resources.delete")), db: AsyncSession = Depends(get_db)
):
    c = await db.get(ResourceCollection, collection_id)
    if not c:
        raise not_found("Collection")
    await db.delete(c)
    return {"data": {"ok": True}}
