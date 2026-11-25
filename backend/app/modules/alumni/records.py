"""Institutional student records: CSV import (with dry run), matching, invitations."""

import csv
import io
import re
import uuid
from datetime import UTC, date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from pydantic import BaseModel, EmailStr, Field, TypeAdapter, ValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.audit import record
from ...core.db import get_db
from ...core.deps import Principal, client_ip, require
from ...core.errors import AppError, not_found
from ...core.pagination import PageParams, csv_response, page_params
from ...models import AlumniProfile, Batch, StudentRecord, User
from . import service as svc
from .admin import _invite_email, _new_member

router = APIRouter(prefix="/api/v1/admin/student-records", tags=["Admin: student records"])

MAX_BYTES = 5 * 1024 * 1024
MAX_ROWS = 20000
COLUMNS = {
    "registration_no": ("registration no", "registration number", "reg no", "reg. no.", "admission no", "roll no", "gr no"),
    "full_name": ("name", "student name", "full name"),
    "father_name": ("father name", "father's name", "guardian name"),
    "date_of_birth": ("dob", "date of birth", "birth date"),
    "gender": ("sex",),
    "admission_year": ("admission year", "year of admission"),
    "graduation_year": ("graduation year", "passing year", "year of passing", "batch year"),
    "class_name": ("class", "section", "class / section"),
    "batch": ("batch name",),
    "email": ("email address", "e-mail"),
    "phone": ("mobile", "mobile number", "phone number", "contact"),
}
HEADER = [
    "registration_no",
    "full_name",
    "father_name",
    "date_of_birth",
    "gender",
    "admission_year",
    "graduation_year",
    "class_name",
    "batch",
    "email",
    "phone",
]
_email = TypeAdapter(EmailStr)


def _key(h: str) -> str | None:
    h = re.sub(r"[_\s]+", " ", h.strip().lower().lstrip("﻿"))
    for k, aliases in COLUMNS.items():
        if h == k.replace("_", " ") or h in aliases:
            return k
    return None


def _date(v: str) -> date | None:
    v = v.strip()
    if not v:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(v, fmt).date()
        except ValueError:
            pass
    raise ValueError("date of birth must look like 2001-03-25 or 25/03/2001")


def _year(v: str, label: str) -> int | None:
    v = v.strip()
    if not v:
        return None
    if not re.fullmatch(r"\d{4}", v) or not 1900 <= int(v) <= 2100:
        raise ValueError(f"{label} must be a 4-digit year")
    return int(v)


def _gender(v: str) -> str | None:
    v = v.strip().lower()
    return {"m": "male", "male": "male", "f": "female", "female": "female", "other": "other"}.get(v) if v else None


def _record_out(r: StudentRecord, batch: str | None, member: str | None) -> dict:
    return {
        "id": str(r.id),
        "registration_no": r.registration_no,
        "full_name": r.full_name,
        "father_name": r.father_name,
        "date_of_birth": r.date_of_birth,
        "gender": r.gender,
        "admission_year": r.admission_year,
        "graduation_year": r.graduation_year,
        "class_name": r.class_name,
        "batch": batch,
        "email": r.email,
        "phone": r.phone,
        "matched_user_id": str(r.matched_user_id) if r.matched_user_id else None,
        "member": member,
        "invited_at": r.invited_at,
        "source": r.source,
        "created_at": r.created_at,
    }


