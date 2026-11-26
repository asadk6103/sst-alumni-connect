"""Alumni portal: own profile, verification, directory, profiles, connections and follows."""

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, File, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import and_, case, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.db import get_db
from ...core.deps import Principal, require, require_module
from ...core.errors import AppError, conflict, forbidden, not_found
from ...core.pagination import PageParams, page_params
from ...core.redis import enforce
from ...core.security import token_hash
from ...models import (
    AlumniAchievement,
    AlumniConnection,
    AlumniEducation,
    AlumniEmployment,
    AlumniFollow,
    AlumniProfile,
    AlumniSkill,
    Batch,
    DiscussionGroup,
    Media,
    ProfileReport,
    User,
    VerificationCode,
    VerificationEvent,
)
from ...services import custom_fields, media, notifications
from . import service as svc
from .schemas import (
    AchievementIn,
    EducationIn,
    EmploymentIn,
    PrivacyIn,
    ProfileIn,
    SkillsIn,
    check_years,
    fail,
    validate_school,
)

router = APIRouter(prefix="/api/v1/alumni", tags=["Alumni portal"])
directory = require_module("directory")


async def _me(db: AsyncSession, p: Principal) -> tuple[User, AlumniProfile]:
    user = await db.get(User, p.id)
    return user, await svc.ensure_profile(db, user)


async def own_profile(db: AsyncSession, user: User, profile: AlumniProfile) -> dict:
    viewer = svc.Viewer(
        Principal(id=user.id, session_id=uuid.uuid4(), email=user.email, full_name=user.full_name, status=user.status, roles=[])
    )
    out = await svc.detail(db, user, profile, viewer)
    score, missing = await svc.completion(db, user, profile)
    docs = []
    for mid in profile.evidence_ids or []:
        m = await db.get(Media, uuid.UUID(mid))
        if m and not m.deleted_at:
            docs.append({"id": str(m.id), "filename": m.filename, "size": m.size, "mime": m.mime, "created_at": m.created_at})
    out.update(
        {
            "gender": profile.gender,
            "date_of_birth": profile.date_of_birth,
            "batch_id": str(profile.batch_id) if profile.batch_id else None,
            "registration_no": profile.registration_no,
            "email": user.email,
            "phone": user.phone,
            "phone_verified": bool(user.phone_verified_at),
            "website": profile.website,
            "linkedin": profile.linkedin,
            "privacy": {"visibility": profile.visibility, "sections": svc.privacy_of(profile)},
            "custom_fields": profile.custom_fields or {},
            "privacy_sections": svc.PRIVACY_SECTIONS,
            "completion": score,
            "completion_missing": missing,
            "completion_items": [
                {"key": k, "label": label, "tab": tab, "done": k not in {m["key"] for m in missing}} for k, _w, label, tab in svc.COMPLETION
            ],
            "locked_fields": sorted(svc.lock_identity_fields(profile)),
            "verification": {
                "status": profile.verification_status,
                "method": profile.verification_method,
                "verified_at": profile.verified_at,
                "rejection_reason": profile.rejection_reason,
                "submitted_at": profile.submitted_at,
                "note": profile.verification_note,
                "documents": docs,
                "documents_allowed": (await svc.settings(db)).allow_verification_documents,
            },
        }
    )
    return out


