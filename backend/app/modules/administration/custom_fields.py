"""Custom field builder (admin), definitions for forms (members and registration), private file values."""

import re
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, File, Query, UploadFile
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.audit import record
from ...core.db import get_db
from ...core.deps import Principal, require
from ...core.errors import AppError, not_found
from ...models import AlumniProfile, CustomField, Donation, Event, JobPost, Media, Mentor
from ...services import custom_fields as cf
from ...services import media

admin = APIRouter(prefix="/api/v1/admin/custom-fields", tags=["Admin: custom fields"])
router = APIRouter(prefix="/api/v1/custom-fields", tags=["Custom fields"])
public = APIRouter(prefix="/api/v1/public/custom-fields", tags=["Public"])

Entity = Literal["alumni_profile", "job_post", "event", "mentor", "donation"]
KEY = r"^[a-z][a-z0-9_]{1,59}$"


class OptionIn(BaseModel):
    value: str = Field(..., min_length=1, max_length=100)
    label: str = Field(..., min_length=1, max_length=150)


class ConditionIn(BaseModel):
    field: str = Field(..., pattern=KEY)
    operator: Literal["equals", "not_equals", "in", "filled"] = "equals"
    value: str | list[str] | None = None


class ValidationIn(BaseModel):
    min_length: int | None = Field(None, ge=0, le=5000)
    max_length: int | None = Field(None, ge=1, le=5000)
    min: float | str | None = None  # number, date (YYYY-MM-DD) or minimum choices
    max: float | str | None = None
    pattern: str | None = Field(None, max_length=200)
    message: str | None = Field(None, max_length=200)

    @field_validator("pattern")
    @classmethod
    def _pattern(cls, v: str | None) -> str | None:
        if v:
            try:
                re.compile(v)
            except re.error as e:
                raise ValueError(f"Not a valid pattern: {e}") from e
        return v or None


class FieldIn(BaseModel):
    entity: Entity
    key: str = Field(..., pattern=KEY, description="Stable machine name, e.g. 'blood_group'. Cannot change later.")
    label: str = Field(..., min_length=1, max_length=150)
    labels: dict[str, str] = Field(default_factory=dict)
    help_text: str = Field("", max_length=300)
    type: Literal["text", "textarea", "number", "email", "phone", "date", "select", "multiselect", "checkbox", "radio", "file", "url"]
    options: list[OptionIn] = Field(default_factory=list, max_length=100)
    required: bool = False
    visibility: Literal["public", "members", "connections", "private"] = "members"
    validation: ValidationIn = Field(default_factory=ValidationIn)
    condition: ConditionIn | None = None
    on_registration: bool = False
    active: bool = True

    @model_validator(mode="after")
    def _rules(self):
        if self.type in cf.CHOICE_TYPES and not self.options:
            raise ValueError("Add at least one option.")
        if len({o.value for o in self.options}) != len(self.options):
            raise ValueError("Option values must be unique.")
        if self.on_registration and (self.entity != "alumni_profile" or self.type == "file"):
            raise ValueError("Only alumni profile fields (not file uploads) can be asked during registration.")
        if self.condition and self.condition.field == self.key:
            raise ValueError("A field cannot depend on itself.")
        self.labels = {k: v.strip()[:150] for k, v in self.labels.items() if re.fullmatch(r"[a-z]{2}(-[A-Z]{2})?", k) and v.strip()}
        return self


async def _get(db: AsyncSession, field_id: uuid.UUID) -> CustomField:
    f = await db.get(CustomField, field_id)
    if not f:
        raise not_found("Field")
    return f


async def _check_condition(db: AsyncSession, body: FieldIn) -> None:
    if body.condition:
        other = (
            await db.execute(select(CustomField).where(CustomField.entity == body.entity, CustomField.key == body.condition.field))
        ).scalar_one_or_none()
        if not other:
            raise AppError(
                422,
                "VALIDATION_ERROR",
                "The condition refers to a field that does not exist.",
                [{"field": "condition.field", "message": "Choose another field of the same form."}],
            )


def _apply(f: CustomField, body: FieldIn) -> None:
    f.label, f.labels, f.help_text, f.field_type = body.label, body.labels, body.help_text, body.type
    f.options = [o.model_dump() for o in body.options] if body.type in cf.CHOICE_TYPES else []
    f.required, f.visibility, f.on_registration, f.active = body.required, body.visibility, body.on_registration, body.active
    f.validation = body.validation.model_dump(exclude_none=True)
    f.condition = body.condition.model_dump() if body.condition else None


@admin.get("", summary="List custom fields of a form")
async def list_fields(
    entity: Entity | None = None, _: Principal = Depends(require("custom_fields.view")), db: AsyncSession = Depends(get_db)
):
    stmt = select(CustomField).order_by(CustomField.entity, CustomField.position, CustomField.created_at)
    if entity:
        stmt = stmt.where(CustomField.entity == entity)
    rows = (await db.execute(stmt)).scalars().all()
    return {"data": [cf.definition_out(f) for f in rows], "meta": {"entities": cf.ENTITIES, "types": cf.TYPES}}


@admin.post("", status_code=201, summary="Add a custom field")
async def create_field(body: FieldIn, me: Principal = Depends(require("custom_fields.configure")), db: AsyncSession = Depends(get_db)):
    exists = (await db.execute(select(CustomField.id).where(CustomField.entity == body.entity, CustomField.key == body.key))).first()
    if exists:
        raise AppError(
            409, "DUPLICATE_KEY", "A field with this key already exists on this form.", [{"field": "key", "message": "Choose another key."}]
        )
    await _check_condition(db, body)
    pos = (
        await db.execute(select(func.coalesce(func.max(CustomField.position), -1)).where(CustomField.entity == body.entity))
    ).scalar_one()
    f = CustomField(entity=body.entity, key=body.key, position=pos + 1)
    _apply(f, body)
    db.add(f)
    await db.flush()
    await record(
        db,
        actor_id=me.id,
        action="create",
        entity="custom_field",
        entity_id=f.id,
        summary=f"Added custom field '{f.label}' to {cf.ENTITIES[f.entity]}",
    )
    await db.commit()
    return {"data": cf.definition_out(f)}