@router.get("", summary="Browse imported student records")
async def list_records(
    q: str | None = Query(None, max_length=100),
    year: int | None = Query(None, ge=1900, le=2100),
    state: Literal["matched", "unmatched", "invited"] | None = None,
    p: PageParams = Depends(page_params),
    _: Principal = Depends(require("alumni.view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(StudentRecord, Batch.name, User.full_name)
        .outerjoin(Batch, Batch.id == StudentRecord.batch_id)
        .outerjoin(User, User.id == StudentRecord.matched_user_id)
    )
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(StudentRecord.full_name).like(like),
                func.lower(StudentRecord.registration_no).like(like),
                func.lower(StudentRecord.email).like(like),
                StudentRecord.reg_norm == (svc.norm_reg(q) or ""),
            )
        )
    if year:
        stmt = stmt.where(StudentRecord.graduation_year == year)
    if state == "matched":
        stmt = stmt.where(StudentRecord.matched_user_id.is_not(None))
    elif state == "unmatched":
        stmt = stmt.where(StudentRecord.matched_user_id.is_(None))
    elif state == "invited":
        stmt = stmt.where(StudentRecord.invited_at.is_not(None))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        await db.execute(
            stmt.order_by(StudentRecord.graduation_year.desc().nulls_last(), StudentRecord.full_name)
            .offset((p.page - 1) * p.page_size)
            .limit(p.page_size)
        )
    ).all()
    summary = (
        await db.execute(
            select(func.count(), func.count(StudentRecord.matched_user_id), func.count(StudentRecord.invited_at)).select_from(StudentRecord)
        )
    ).one()
    return {
        "data": [_record_out(r, b, m) for r, b, m in rows],
        "meta": {
            "page": p.page,
            "page_size": p.page_size,
            "total": total,
            "pages": max(1, -(-total // p.page_size)),
            "summary": {"records": summary[0], "matched": summary[1], "invited": summary[2]},
        },
    }


@router.get("/template", summary="CSV template for the import")
async def template(_: Principal = Depends(require("alumni.create"))):
    return csv_response(
        "student-records-template.csv",
        HEADER,
        [
            [
                "SST-2010-0412",
                "Ayesha Khan",
                "Imran Khan",
                "1998-04-17",
                "female",
                "2004",
                "2014",
                "Matric - Science",
                "Class of 2014",
                "ayesha@example.com",
                "+92 300 1234567",
            ]
        ],
    )


@router.post("/import", summary="Import student records from CSV (dry_run=true validates without saving)")
async def import_records(
    request: Request,
    file: UploadFile = File(...),
    dry_run: bool = Form(True),
    create_batches: bool = Form(True),
    me: Principal = Depends(require("alumni.create")),
    db: AsyncSession = Depends(get_db),
):
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise AppError(413, "FILE_TOO_LARGE", "The file is larger than 5 MB. Split it into smaller files.")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("cp1252", errors="replace")
    reader = csv.reader(io.StringIO(text))
    try:
        header = next(reader)
    except StopIteration:
        raise AppError(422, "EMPTY_FILE", "The file is empty.") from None
    keys = [_key(h) for h in header]
    missing = {"registration_no", "full_name"} - set(keys)
    if missing:
        raise AppError(
            422,
            "MISSING_COLUMNS",
            "Required columns are missing: registration_no, full_name. " "Download the template to see the expected columns.",
        )
    batches = {b.name.lower(): b for b in (await db.execute(select(Batch))).scalars()}
    existing = {r.reg_norm: r for r in (await db.execute(select(StudentRecord))).scalars()}
    seen: set[str] = set()
    errors, created, updated, unchanged, new_batches = [], 0, 0, 0, []
    touched: list[str] = []
    for line, row in enumerate(reader, start=2):
        if line - 1 > MAX_ROWS:
            raise AppError(422, "TOO_MANY_ROWS", f"At most {MAX_ROWS} rows can be imported at once.")
        if not any(c.strip() for c in row):
            continue
        vals = {k: (row[i].strip() if i < len(row) else "") for i, k in enumerate(keys) if k}
        try:
            reg = vals.get("registration_no", "")
            norm = svc.norm_reg(reg)
            if not norm:
                raise ValueError("registration number is missing")
            if norm in seen:
                raise ValueError(f"registration number {reg} appears more than once in the file")
            name = re.sub(r"\s+", " ", vals.get("full_name", "")).strip()
            if len(name) < 2:
                raise ValueError("name is missing")
            email = vals.get("email") or None
            if email:
                try:
                    email = str(_email.validate_python(email)).lower()
                except ValidationError:
                    raise ValueError(f"email {email} is not valid") from None
            phone = vals.get("phone") or None
            if phone and not re.fullmatch(r"\+?[0-9 ()\-]{7,20}", phone):
                raise ValueError(f"mobile number {phone} is not valid")
            fields = {
                "registration_no": reg[:40],
                "reg_norm": norm[:40],
                "full_name": name[:150],
                "father_name": (vals.get("father_name") or None) and vals["father_name"][:150],
                "date_of_birth": _date(vals.get("date_of_birth", "")),
                "gender": _gender(vals.get("gender", "")),
                "admission_year": _year(vals.get("admission_year", ""), "admission year"),
                "graduation_year": _year(vals.get("graduation_year", ""), "graduation year"),
                "class_name": (vals.get("class_name") or None) and vals["class_name"][:60],
                "email": email,
                "phone": phone.replace(" ", "") if phone else None,
            }
            if fields["admission_year"] and fields["graduation_year"] and fields["admission_year"] > fields["graduation_year"]:
                raise ValueError("admission year is after graduation year")
            bname = vals.get("batch", "").strip()
            batch = None
            if bname:
                batch = batches.get(bname.lower())
                if not batch:
                    if not create_batches or not fields["graduation_year"]:
                        raise ValueError(
                            f"batch “{bname}” does not exist" + ("" if create_batches else " (turn on “create missing batches”)")
                        )
                    batch = Batch(
                        name=bname[:100],
                        graduation_year=fields["graduation_year"],
                        admission_year=fields["admission_year"],
                        description="Created by a student records import.",
                    )
                    batches[bname.lower()] = batch
                    new_batches.append(bname)
                    if not dry_run:
                        db.add(batch)
                        await db.flush()
                elif fields["graduation_year"] and batch.graduation_year != fields["graduation_year"]:
                    raise ValueError(f"batch “{bname}” graduated in {batch.graduation_year}, not {fields['graduation_year']}")
        except ValueError as e:
            if len(errors) < 200:
                errors.append({"row": line, "message": str(e)[0].upper() + str(e)[1:] + "."})
            continue
        seen.add(norm)
        rec = existing.get(norm)
        if rec:
            changed = any(getattr(rec, k) != v for k, v in fields.items()) or (batch and rec.batch_id != batch.id)
            if not changed:
                unchanged += 1
                continue
            updated += 1
        else:
            created += 1
        if dry_run:
            continue
        if not rec:
            rec = StudentRecord(**fields, source=(file.filename or "import.csv")[:150], imported_by=me.id)
            db.add(rec)
        else:
            for k, v in fields.items():
                setattr(rec, k, v)
            rec.source = (file.filename or "import.csv")[:150]
        if batch:
            rec.batch_id = batch.id
        touched.append(norm)
    result = {
        "dry_run": dry_run,
        "created": created,
        "updated": updated,
        "unchanged": unchanged,
        "errors": errors,
        "error_count": len(errors),
        "new_batches": new_batches,
    }
    if dry_run:
        return {"data": result}
    await db.flush()
    # Applicants waiting for verification may now match a record.
    verified = 0
    if touched:
        waiting = (
            (
                await db.execute(
                    select(User)
                    .join(AlumniProfile, AlumniProfile.user_id == User.id)
                    .where(AlumniProfile.reg_norm.in_(touched), AlumniProfile.verification_status != "verified", User.deleted_at.is_(None))
                )
            )
            .scalars()
            .all()
        )
        for u in waiting:
            prof = await db.get(AlumniProfile, u.id)
            await svc.refresh_match(db, u, prof)
            verified += int(await svc.try_auto_verify(db, u))
    result["auto_verified"] = verified
    if new_batches:
        await settings_store.changed()
    await record(
        db,
        actor_id=me.id,
        action="import",
        entity="student_record",
        summary=f"Imported student records: {created} new, {updated} updated, {len(errors)} rejected",
        data={"file": file.filename, "auto_verified": verified},
        ip=client_ip(request),
    )
    return {"data": result}


class InviteIn(BaseModel):
    ids: list[uuid.UUID] = Field(default_factory=list, max_length=500)
    all_uninvited: bool = False


@router.post("/invite", summary="Create verified accounts for records with an email and send invitations")
async def invite(
    body: InviteIn,
    request: Request,
    me: Principal = Depends(require("alumni.create", "verification.approve")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(StudentRecord).where(StudentRecord.matched_user_id.is_(None), StudentRecord.email.is_not(None))
    if body.all_uninvited:
        stmt = stmt.where(StudentRecord.invited_at.is_(None)).limit(500)
    elif body.ids:
        stmt = stmt.where(StudentRecord.id.in_(body.ids))
    else:
        raise AppError(422, "NOTHING_SELECTED", "Select the records to invite.")
    recs = (await db.execute(stmt)).scalars().all()
    cfg = await svc.settings(db)
    this_year = datetime.now(UTC).year
    invited, skipped = 0, []
    for rec in recs:
        taken = (await db.execute(select(User.id).where(func.lower(User.email) == rec.email.lower(), User.deleted_at.is_(None)))).first()
        if taken:
            skipped.append({"id": str(rec.id), "name": rec.full_name, "reason": "An account with this email already exists."})
            continue
        try:
            async with db.begin_nested():
                user = await _new_member(db, rec.full_name, rec.email, rec.phone)
                kind = "student" if rec.graduation_year and rec.graduation_year > this_year else "alumni"
                profile = AlumniProfile(
                    user_id=user.id,
                    kind=kind,
                    gender=rec.gender,
                    date_of_birth=rec.date_of_birth,
                    admission_year=rec.admission_year,
                    graduation_year=rec.graduation_year,
                    batch_id=rec.batch_id,
                    class_name=rec.class_name,
                    registration_no=rec.registration_no,
                    reg_norm=rec.reg_norm,
                    visibility=cfg.default_profile_visibility,
                    privacy=svc.default_privacy(cfg),
                    verification_status="pending",
                    submitted_at=svc.now(),
                    evidence_ids=[],
                    match_strength="strong",
                )
                db.add(profile)
                await db.flush()
                await svc.approve(
                    db, user, profile, method="import", actor_id=me.id, record=rec, note="Invited from institutional records.", notify=False
                )
                rec.invited_at = svc.now()
                await _invite_email(db, user)
            invited += 1
        except AppError as e:
            skipped.append({"id": str(rec.id), "name": rec.full_name, "reason": e.message})
    await record(
        db,
        actor_id=me.id,
        action="invite",
        entity="student_record",
        summary=f"Invited {invited} former students from school records",
        ip=client_ip(request),
    )
    return {"data": {"invited": invited, "skipped": skipped}}


@router.delete("/{record_id}", summary="Delete a student record")
async def delete_record(
    record_id: uuid.UUID, request: Request, me: Principal = Depends(require("alumni.delete")), db: AsyncSession = Depends(get_db)
):
    rec = await db.get(StudentRecord, record_id)
    if not rec:
        raise not_found("Student record")
    await db.delete(rec)
    await record(
        db,
        actor_id=me.id,
        action="delete",
        entity="student_record",
        entity_id=record_id,
        summary=f"Deleted student record {rec.registration_no}",
        ip=client_ip(request),
    )
    return {"data": {"ok": True}}