# ── own profile ─────────────────────────────────────────────────────────────
@router.get("/me", summary="Your full profile, privacy settings, completion and verification status")
async def get_me(p: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    user, profile = await _me(db, p)
    return {"data": await own_profile(db, user, profile)}


@router.put("/me", summary="Update your personal and professional details")
async def put_me(body: ProfileIn, p: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    user, profile = await _me(db, p)
    sent = body.model_fields_set
    locked = svc.lock_identity_fields(profile)
    for f in locked & sent:
        if getattr(body, f) != getattr(profile, f):
            fail(f, "This detail is confirmed by verification. Contact the alumni office to change it.", "FIELD_LOCKED")
    school_fields = {"kind", "admission_year", "graduation_year", "batch_id", "date_of_birth"} & sent
    if school_fields:
        merged = body.model_copy(
            update={f: getattr(profile, f) for f in ("kind", "admission_year", "graduation_year", "batch_id") if f not in sent}
        )
        await validate_school(db, merged, await svc.settings(db), registering=False, fields=school_fields)
    if "full_name" in sent and body.full_name:
        user.full_name = body.full_name
    for f in (
        "kind",
        "gender",
        "date_of_birth",
        "admission_year",
        "graduation_year",
        "batch_id",
        "class_name",
        "city",
        "country",
        "designation",
        "organization",
        "industry",
        "bio",
        "website",
        "linkedin",
    ):
        if f in sent:
            setattr(profile, f, getattr(body, f))
    if "custom_fields" in sent and body.custom_fields is not None:
        profile.custom_fields = await custom_fields.clean(db, "alumni_profile", body.custom_fields, profile.custom_fields, actor=user.id)
    if "registration_no" in sent:
        profile.registration_no, profile.reg_norm = body.registration_no, svc.norm_reg(body.registration_no)
    if profile.verification_status != "verified" and sent & {"registration_no", "full_name", "graduation_year", "date_of_birth"}:
        await svc.refresh_match(db, user, profile)
        await svc.try_auto_verify(db, user)
    await svc.refresh_search(db, user.id)
    return {"data": await own_profile(db, user, profile)}


@router.put("/me/privacy", summary="Choose who can see your profile and each section")
async def put_privacy(body: PrivacyIn, p: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    user, profile = await _me(db, p)
    unknown = set(body.sections) - set(svc.PRIVACY_SECTIONS)
    if unknown:
        fail("sections", f"Unknown section: {', '.join(sorted(unknown))}")
    profile.visibility = body.visibility
    profile.privacy = {**svc.privacy_of(profile), **body.sections}
    await svc.refresh_search(db, user.id)
    return {"data": {"visibility": profile.visibility, "sections": svc.privacy_of(profile)}}


@router.put("/me/skills", summary="Replace your skills list")
async def put_skills(body: SkillsIn, p: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    user, _ = await _me(db, p)
    await db.execute(delete(AlumniSkill).where(AlumniSkill.user_id == user.id))
    for i, s in enumerate(body.skills):
        db.add(AlumniSkill(user_id=user.id, name=s, position=i))
    await svc.refresh_search(db, user.id)
    return {"data": body.skills}


SECTIONS = {
    "education": (AlumniEducation, EducationIn, svc.education_out, 20),
    "employment": (AlumniEmployment, EmploymentIn, svc.employment_out, 30),
    "achievements": (AlumniAchievement, AchievementIn, svc.achievement_out, 50),
}


def _validate_section(section: str, body) -> None:
    if section == "education":
        check_years(body.start_year, body.end_year)
    elif section == "employment":
        if body.start_date and body.end_date and body.end_date < body.start_date:
            fail("end_date", "The end cannot be before the start.")
        if body.is_current and body.end_date:
            fail("end_date", "A current position has no end date.")


def _section_routes(section: str) -> None:
    model, schema, out, limit = SECTIONS[section]

    @router.post(f"/me/{section}", status_code=201, summary=f"Add an entry to your {section}", name=f"add_{section}")
    async def add(body: schema, p: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):  # type: ignore[valid-type]
        user, _ = await _me(db, p)
        _validate_section(section, body)
        n = (await db.execute(select(func.count()).select_from(model).where(model.user_id == user.id))).scalar_one()
        if n >= limit:
            raise conflict("LIMIT_REACHED", f"You can add up to {limit} entries.")
        row = model(user_id=user.id, **body.model_dump())
        if section == "employment" and body.is_current:
            await _sync_current_position(db, user.id, body)
        db.add(row)
        await svc.refresh_search(db, user.id)
        return {"data": out(row)}

    @router.put(f"/me/{section}/{{item_id}}", summary=f"Update an entry of your {section}", name=f"update_{section}")
    async def edit(
        item_id: uuid.UUID,
        body: schema,
        p: Principal = Depends(require("portal.access")),  # type: ignore[valid-type]
        db: AsyncSession = Depends(get_db),
    ):
        row = await db.get(model, item_id)
        if not row or row.user_id != p.id:
            raise not_found("Entry")
        _validate_section(section, body)
        for k, v in body.model_dump().items():
            setattr(row, k, v)
        if section == "employment" and body.is_current:
            await _sync_current_position(db, p.id, body)
        await svc.refresh_search(db, p.id)
        return {"data": out(row)}

    @router.delete(f"/me/{section}/{{item_id}}", summary=f"Remove an entry from your {section}", name=f"delete_{section}")
    async def remove(item_id: uuid.UUID, p: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
        row = await db.get(model, item_id)
        if not row or row.user_id != p.id:
            raise not_found("Entry")
        await db.delete(row)
        await svc.refresh_search(db, p.id)
        return {"data": {"ok": True}}


async def _sync_current_position(db: AsyncSession, user_id: uuid.UUID, body: EmploymentIn) -> None:
    """The current position on the profile follows the latest 'current' experience entry."""
    profile = await db.get(AlumniProfile, user_id)
    profile.designation, profile.organization = body.designation, body.organization
    if body.industry:
        profile.industry = body.industry


for _s in SECTIONS:
    _section_routes(_s)


@router.post("/me/photo", summary="Upload your profile photo")
async def upload_photo(file: UploadFile = File(...), p: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    await enforce(f"photo:{p.id}", 20, 3600)
    user, profile = await _me(db, p)
    m = await media.upload(
        db, data=await file.read(), filename=file.filename or "photo", folder="avatars", alt=user.full_name, images_only=True, actor=user.id
    )
    if profile.photo_id and (old := await db.get(Media, profile.photo_id)):
        old.deleted_at = svc.now()
    profile.photo_id = m.id
    await svc.refresh_search(db, user.id)
    return {"data": await svc.photo_out(db, m.id)}


@router.delete("/me/photo", summary="Remove your profile photo")
async def delete_photo(p: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    user, profile = await _me(db, p)
    if profile.photo_id and (old := await db.get(Media, profile.photo_id)):
        old.deleted_at = svc.now()
    profile.photo_id = None
    await svc.refresh_search(db, user.id)
    return {"data": {"ok": True}}


# ── verification (applicant side) ───────────────────────────────────────────
class ResubmitIn(BaseModel):
    note: str | None = Field(None, max_length=500)


@router.post("/me/verification", summary="Submit (or resubmit) your profile for verification")
async def submit_verification(body: ResubmitIn, p: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    user, profile = await _me(db, p)
    if profile.verification_status == "verified":
        raise conflict("ALREADY_VERIFIED", "Your profile is already verified.")
    if not profile.graduation_year:
        fail("graduation_year", "Add your graduation year first.")
    again = profile.verification_status == "rejected"
    profile.verification_status, profile.submitted_at = "pending", svc.now()
    profile.verification_note = body.note
    await svc.log(db, user.id, "resubmitted" if again else "submitted", note=body.note, actor_id=user.id)
    await svc.refresh_match(db, user, profile)
    await svc.try_auto_verify(db, user)
    return {"data": await own_profile(db, user, profile)}


class CodeIn(BaseModel):
    code: str = Field(..., min_length=6, max_length=40)


@router.post("/me/verification/code", summary="Verify with a code issued by the alumni office")
async def redeem_code(body: CodeIn, p: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    await enforce(f"vcode:{p.id}", 10, 3600, "Too many attempts. Please try again later.")
    user, profile = await _me(db, p)
    if profile.verification_status == "verified":
        raise conflict("ALREADY_VERIFIED", "Your profile is already verified.")
    code = "".join(ch for ch in body.code.upper() if ch.isalnum())
    vc = (
        await db.execute(select(VerificationCode).where(VerificationCode.code_hash == token_hash(code)).with_for_update())
    ).scalar_one_or_none()
    if not vc or vc.revoked_at or (vc.expires_at and vc.expires_at <= svc.now()) or vc.uses >= vc.max_uses:
        await db.commit()  # keep the rate-limit context; nothing else changed
        raise AppError(400, "INVALID_CODE", "This code is not valid or has already been used.")
    if vc.batch_id:
        b = await db.get(Batch, vc.batch_id)
        if b and profile.graduation_year and b.graduation_year != profile.graduation_year:
            raise AppError(400, "INVALID_CODE", f"This code is for {b.name}. Check your graduation year.")
        if b and not profile.batch_id:
            profile.batch_id, profile.graduation_year = b.id, profile.graduation_year or b.graduation_year
    vc.uses += 1
    await svc.approve(db, user, profile, method="institutional_code", actor_id=None, note=f"Code {vc.label} (…{vc.hint})")
    return {"data": await own_profile(db, user, profile)}


@router.post("/me/verification/documents", status_code=201, summary="Attach a supporting document (kept private)")
async def add_document(file: UploadFile = File(...), p: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    await enforce(f"vdoc:{p.id}", 20, 3600)
    user, profile = await _me(db, p)
    if not (await svc.settings(db)).allow_verification_documents:
        raise AppError(403, "DOCUMENTS_DISABLED", "Supporting documents are not accepted.")
    if profile.verification_status == "verified":
        raise conflict("ALREADY_VERIFIED", "Your profile is already verified.")
    if len(profile.evidence_ids or []) >= 5:
        raise conflict("LIMIT_REACHED", "You can attach up to 5 documents.")
    data = await file.read()
    m = await media.upload(db, data=data, filename=file.filename or "document", folder="verification", actor=user.id, private=True)
    if not (m.mime.startswith("image/") or m.mime == "application/pdf"):
        m.deleted_at = svc.now()
        raise AppError(415, "UNSUPPORTED_FILE", "Attach a PDF or an image (JPG, PNG, WebP).")
    profile.evidence_ids = [*(profile.evidence_ids or []), str(m.id)]
    return {"data": {"id": str(m.id), "filename": m.filename, "size": m.size, "mime": m.mime, "created_at": m.created_at}}


@router.delete("/me/verification/documents/{media_id}", summary="Remove a supporting document")
async def remove_document(media_id: uuid.UUID, p: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    _, profile = await _me(db, p)
    if str(media_id) not in (profile.evidence_ids or []):
        raise not_found("Document")
    profile.evidence_ids = [x for x in profile.evidence_ids if x != str(media_id)]
    if m := await db.get(Media, media_id):
        m.deleted_at = svc.now()
    return {"data": {"ok": True}}


@router.get("/me/verification/documents/{media_id}", summary="Download one of your supporting documents")
async def get_document(media_id: uuid.UUID, p: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    _, profile = await _me(db, p)
    m = await db.get(Media, media_id)
    if str(media_id) not in (profile.evidence_ids or []) or not m or m.deleted_at:
        raise not_found("Document")
    return media.download_response(m, await media.read(db, m))


@router.get("/me/verification/history", summary="Your verification history")
async def verification_history(p: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    rows = (
        (
            await db.execute(
                select(VerificationEvent).where(VerificationEvent.user_id == p.id).order_by(VerificationEvent.created_at.desc()).limit(50)
            )
        )
        .scalars()
        .all()
    )
    member_notes = ("rejected", "revoked", "submitted", "resubmitted")  # decision notes of staff stay internal
    return {
        "data": [
            {"action": r.action, "method": r.method, "note": r.note if r.action in member_notes else None, "created_at": r.created_at}
            for r in rows
        ]
    }


# ── directory ───────────────────────────────────────────────────────────────
def _career_public():
    return func.coalesce(AlumniProfile.privacy["career"].astext, "members") == "members"


def _location_public():
    return func.coalesce(AlumniProfile.privacy["location"].astext, "members") == "members"


@router.get("/directory", summary="Search the alumni directory", dependencies=[Depends(directory)])
async def search_directory(
    q: str | None = Query(None, max_length=100),
    batch: uuid.UUID | None = None,
    year: int | None = Query(None, ge=1900, le=2100),
    year_from: int | None = Query(None, ge=1900, le=2100),
    year_to: int | None = Query(None, ge=1900, le=2100),
    profession: str | None = Query(None, max_length=600),
    organization: str | None = Query(None, max_length=600),
    industry: str | None = Query(None, max_length=600),
    country: str | None = Query(None, max_length=600),
    city: str | None = Query(None, max_length=600),
    kind: Literal["alumni", "student"] | None = None,
    verified_only: bool = False,
    group: uuid.UUID | None = None,
    years: str | None = Query(None, max_length=200, pattern=r"^\d{4}(,\d{4})*$"),
    sort: Literal["relevance", "name", "-year", "year", "recent"] = "relevance",
    p: PageParams = Depends(page_params),
    me: Principal = Depends(require("portal.directory")),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(User, AlumniProfile)
        .join(AlumniProfile, AlumniProfile.user_id == User.id)
        .where(*await svc.directory_visible_clause(db), AlumniProfile.user_id != me.id)
    )
    connected = await svc.connected_ids(db, me.id)
    staff = me.can("alumni.view")
    if not staff:
        # hidden profiles never appear; connections-only profiles appear to connections
        stmt = stmt.where(
            or_(
                AlumniProfile.visibility == "members",
                and_(AlumniProfile.visibility == "connections", AlumniProfile.user_id.in_(connected or [uuid.UUID(int=0)])),
            )
        )
    rank = None
    if q and (tq := svc.tsquery(q)):
        query = func.to_tsquery("simple", tq)
        stmt = stmt.where(AlumniProfile.search.op("@@")(query))
        rank = func.ts_rank(AlumniProfile.search, query)
    if batch:
        stmt = stmt.where(AlumniProfile.batch_id == batch)
    if year:
        stmt = stmt.where(AlumniProfile.graduation_year == year)
    if year_from:
        stmt = stmt.where(AlumniProfile.graduation_year >= year_from)
    if year_to:
        stmt = stmt.where(AlumniProfile.graduation_year <= year_to)
    if kind:
        stmt = stmt.where(AlumniProfile.kind == kind)
    if verified_only:
        stmt = stmt.where(AlumniProfile.verification_status == "verified")
    if years:
        stmt = stmt.where(AlumniProfile.graduation_year.in_([int(y) for y in years.split(",")][:20]))
    if group:
        from ...models import GroupMember

        stmt = stmt.where(
            AlumniProfile.user_id.in_(select(GroupMember.user_id).where(GroupMember.group_id == group, GroupMember.status == "active"))
        )
    # Filters on private sections only match members who show that section to everyone.
    for value, col, public in (
        (profession, AlumniProfile.designation, _career_public),
        (organization, AlumniProfile.organization, _career_public),
        (industry, AlumniProfile.industry, _career_public),
        (country, AlumniProfile.country, _location_public),
        (city, AlumniProfile.city, _location_public),
    ):
        if value:
            # several values separated by "|" (checkbox filters) match any of them
            values = [v.strip().lower() for v in value.split("|") if v.strip()][:20]
            if col in (AlumniProfile.designation, AlumniProfile.organization):
                cond = or_(*[func.lower(col).like(f"%{v.replace('%', '').replace('_', '')}%") for v in values])
            else:
                cond = func.lower(col).in_(values)
            stmt = stmt.where(cond if staff else and_(cond, public()))
    order = {
        "name": [User.full_name.asc()],
        "-year": [AlumniProfile.graduation_year.desc().nulls_last(), User.full_name],
        "year": [AlumniProfile.graduation_year.asc().nulls_last(), User.full_name],
        "recent": [AlumniProfile.verified_at.desc().nulls_last(), User.created_at.desc()],
        "relevance": [rank.desc(), User.full_name] if rank is not None else [AlumniProfile.completion.desc(), User.full_name],
    }[sort]
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(stmt.order_by(*order, User.id).offset((p.page - 1) * p.page_size).limit(p.page_size))).all()
    viewer = svc.Viewer(me, connected)
    ids = [u.id for u, _ in rows]
    rel = await svc.relations(db, me.id, ids)
    names = await svc.batch_names(db, {pr.batch_id for _, pr in rows})
    data = [svc.card(u, pr, viewer, names.get(pr.batch_id), await svc.photo_out(db, pr.photo_id), rel[u.id]) for u, pr in rows]
    return {"data": data, "meta": {"page": p.page, "page_size": p.page_size, "total": total, "pages": max(1, -(-total // p.page_size))}}


@router.get("/directory/facets", summary="Filter options for the directory", dependencies=[Depends(directory)])
async def facets(_: Principal = Depends(require("portal.directory")), db: AsyncSession = Depends(get_db)):
    async def load():
        base = [*await svc.directory_visible_clause(db), AlumniProfile.visibility != "hidden"]
        joined = select(AlumniProfile).join(User, User.id == AlumniProfile.user_id).where(*base).subquery()

        async def top(col: str, public_key: str, limit: int = 60):
            c = joined.c[col]
            rows = (
                await db.execute(
                    select(c, func.count())
                    .where(c.is_not(None), func.coalesce(joined.c.privacy[public_key].astext, "members") == "members")
                    .group_by(c)
                    .order_by(func.count().desc(), c)
                    .limit(limit)
                )
            ).all()
            return [{"value": v, "count": n} for v, n in rows]

        years = (
            await db.execute(
                select(joined.c.graduation_year, func.count())
                .where(joined.c.graduation_year.is_not(None))
                .group_by(joined.c.graduation_year)
                .order_by(joined.c.graduation_year.desc())
            )
        ).all()
        batches = (
            (await db.execute(select(Batch).where(Batch.is_active.is_(True)).order_by(Batch.graduation_year.desc(), Batch.name)))
            .scalars()
            .all()
        )
        return {
            "countries": await top("country", "location"),
            "cities": await top("city", "location", 80),
            "industries": await top("industry", "career"),
            "organizations": await top("organization", "career", 40),
            "designations": await top("designation", "career", 40),
            "groups": [
                {"id": str(g.id), "name": g.name, "count": g.member_count}
                for g in (
                    await db.execute(
                        select(DiscussionGroup)
                        .where(DiscussionGroup.status == "active")
                        .order_by(DiscussionGroup.member_count.desc())
                        .limit(30)
                    )
                ).scalars()
            ],
            "years": [{"value": y, "count": n} for y, n in years],
            "batches": [{"id": str(b.id), "name": b.name, "graduation_year": b.graduation_year} for b in batches],
        }

    return {"data": await settings_store.cached("directory-facets", load)}


# ── profiles, follows, reports ──────────────────────────────────────────────
async def _target(db: AsyncSession, me: Principal, user_id: uuid.UUID) -> tuple[User, AlumniProfile, svc.Viewer]:
    row = (
        await db.execute(
            select(User, AlumniProfile)
            .join(AlumniProfile, AlumniProfile.user_id == User.id)
            .where(User.id == user_id, User.deleted_at.is_(None))
        )
    ).first()
    if not row:
        raise not_found("Profile")
    user, profile = row
    viewer = svc.Viewer(me, await svc.connected_ids(db, me.id, [user_id]))
    if user.id != me.id and not viewer.staff:
        cfg = await svc.settings(db)
        listed = user.status == "active" and (cfg.directory_include_unverified or profile.verification_status == "verified")
        if not listed or not viewer.can_see_profile(profile):
            raise not_found("Profile")
    return user, profile, viewer


@router.get("/profiles/{user_id}", summary="View an alumni profile (privacy applied)", dependencies=[Depends(directory)])
async def view_profile(
    user_id: uuid.UUID, as_member: bool = False, me: Principal = Depends(require("portal.directory")), db: AsyncSession = Depends(get_db)
):
    """`as_member=true` on your own profile shows it the way an unconnected member sees it (preview)."""
    user, profile, viewer = await _target(db, me, user_id)
    if as_member and user_id == me.id:
        viewer = svc.Viewer(Principal(id=uuid.uuid4(), session_id=uuid.uuid4(), email="", full_name="", status="active", roles=[]))
    return {"data": await svc.detail(db, user, profile, viewer)}


@router.post("/profiles/{user_id}/follow", summary="Follow a member", dependencies=[Depends(directory)])
async def follow(user_id: uuid.UUID, me: Principal = Depends(require("portal.connect")), db: AsyncSession = Depends(get_db)):
    if user_id == me.id:
        raise conflict("SELF", "You cannot follow yourself.")
    await _target(db, me, user_id)
    from ...services import member_settings

    if not (await member_settings.get(db, user_id))["allow_follow"] and not await db.get(AlumniFollow, (me.id, user_id)):
        raise forbidden("This member does not accept followers. Send a connection request instead.")
    if not await db.get(AlumniFollow, (me.id, user_id)):
        db.add(AlumniFollow(follower_id=me.id, followee_id=user_id))
    return {"data": {"following": True}}


@router.delete("/profiles/{user_id}/follow", summary="Stop following a member", dependencies=[Depends(directory)])
async def unfollow(user_id: uuid.UUID, me: Principal = Depends(require("portal.connect")), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(AlumniFollow).where(AlumniFollow.follower_id == me.id, AlumniFollow.followee_id == user_id))
    return {"data": {"following": False}}


class ReportIn(BaseModel):
    reason: Literal["fake", "impersonation", "inappropriate", "spam", "other"]
    details: str | None = Field(None, max_length=1000)


@router.post(
    "/profiles/{user_id}/report", status_code=201, summary="Report a profile to the administrators", dependencies=[Depends(directory)]
)
async def report_profile(
    user_id: uuid.UUID, body: ReportIn, me: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)
):
    if user_id == me.id:
        raise conflict("SELF", "You cannot report your own profile.")
    await enforce(f"report:{me.id}", 10, 86400, "You have sent many reports today. Please try again tomorrow.")
    await _target(db, me, user_id)
    open_ = (
        await db.execute(
            select(ProfileReport.id).where(
                ProfileReport.reporter_id == me.id, ProfileReport.user_id == user_id, ProfileReport.status == "open"
            )
        )
    ).first()
    if open_:
        raise conflict("ALREADY_REPORTED", "You have already reported this profile. The administrators will review it.")
    db.add(ProfileReport(reporter_id=me.id, user_id=user_id, reason=body.reason, details=body.details))
    return {"data": {"message": "Thank you. The administrators will review this profile."}}


# ── connections ─────────────────────────────────────────────────────────────
class ConnectIn(BaseModel):
    user_id: uuid.UUID
    message: str | None = Field(None, max_length=300)


def _notify(db: AsyncSession, user_id: uuid.UUID, event: str, data: dict) -> None:
    from ...services import live

    live.emit_to_user(db, user_id, event, data)


async def _accepts_requests(db: AsyncSession, me: Principal, target_id: uuid.UUID) -> None:
    """The target's "who can send me connection requests" setting (their own pending request always counts)."""
    from ...services import member_settings

    policy = (await member_settings.get(db, target_id))["connection_requests"]
    if policy == "anyone" or me.can("alumni.view"):
        return
    theirs = (
        await db.execute(
            select(AlumniConnection.id).where(
                AlumniConnection.requester_id == target_id, AlumniConnection.addressee_id == me.id, AlumniConnection.status == "pending"
            )
        )
    ).first()
    if theirs:
        return
    if policy == "none":
        raise forbidden("This member is not accepting connection requests.")
    mine, theirs_p = await db.get(AlumniProfile, me.id), await db.get(AlumniProfile, target_id)
    same = bool(
        mine
        and theirs_p
        and (
            (mine.batch_id and mine.batch_id == theirs_p.batch_id)
            or (mine.graduation_year and mine.graduation_year == theirs_p.graduation_year)
        )
    )
    near = bool(
        mine
        and theirs_p
        and mine.graduation_year
        and theirs_p.graduation_year
        and abs(mine.graduation_year - theirs_p.graduation_year) <= 5
    )
    if (policy == "batch" and not same) or (policy == "batch_range" and not (same or near)):
        raise forbidden("This member only accepts connection requests from their batch.")


@router.post("/connections", status_code=201, summary="Send a connection request", dependencies=[Depends(directory)])
async def connect(body: ConnectIn, me: Principal = Depends(require("portal.connect")), db: AsyncSession = Depends(get_db)):
    if body.user_id == me.id:
        raise conflict("SELF", "You cannot connect with yourself.")
    await enforce(f"connect:{me.id}", 50, 86400, "You have sent many requests today. Please try again tomorrow.")
    target, _, _ = await _target(db, me, body.user_id)
    await _accepts_requests(db, me, target.id)
    lo, hi = sorted([me.id, target.id])  # PostgreSQL orders uuids bytewise, like Python
    pair = and_(
        func.least(AlumniConnection.requester_id, AlumniConnection.addressee_id) == lo,
        func.greatest(AlumniConnection.requester_id, AlumniConnection.addressee_id) == hi,
    )
    c = (await db.execute(select(AlumniConnection).where(pair).with_for_update())).scalar_one_or_none()
    if c and c.status == "accepted":
        raise conflict("ALREADY_CONNECTED", "You are already connected.")
    if c and c.status == "pending" and c.requester_id == me.id:
        raise conflict("ALREADY_REQUESTED", "Your request is waiting for a reply.")
    if c and c.requester_id == me.id and c.status == "declined":
        raise conflict("ALREADY_REQUESTED", "Your request is waiting for a reply.")
    if c and c.addressee_id == me.id and c.status == "pending":
        # They already asked: accept theirs.
        c.status, c.responded_at = "accepted", svc.now()
        _notify(db, target.id, "connection:accepted", {"user_id": str(me.id), "name": me.full_name})
        return {"data": {"id": str(c.id), "status": "accepted"}}
    if c:  # they declined us earlier or we declined them: start over in this direction
        c.requester_id, c.addressee_id, c.status, c.message, c.responded_at = me.id, target.id, "pending", body.message, None
        c.created_at = svc.now()
    else:
        c = AlumniConnection(requester_id=me.id, addressee_id=target.id, status="pending", message=body.message)
        db.add(c)
    await db.flush()
    general = await settings_store.get_group(db, "general")
    await notifications.notify(
        db,
        target.id,
        "connections",
        "connection_request",
        f"{me.full_name} wants to connect",
        body=body.message or "",
        link="/portal/connections/received",
        actor_id=me.id,
        email=(
            "alumni.connection_request",
            {"from": me.full_name, "message": body.message or "", "link": f"{general.app_url}/portal/connections"},
        ),
    )
    _notify(db, target.id, "connection:request", {"id": str(c.id), "user_id": str(me.id), "name": me.full_name})
    return {"data": {"id": str(c.id), "status": "pending"}}


@router.get("/connections", summary="Your connections, requests and follows", dependencies=[Depends(directory)])
async def list_connections(
    type: Literal["received", "sent", "connected", "following", "followers"] = "connected",
    q: str | None = Query(None, max_length=100),
    p: PageParams = Depends(page_params),
    me: Principal = Depends(require("portal.access")),
    db: AsyncSession = Depends(get_db),
):
    C = AlumniConnection
    if type in ("received", "sent", "connected"):
        if type == "received":
            where, other = and_(C.addressee_id == me.id, C.status == "pending"), C.requester_id
        elif type == "sent":
            where, other = and_(C.requester_id == me.id, C.status.in_(["pending", "declined"])), C.addressee_id
        else:
            where = and_(C.status == "accepted", or_(C.requester_id == me.id, C.addressee_id == me.id))
            other = case((C.requester_id == me.id, C.addressee_id), else_=C.requester_id)
        stmt = (
            select(User, AlumniProfile, C)
            .join(C, other == User.id)
            .join(AlumniProfile, AlumniProfile.user_id == User.id)
            .where(where, User.deleted_at.is_(None))
        )
        order = C.created_at.desc()
    else:
        F = AlumniFollow
        other, mine = (F.followee_id, F.follower_id) if type == "following" else (F.follower_id, F.followee_id)
        stmt = (
            select(User, AlumniProfile, F)
            .join(F, other == User.id)
            .join(AlumniProfile, AlumniProfile.user_id == User.id)
            .where(mine == me.id, User.deleted_at.is_(None))
        )
        order = F.created_at.desc()
    if q:
        stmt = stmt.where(func.lower(User.full_name).like(f"%{q.strip().lower()}%"))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(stmt.order_by(order).offset((p.page - 1) * p.page_size).limit(p.page_size))).all()
    ids = [u.id for u, *_ in rows]
    connected = await svc.connected_ids(db, me.id, ids)
    viewer = svc.Viewer(me, connected)
    rel = await svc.relations(db, me.id, ids)
    names = await svc.batch_names(db, {pr.batch_id for _, pr, _ in rows})
    data = []
    for u, pr, link in rows:
        item = svc.card(u, pr, viewer, names.get(pr.batch_id), await svc.photo_out(db, pr.photo_id), rel[u.id])
        item["since"] = link.created_at
        if isinstance(link, AlumniConnection):
            item["request_id"], item["message"] = str(link.id), link.message
        data.append(item)
    counts = {
        "received": (
            await db.execute(select(func.count()).select_from(C).where(C.addressee_id == me.id, C.status == "pending"))
        ).scalar_one(),
        "connected": len(await svc.connected_ids(db, me.id)),
    }
    return {
        "data": data,
        "meta": {"page": p.page, "page_size": p.page_size, "total": total, "pages": max(1, -(-total // p.page_size)), "counts": counts},
    }


async def _own_request(db: AsyncSession, request_id: uuid.UUID, me: Principal) -> AlumniConnection:
    c = await db.get(AlumniConnection, request_id, with_for_update=True)
    if not c or me.id not in (c.requester_id, c.addressee_id):
        raise not_found("Request")
    return c


@router.post("/connections/{request_id}/accept", summary="Accept a connection request", dependencies=[Depends(directory)])
async def accept(request_id: uuid.UUID, me: Principal = Depends(require("portal.connect")), db: AsyncSession = Depends(get_db)):
    c = await _own_request(db, request_id, me)
    if c.addressee_id != me.id or c.status != "pending":
        raise conflict("NOT_PENDING", "This request is no longer waiting for your reply.")
    c.status, c.responded_at = "accepted", svc.now()
    requester = await db.get(User, c.requester_id)
    general = await settings_store.get_group(db, "general")
    await notifications.notify(
        db,
        requester.id,
        "connections",
        "connection_accepted",
        f"{me.full_name} accepted your connection request",
        link=f"/portal/alumni/{me.id}",
        actor_id=me.id,
        email=("alumni.connection_accepted", {"from": me.full_name, "link": f"{general.app_url}/portal/alumni/{me.id}"}),
    )
    _notify(db, requester.id, "connection:accepted", {"user_id": str(me.id), "name": me.full_name})
    return {"data": {"id": str(c.id), "status": "accepted"}}


@router.post("/connections/{request_id}/decline", summary="Decline a connection request", dependencies=[Depends(directory)])
async def decline(request_id: uuid.UUID, me: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    c = await _own_request(db, request_id, me)
    if c.addressee_id != me.id or c.status != "pending":
        raise conflict("NOT_PENDING", "This request is no longer waiting for your reply.")
    c.status, c.responded_at = "declined", svc.now()  # the sender is not told
    return {"data": {"id": str(c.id), "status": "declined"}}


@router.delete("/connections/{request_id}", summary="Withdraw a request or remove a connection", dependencies=[Depends(directory)])
async def remove_connection(request_id: uuid.UUID, me: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    c = await _own_request(db, request_id, me)
    if c.status != "accepted" and c.requester_id != me.id:
        raise conflict("NOT_ALLOWED", "Decline the request instead.")
    await db.delete(c)
    return {"data": {"ok": True}}