class OrderIn(BaseModel):
    entity: Entity
    ids: list[uuid.UUID] = Field(..., max_length=500)


@admin.put("/order", summary="Reorder the fields of a form")
async def reorder(body: OrderIn, me: Principal = Depends(require("custom_fields.configure")), db: AsyncSession = Depends(get_db)):
    rows = {f.id: f for f in (await db.execute(select(CustomField).where(CustomField.entity == body.entity))).scalars()}
    for i, fid in enumerate(body.ids):
        if fid in rows:
            rows[fid].position = i
    await record(db, actor_id=me.id, action="update", entity="custom_field", summary=f"Reordered {cf.ENTITIES[body.entity]} fields")
    await db.commit()
    return {"data": {"ok": True}}


@admin.put("/{field_id}", summary="Edit a custom field (its key and form cannot change)")
async def update_field(
    field_id: uuid.UUID, body: FieldIn, me: Principal = Depends(require("custom_fields.configure")), db: AsyncSession = Depends(get_db)
):
    f = await _get(db, field_id)
    if body.key != f.key or body.entity != f.entity:
        raise AppError(422, "KEY_LOCKED", "The key and form of a field cannot change — stored answers use them.")
    await _check_condition(db, body)
    _apply(f, body)
    await record(db, actor_id=me.id, action="update", entity="custom_field", entity_id=f.id, summary=f"Edited custom field '{f.label}'")
    await db.commit()
    return {"data": cf.definition_out(f)}


@admin.delete("/{field_id}", summary="Delete a custom field (stored answers are kept but no longer shown)")
async def delete_field(
    field_id: uuid.UUID, me: Principal = Depends(require("custom_fields.configure")), db: AsyncSession = Depends(get_db)
):
    f = await _get(db, field_id)
    dependants = (
        (await db.execute(select(CustomField.label).where(CustomField.entity == f.entity, CustomField.condition["field"].astext == f.key)))
        .scalars()
        .all()
    )
    if dependants:
        raise AppError(409, "FIELD_IN_USE", f"Other fields depend on this one: {', '.join(dependants)}. Change their conditions first.")
    await record(db, actor_id=me.id, action="delete", entity="custom_field", entity_id=f.id, summary=f"Deleted custom field '{f.label}'")
    await db.delete(f)
    await db.commit()
    return {"data": {"ok": True}}


# ── forms ───────────────────────────────────────────────────────────────────
@public.get("/registration", summary="Extra questions asked on the registration form")
async def registration_fields(lang: str | None = Query(None, max_length=10), db: AsyncSession = Depends(get_db)):
    return {"data": [cf.definition_out(f, lang) for f in await cf.definitions(db, "alumni_profile", registration=True)]}


@router.get("/{entity}", summary="Active custom fields of a form")
async def form_fields(
    entity: Entity,
    lang: str | None = Query(None, max_length=10),
    _: Principal = Depends(require("portal.access")),
    db: AsyncSession = Depends(get_db),
):
    return {"data": [cf.definition_out(f, lang) for f in await cf.definitions(db, entity)]}


@router.post("/files", status_code=201, summary="Upload a file for a file field (kept private)")
async def upload_file(file: UploadFile = File(...), me: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    m = await media.upload(db, data=await file.read(), filename=file.filename or "file", folder="custom-fields", actor=me.id, private=True)
    await db.commit()
    return {"data": {"id": str(m.id), "filename": m.filename, "size": m.size, "mime": m.mime}}


# who may open a file value: owner, staff of that area, or the field's visibility
OWNERS = {
    "alumni_profile": (AlumniProfile, "user_id", "alumni.view"),
    "job_post": (JobPost, "posted_by", "jobs.view"),
    "event": (Event, "created_by", "events.view"),
    "mentor": (Mentor, "user_id", "mentorship.view"),
    "donation": (Donation, "user_id", "donations.view"),
}


@router.get("/{entity}/{record_id}/{key}/file", summary="Open a file attached to a custom field")
async def open_file(
    entity: Entity, record_id: uuid.UUID, key: str, me: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)
):
    model, owner_col, staff_perm = OWNERS[entity]
    rec = await db.get(model, record_id)
    f = (
        await db.execute(select(CustomField).where(CustomField.entity == entity, CustomField.key == key, CustomField.field_type == "file"))
    ).scalar_one_or_none()
    value = (rec.custom_fields or {}).get(key) if rec else None
    if not rec or not f or not value:
        raise not_found("File")
    owner = getattr(rec, owner_col, None) == me.id
    level = "owner" if owner or me.can(staff_perm) else "member"
    if entity == "alumni_profile" and level == "member":
        from ..alumni.service import connected_ids

        if rec.user_id in await connected_ids(db, me.id, [rec.user_id]):
            level = "connection"
        if rec.visibility == "hidden":
            raise not_found("File")
    if entity == "donation" and level != "owner":
        raise not_found("File")  # donor details are finance-only
    if f.visibility not in cf.LEVELS[level]:
        raise not_found("File")
    m = await db.get(Media, uuid.UUID(value))
    if not m or m.deleted_at:
        raise not_found("File")
    return media.download_response(m, await media.read(db, m))
