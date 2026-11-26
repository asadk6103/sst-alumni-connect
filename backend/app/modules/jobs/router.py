"""Jobs and internships: listings, postings with approval, applications with CVs, saved jobs, employers, resources."""

import uuid
from datetime import UTC, date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
from sqlalchemy import Text, and_, cast, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.audit import record
from ...core.db import get_db
from ...core.deps import Principal, client_ip, require, require_module
from ...core.errors import AppError, conflict, not_found
from ...core.pagination import PageParams, csv_response, page_params
from ...core.redis import enforce
from ...models import CareerResource, Employer, JobApplication, JobCategory, JobPost, Media, Resume, SavedJob, User
from ...services import custom_fields, media, notifications
from ..community.service import authors

router = APIRouter(prefix="/api/v1/jobs", tags=["Jobs"], dependencies=[Depends(require_module("jobs"))])
admin = APIRouter(prefix="/api/v1/admin/jobs", tags=["Admin: jobs"])
viewer = require("portal.jobs.view", "jobs.view", any_of=True)
TYPES = Literal["full_time", "part_time", "internship", "contract", "temporary", "volunteer"]
APP_STATUSES = ("submitted", "reviewed", "shortlisted", "rejected", "hired", "withdrawn")
DEFAULT_CATEGORIES = [
    "Information Technology",
    "Engineering",
    "Finance & Accounting",
    "Healthcare",
    "Education & Training",
    "Sales & Marketing",
    "Operations & Supply Chain",
    "Human Resources",
    "Legal",
    "Design & Media",
    "Research",
    "Government",
    "Other",
]


def _meta(p: PageParams, total: int) -> dict:
    return {"page": p.page, "page_size": p.page_size, "total": total, "pages": max(1, -(-total // p.page_size))}


def today() -> date:
    return datetime.now(UTC).date()


async def _logo(db: AsyncSession, media_id) -> str | None:
    if not media_id:
        return None
    m = await db.get(Media, media_id)
    if not m or m.deleted_at:
        return None
    pub = await media.to_public(db, m)
    return pub["variants"][0]["url"] if pub["variants"] else pub["url"]


async def job_out(
    db: AsyncSession, p: Principal, j: JobPost, saved: set | None = None, applied: dict | None = None, detail: bool = False
) -> dict:
    cat = await db.get(JobCategory, j.category_id) if j.category_id else None
    emp = await db.get(Employer, j.employer_id) if j.employer_id else None
    poster = (await authors(db, {j.posted_by})).get(j.posted_by) if j.posted_by else None
    mine = j.posted_by == p.id
    out = {
        "id": str(j.id),
        "title": j.title,
        "organization": j.organization,
        "employment_type": j.employment_type,
        "location": j.location,
        "remote": j.remote,
        "category": cat.name if cat else None,
        "category_id": str(j.category_id) if j.category_id else None,
        "salary_min": j.salary_min,
        "salary_max": j.salary_max,
        "salary_currency": j.salary_currency,
        "experience": j.experience,
        "skills": j.skills or [],
        "deadline": j.deadline,
        "is_referral": j.is_referral,
        "status": j.status,
        "employer": {"id": str(emp.id), "name": emp.name, "logo": await _logo(db, emp.logo_id), "verified": emp.status == "approved"}
        if emp
        else None,
        "posted_by": poster,
        "approved_at": j.approved_at,
        "created_at": j.created_at,
        "is_new": bool(j.approved_at and (datetime.now(UTC) - j.approved_at).days < 7),
        "saved": j.id in (saved or set()),
        "my_application": (applied or {}).get(j.id),
        "is_mine": mine,
        "closed": j.status == "closed" or bool(j.deadline and j.deadline < today()),
    }
    if detail:
        owner = mine or p.can("jobs.view")
        out["custom_fields"] = (j.custom_fields or {}) if owner else None
        out["extra_fields"] = await custom_fields.visible_for(db, "job_post", j.custom_fields, "owner" if owner else "member")
        if emp:
            out["employer"].update(
                {
                    "industry": emp.industry,
                    "description": emp.description,
                    "website": emp.website,
                    "employees": emp.employees,
                    "headquarters": emp.headquarters,
                }
            )
        out.update(
            {
                "responsibilities": j.responsibilities or [],
                "requirements": j.requirements or [],
                "benefits": j.benefits or [],
                "description": j.description,
                "apply_url": j.apply_url,
                "apply_email": j.apply_email,
                "apply_in_portal": j.apply_in_portal,
                "rejection_reason": j.rejection_reason if (mine or p.can("jobs.view")) else None,
                "views": j.views,
            }
        )
        if mine or p.can("jobs.view"):
            out["application_count"] = (
                await db.execute(
                    select(func.count())
                    .select_from(JobApplication)
                    .where(JobApplication.job_id == j.id, JobApplication.status != "withdrawn")
                )
            ).scalar_one()
    return out


async def _job(db: AsyncSession, p: Principal, job_id: uuid.UUID) -> JobPost:
    j = await db.get(JobPost, job_id)
    if not j or (j.status != "approved" and j.status != "closed" and j.posted_by != p.id and not p.can("jobs.view")):
        raise not_found("Job")
    return j


async def _mine_maps(db: AsyncSession, p: Principal, ids: list[uuid.UUID]) -> tuple[set, dict]:
    if not ids:
        return set(), {}
    saved = set((await db.execute(select(SavedJob.job_id).where(SavedJob.user_id == p.id, SavedJob.job_id.in_(ids)))).scalars())
    applied = {
        a.job_id: {"id": str(a.id), "status": a.status}
        for a in (await db.execute(select(JobApplication).where(JobApplication.user_id == p.id, JobApplication.job_id.in_(ids)))).scalars()
    }
    return saved, applied


# ── listings ────────────────────────────────────────────────────────────────
@router.get("", summary="Job and internship listings")
async def list_jobs(
    q: str | None = Query(None, max_length=100),
    type: TYPES | None = None,
    category: uuid.UUID | None = None,
    location: str | None = Query(None, max_length=100),
    remote: bool | None = None,
    referral: bool | None = None,
    saved: bool = False,
    include_closed: bool = False,
    sort: Literal["recent", "deadline"] = "recent",
    p: PageParams = Depends(page_params),
    me: Principal = Depends(viewer),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(JobPost).where(JobPost.status.in_(["approved", "closed"] if include_closed else ["approved"]))
    if not include_closed:
        stmt = stmt.where(or_(JobPost.deadline.is_(None), JobPost.deadline >= today()))
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(JobPost.title).like(like),
                func.lower(JobPost.organization).like(like),
                func.lower(cast(JobPost.skills, Text)).like(like),
            )
        )
    if type:
        stmt = stmt.where(JobPost.employment_type == type)
    if category:
        stmt = stmt.where(JobPost.category_id == category)
    if location:
        stmt = stmt.where(func.lower(JobPost.location).like(f"%{location.strip().lower()}%"))
    if remote is not None:
        stmt = stmt.where(JobPost.remote.is_(remote))
    if referral:
        stmt = stmt.where(JobPost.is_referral.is_(True))
    if saved:
        stmt = stmt.join(SavedJob, and_(SavedJob.job_id == JobPost.id, SavedJob.user_id == me.id))
    order = [JobPost.deadline.asc().nulls_last()] if sort == "deadline" else [JobPost.approved_at.desc().nulls_last()]
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(stmt.order_by(*order, JobPost.id).offset((p.page - 1) * p.page_size).limit(p.page_size))).scalars().all()
    s, a = await _mine_maps(db, me, [j.id for j in rows])
    return {"data": [await job_out(db, me, j, s, a) for j in rows], "meta": _meta(p, total)}


@router.get("/categories", summary="Job categories")
async def categories(_: Principal = Depends(viewer), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(JobCategory).order_by(JobCategory.position, JobCategory.name))).scalars().all()
    return {"data": [{"id": str(c.id), "name": c.name} for c in rows]}


@router.get("/resources", summary="Career resources")
async def resources(_: Principal = Depends(viewer), db: AsyncSession = Depends(get_db)):
    rows = (
        (
            await db.execute(
                select(CareerResource).where(CareerResource.published.is_(True)).order_by(CareerResource.category, CareerResource.position)
            )
        )
        .scalars()
        .all()
    )
    out = []
    for r in rows:
        file = None
        if r.media_id and (m := await db.get(Media, r.media_id)) and not m.deleted_at:
            file = (await media.to_public(db, m))["url"]
        out.append({"id": str(r.id), "title": r.title, "category": r.category, "description": r.description, "url": r.url, "file": file})
    return {"data": out}


@router.get("/mine", summary="Jobs you posted")
async def my_jobs(me: Principal = Depends(require("portal.jobs.post", "jobs.create", any_of=True)), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(JobPost).where(JobPost.posted_by == me.id).order_by(JobPost.created_at.desc()))).scalars().all()
    return {"data": [await job_out(db, me, j, detail=True) for j in rows]}


@router.get("/{job_id}", summary="Job details")
async def get_job(job_id: uuid.UUID, me: Principal = Depends(viewer), db: AsyncSession = Depends(get_db)):
    j = await _job(db, me, job_id)
    if j.posted_by != me.id:
        await db.execute(update(JobPost).where(JobPost.id == j.id).values(views=JobPost.views + 1))
    s, a = await _mine_maps(db, me, [j.id])
    return {"data": await job_out(db, me, j, s, a, detail=True)}


# ── posting ─────────────────────────────────────────────────────────────────
class JobIn(BaseModel):
    title: str = Field(..., min_length=3, max_length=150)
    organization: str = Field(..., min_length=2, max_length=150)
    employer_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    employment_type: TYPES
    location: str = Field(..., min_length=2, max_length=150)
    remote: bool = False
    salary_min: int | None = Field(None, ge=0)
    salary_max: int | None = Field(None, ge=0)
    salary_currency: str | None = Field(None, pattern=r"^[A-Z]{3}$")
    experience: str | None = Field(None, max_length=100)
    skills: list[str] = Field(default_factory=list, max_length=25)
    description: str = Field(..., min_length=30, max_length=20000)
    deadline: date | None = None
    apply_url: str | None = Field(None, max_length=500)
    apply_email: EmailStr | None = None
    apply_in_portal: bool = True
    is_referral: bool = False
    custom_fields: dict = Field(default_factory=dict)
    responsibilities: list[str] = Field(default_factory=list, max_length=25)
    requirements: list[str] = Field(default_factory=list, max_length=25)
    benefits: list[str] = Field(default_factory=list, max_length=12)

    @field_validator("responsibilities", "requirements", "benefits")
    @classmethod
    def _lines(cls, v):
        return [s.strip()[:300] for s in v if s and s.strip()]

    @field_validator("skills")
    @classmethod
    def _skills(cls, v):
        return list(dict.fromkeys(s.strip()[:60] for s in v if s.strip()))

    @field_validator("apply_url")
    @classmethod
    def _url(cls, v):
        if v and not v.lower().startswith(("https://", "http://")):
            raise ValueError("Enter a full link starting with https://")
        return v or None

    @model_validator(mode="after")
    def _check(self):
        if self.salary_min and self.salary_max and self.salary_max < self.salary_min:
            raise ValueError("The maximum salary must be at least the minimum.")
        if not (self.apply_in_portal or self.apply_url or self.apply_email):
            raise ValueError("Choose how to apply: through the portal, a link or an email address.")
        if self.deadline and self.deadline < today():
            raise ValueError("The application deadline is in the past.")
        return self


async def _check_job_refs(db: AsyncSession, body: JobIn, me: Principal) -> None:
    if body.category_id and not await db.get(JobCategory, body.category_id):
        raise AppError(422, "VALIDATION_ERROR", "Unknown category.", [{"field": "category_id", "message": "Unknown category."}])
    if body.employer_id:
        emp = await db.get(Employer, body.employer_id)
        if not emp or (emp.owner_id != me.id and not me.can("jobs.edit")) or emp.status != "approved":
            raise AppError(
                422, "VALIDATION_ERROR", "Choose one of your approved organisations.", [{"field": "employer_id", "message": "Not allowed."}]
            )


@router.post("", status_code=201, summary="Post a job (reviewed by the career office before it is listed)")
async def create_job(
    body: JobIn,
    request: Request,
    me: Principal = Depends(require("portal.jobs.post", "jobs.create", any_of=True)),
    db: AsyncSession = Depends(get_db),
):
    await enforce(f"job-post:{me.id}", 20, 86400, "You have posted many jobs today.")
    await _check_job_refs(db, body, me)
    auto = me.can("jobs.approve")
    j = JobPost(
        **body.model_dump(exclude={"custom_fields"}),
        custom_fields=await custom_fields.clean(db, "job_post", body.custom_fields, actor=me.id),
        posted_by=me.id,
        status="approved" if auto else "pending",
        approved_by=me.id if auto else None,
        approved_at=datetime.now(UTC) if auto else None,
    )
    db.add(j)
    await db.flush()
    if auto:
        from .extras import notify_alerts

        await notify_alerts(db, j)
    await record(
        db,
        actor_id=me.id,
        action="create",
        entity="job",
        entity_id=j.id,
        summary=f"Posted job {j.title} at {j.organization}",
        ip=client_ip(request),
    )
    return {"data": await job_out(db, me, j, detail=True)}


@router.put("/{job_id}", summary="Edit your job (goes back to review)")
async def edit_job(
    job_id: uuid.UUID,
    body: JobIn,
    me: Principal = Depends(require("portal.jobs.post", "jobs.edit", any_of=True)),
    db: AsyncSession = Depends(get_db),
):
    j = await db.get(JobPost, job_id)
    if not j or (j.posted_by != me.id and not me.can("jobs.edit")):
        raise not_found("Job")
    await _check_job_refs(db, body, me)
    for k, v in body.model_dump(exclude={"custom_fields"}).items():
        setattr(j, k, v)
    j.custom_fields = await custom_fields.clean(db, "job_post", body.custom_fields, j.custom_fields, actor=me.id)
    if not me.can("jobs.approve") and j.status in ("approved", "rejected"):
        j.status, j.approved_at, j.rejection_reason = "pending", None, None
    await db.flush()
    return {"data": await job_out(db, me, j, detail=True)}


@router.post("/{job_id}/close", summary="Close a job to new applications")
async def close_job(job_id: uuid.UUID, me: Principal = Depends(viewer), db: AsyncSession = Depends(get_db)):
    j = await db.get(JobPost, job_id)
    if not j or (j.posted_by != me.id and not me.can("jobs.edit")):
        raise not_found("Job")
    j.status = "closed"
    return {"data": await job_out(db, me, j, detail=True)}


@router.put("/{job_id}/save", summary="Save a job")
async def save_job(job_id: uuid.UUID, me: Principal = Depends(viewer), db: AsyncSession = Depends(get_db)):
    await _job(db, me, job_id)
    if not await db.get(SavedJob, (me.id, job_id)):
        db.add(SavedJob(user_id=me.id, job_id=job_id))
    return {"data": {"saved": True}}


@router.delete("/{job_id}/save", summary="Remove a saved job")
async def unsave_job(job_id: uuid.UUID, me: Principal = Depends(viewer), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(SavedJob).where(SavedJob.user_id == me.id, SavedJob.job_id == job_id))
    return {"data": {"saved": False}}


# ── CVs ─────────────────────────────────────────────────────────────────────
def _resume_out(r: Resume, m: Media | None) -> dict:
    return {
        "id": str(r.id),
        "title": r.title,
        "is_default": r.is_default,
        "filename": m.filename if m else None,
        "size": m.size if m else None,
        "created_at": r.created_at,
    }


@router.get("/resumes/mine", summary="Your CVs")
async def my_resumes(me: Principal = Depends(viewer), db: AsyncSession = Depends(get_db)):
    rows = (
        await db.execute(
            select(Resume, Media)
            .join(Media, Media.id == Resume.media_id)
            .where(Resume.user_id == me.id, Media.deleted_at.is_(None))
            .order_by(Resume.is_default.desc(), Resume.created_at.desc())
        )
    ).all()
    return {"data": [_resume_out(r, m) for r, m in rows]}


@router.post("/resumes", status_code=201, summary="Upload a CV (PDF or Word; private)")
async def upload_resume(
    file: UploadFile = File(...),
    title: str = Form("My CV", max_length=120),
    me: Principal = Depends(require("portal.jobs.apply")),
    db: AsyncSession = Depends(get_db),
):
    await enforce(f"resume:{me.id}", 20, 86400)
    n = (await db.execute(select(func.count()).select_from(Resume).where(Resume.user_id == me.id))).scalar_one()
    if n >= 5:
        raise conflict("LIMIT_REACHED", "You can keep up to 5 CVs. Delete one first.")
    m = await media.upload(db, data=await file.read(), filename=file.filename or "cv.pdf", folder="resumes", actor=me.id, private=True)
    if m.mime not in ("application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"):
        m.deleted_at = func.now()
        raise AppError(415, "UNSUPPORTED_FILE", "Upload your CV as PDF or Word (.doc, .docx).")
    r = Resume(user_id=me.id, media_id=m.id, title=title.strip() or "My CV", is_default=n == 0)
    db.add(r)
    await db.flush()
    await db.refresh(r)
    return {"data": _resume_out(r, m)}


@router.delete("/resumes/{resume_id}", summary="Delete a CV")
async def delete_resume(resume_id: uuid.UUID, me: Principal = Depends(viewer), db: AsyncSession = Depends(get_db)):
    r = await db.get(Resume, resume_id)
    if not r or r.user_id != me.id:
        raise not_found("CV")
    in_use = (
        await db.execute(
            select(JobApplication.id).where(JobApplication.resume_id == r.id, JobApplication.status.not_in(["withdrawn", "rejected"]))
        )
    ).first()
    if in_use:
        raise conflict("IN_USE", "This CV was sent with an open application, so the employer still needs it. Upload a new CV instead.")
    await db.execute(update(JobApplication).where(JobApplication.resume_id == r.id).values(resume_id=None))
    if m := await db.get(Media, r.media_id):
        m.deleted_at = func.now()
    was_default = r.is_default
    await db.delete(r)
    await db.flush()
    if was_default:  # the newest remaining CV becomes the default
        nxt = (
            await db.execute(select(Resume).where(Resume.user_id == me.id).order_by(Resume.created_at.desc()).limit(1))
        ).scalar_one_or_none()
        if nxt:
            nxt.is_default = True
    return {"data": {"ok": True}}


async def _resume_file(db: AsyncSession, resume_id: uuid.UUID):
    r = await db.get(Resume, resume_id)
    m = await db.get(Media, r.media_id) if r else None
    if not r or not m:
        raise not_found("CV")
    return media.download_response(m, await media.read(db, m))


@router.get("/resumes/{resume_id}/file", summary="Download your CV")
async def resume_file(resume_id: uuid.UUID, me: Principal = Depends(viewer), db: AsyncSession = Depends(get_db)):
    r = await db.get(Resume, resume_id)
    if not r or r.user_id != me.id:
        raise not_found("CV")
    return await _resume_file(db, resume_id)


# ── applications ────────────────────────────────────────────────────────────
class ApplyIn(BaseModel):
    resume_id: uuid.UUID | None = None
    cover_letter: str | None = Field(None, max_length=5000)


@router.post("/{job_id}/apply", status_code=201, summary="Apply through the portal")
async def apply(
    job_id: uuid.UUID, body: ApplyIn, me: Principal = Depends(require("portal.jobs.apply")), db: AsyncSession = Depends(get_db)
):
    await enforce(f"apply:{me.id}", 30, 86400, "You have applied to many jobs today.")
    j = await _job(db, me, job_id)
    if j.status != "approved" or (j.deadline and j.deadline < today()):
        raise conflict("CLOSED", "This job is no longer accepting applications.")
    if not j.apply_in_portal:
        raise conflict("APPLY_ELSEWHERE", "Apply using the link or email given in the job.")
    if j.posted_by == me.id:
        raise conflict("SELF", "You cannot apply to your own job.")
    if body.resume_id:
        r = await db.get(Resume, body.resume_id)
        if not r or r.user_id != me.id:
            raise AppError(422, "VALIDATION_ERROR", "Choose one of your CVs.", [{"field": "resume_id", "message": "Unknown CV."}])
    existing = (
        await db.execute(select(JobApplication).where(JobApplication.job_id == j.id, JobApplication.user_id == me.id))
    ).scalar_one_or_none()
    if existing and existing.status != "withdrawn":
        raise conflict("ALREADY_APPLIED", "You have already applied for this job.")
    if existing:
        existing.status, existing.resume_id, existing.cover_letter = "submitted", body.resume_id, body.cover_letter
        a = existing
    else:
        a = JobApplication(job_id=j.id, user_id=me.id, resume_id=body.resume_id, cover_letter=body.cover_letter, status="submitted")
        db.add(a)
    await db.flush()
    if j.posted_by and (poster := await db.get(User, j.posted_by)):
        general = await settings_store.get_group(db, "general")
        await notifications.notify(
            db,
            poster.id,
            "jobs",
            "application_received",
            f"{me.full_name} applied for {j.title}",
            link=f"/portal/jobs/{j.id}/applications",
            actor_id=me.id,
            email=(
                "jobs.application_received",
                {"applicant": me.full_name, "job": j.title, "link": f"{general.app_url}/portal/jobs/{j.id}/applications"},
            ),
        )
    return {"data": {"id": str(a.id), "status": a.status}}


def _app_out(a: JobApplication, people: dict, job: JobPost | None = None, for_poster: bool = False) -> dict:
    out = {
        "id": str(a.id),
        "job_id": str(a.job_id),
        "status": a.status,
        "cover_letter": a.cover_letter,
        "resume_id": str(a.resume_id) if a.resume_id else None,
        "applicant": people.get(a.user_id),
        "created_at": a.created_at,
        "updated_at": a.updated_at,
    }
    if job:
        out["job"] = {"id": str(job.id), "title": job.title, "organization": job.organization, "status": job.status}
    if for_poster:
        out["poster_note"] = a.poster_note
    return out


@router.get("/applications/mine", summary="Your applications and their status")
async def my_applications(me: Principal = Depends(viewer), db: AsyncSession = Depends(get_db)):
    rows = (
        await db.execute(
            select(JobApplication, JobPost)
            .join(JobPost, JobPost.id == JobApplication.job_id)
            .where(JobApplication.user_id == me.id)
            .order_by(JobApplication.updated_at.desc())
        )
    ).all()
    people = await authors(db, {me.id})
    return {"data": [_app_out(a, people, j) for a, j in rows]}


@router.post("/applications/{app_id}/withdraw", summary="Withdraw your application")
async def withdraw(app_id: uuid.UUID, me: Principal = Depends(viewer), db: AsyncSession = Depends(get_db)):
    a = await db.get(JobApplication, app_id)
    if not a or a.user_id != me.id:
        raise not_found("Application")
    if a.status in ("hired", "withdrawn"):
        raise conflict("FINAL", "This application can no longer be withdrawn.")
    a.status = "withdrawn"
    return {"data": {"id": str(a.id), "status": a.status}}


async def _poster_job(db: AsyncSession, me: Principal, job_id: uuid.UUID) -> JobPost:
    j = await db.get(JobPost, job_id)
    if not j or (j.posted_by != me.id and not me.can("jobs.view")):
        raise not_found("Job")
    return j


@router.get("/{job_id}/applications", summary="Applications for a job you posted")
async def job_applications(
    job_id: uuid.UUID, status: str | None = Query(None, max_length=20), me: Principal = Depends(viewer), db: AsyncSession = Depends(get_db)
):
    j = await _poster_job(db, me, job_id)
    stmt = select(JobApplication).where(JobApplication.job_id == j.id, JobApplication.status != "withdrawn")
    if status:
        stmt = stmt.where(JobApplication.status == status)
    rows = (await db.execute(stmt.order_by(JobApplication.created_at))).scalars().all()
    people = await authors(db, {a.user_id for a in rows})
    emails = dict((await db.execute(select(User.id, User.email).where(User.id.in_([a.user_id for a in rows] or [uuid.UUID(int=0)])))).all())
    return {
        "data": [{**_app_out(a, people, for_poster=True), "email": emails.get(a.user_id)} for a in rows],
        "meta": {"job": await job_out(db, me, j, detail=True)},
    }


class AppUpdate(BaseModel):
    status: Literal["submitted", "reviewed", "shortlisted", "rejected", "hired"] | None = None
    poster_note: str | None = Field(None, max_length=1000)


@router.patch("/applications/{app_id}", summary="Update an application's status (job poster or career office)")
async def update_application(app_id: uuid.UUID, body: AppUpdate, me: Principal = Depends(viewer), db: AsyncSession = Depends(get_db)):
    a = await db.get(JobApplication, app_id)
    if not a:
        raise not_found("Application")
    j = await _poster_job(db, me, a.job_id)
    if a.status == "withdrawn":
        raise conflict("WITHDRAWN", "The applicant withdrew this application.")
    changed = body.status and body.status != a.status
    if body.status:
        a.status = body.status
    if "poster_note" in body.model_fields_set:
        a.poster_note = body.poster_note
    if changed:
        u = await db.get(User, a.user_id)
        general = await settings_store.get_group(db, "general")
        await notifications.notify(
            db,
            u.id,
            "jobs",
            "application_status",
            f"Your application for {j.title}: {a.status}",
            link="/portal/jobs/tab/applications",
            email=(
                "jobs.application_status",
                {
                    "job": j.title,
                    "organization": j.organization,
                    "status": a.status.replace("_", " "),
                    "link": f"{general.app_url}/portal/jobs/tab/applications",
                },
            ),
        )
    await db.flush()
    people = await authors(db, {a.user_id})
    return {"data": _app_out(a, people, for_poster=True)}


@router.get("/applications/{app_id}/resume", summary="Download the CV sent with an application")
async def application_resume(app_id: uuid.UUID, me: Principal = Depends(viewer), db: AsyncSession = Depends(get_db)):
    a = await db.get(JobApplication, app_id)
    if not a or not a.resume_id:
        raise not_found("CV")
    if a.user_id != me.id:
        j = await db.get(JobPost, a.job_id)
        if not j or (j.posted_by != me.id and not me.can("jobs.view")):
            raise not_found("CV")
    return await _resume_file(db, a.resume_id)


# ── employers ───────────────────────────────────────────────────────────────
class EmployerIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=150)
    website: str | None = Field(None, max_length=300)
    industry: str | None = Field(None, max_length=100)
    description: str = Field("", max_length=2000)
    logo_id: uuid.UUID | None = None
    employees: str | None = Field(None, max_length=30)
    headquarters: str | None = Field(None, max_length=150)


def _employer_out(e: Employer, logo: str | None = None) -> dict:
    return {
        "id": str(e.id),
        "name": e.name,
        "website": e.website,
        "industry": e.industry,
        "description": e.description,
        "employees": e.employees,
        "headquarters": e.headquarters,
        "logo": logo,
        "status": e.status,
        "rejection_reason": e.rejection_reason,
        "created_at": e.created_at,
    }


@router.post("/employers", status_code=201, summary="Register your organisation as an employer (reviewed by the career office)")
async def register_employer(body: EmployerIn, me: Principal = Depends(require("portal.jobs.post")), db: AsyncSession = Depends(get_db)):
    n = (await db.execute(select(func.count()).select_from(Employer).where(Employer.owner_id == me.id))).scalar_one()
    if n >= 5:
        raise conflict("LIMIT_REACHED", "You can register up to 5 organisations.")
    e = Employer(**body.model_dump(), owner_id=me.id, status="pending")
    db.add(e)
    await db.flush()
    return {"data": _employer_out(e, await _logo(db, e.logo_id))}


@router.get("/employers/mine", summary="Organisations you registered")
async def my_employers(me: Principal = Depends(viewer), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Employer).where(Employer.owner_id == me.id).order_by(Employer.name))).scalars().all()
    return {"data": [_employer_out(e, await _logo(db, e.logo_id)) for e in rows]}


# ── career office ───────────────────────────────────────────────────────────
@admin.get("", summary="All job postings")
async def admin_jobs(
    status: Literal["pending", "approved", "rejected", "closed"] | None = None,
    q: str | None = Query(None, max_length=100),
    p: PageParams = Depends(page_params),
    me: Principal = Depends(require("jobs.view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(JobPost)
    if status:
        stmt = stmt.where(JobPost.status == status)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(JobPost.title).like(like), func.lower(JobPost.organization).like(like)))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        (await db.execute(stmt.order_by(JobPost.created_at.desc()).offset((p.page - 1) * p.page_size).limit(p.page_size))).scalars().all()
    )
    counts = dict((await db.execute(select(JobPost.status, func.count()).group_by(JobPost.status))).all())
    return {"data": [await job_out(db, me, j, detail=True) for j in rows], "meta": {**_meta(p, total), "counts": counts}}


class Decision(BaseModel):
    reason: str | None = Field(None, max_length=300)


async def _decide_job(db: AsyncSession, me: Principal, job_id: uuid.UUID, approve: bool, reason: str | None, request: Request) -> JobPost:
    j = await db.get(JobPost, job_id)
    if not j:
        raise not_found("Job")
    if not approve and not reason:
        raise AppError(
            422, "VALIDATION_ERROR", "Give a reason so the poster can correct the job.", [{"field": "reason", "message": "Required."}]
        )
    j.status = "approved" if approve else "rejected"
    j.approved_by, j.approved_at = (me.id, datetime.now(UTC)) if approve else (None, None)
    if approve:
        from .extras import notify_alerts

        await notify_alerts(db, j)
    j.rejection_reason = None if approve else reason
    if j.posted_by and j.posted_by != me.id and (u := await db.get(User, j.posted_by)):
        general = await settings_store.get_group(db, "general")
        await notifications.notify(
            db,
            u.id,
            "jobs",
            "job_approved" if approve else "job_rejected",
            f"Your job is live: {j.title}" if approve else f"Your job needs changes: {j.title}",
            body=reason or "",
            link=f"/portal/jobs/{j.id}",
            email=(
                "jobs.approved" if approve else "jobs.rejected",
                {"job": j.title, "reason": reason or "", "link": f"{general.app_url}/portal/jobs/{j.id}"},
            ),
        )
    await record(
        db,
        actor_id=me.id,
        action="approve" if approve else "reject",
        entity="job",
        entity_id=j.id,
        summary=f"{'Approved' if approve else 'Rejected'} job {j.title}",
        data={"reason": reason},
        ip=client_ip(request),
    )
    return j


@admin.post("/{job_id}/approve", summary="Approve and list a job")
async def approve_job(
    job_id: uuid.UUID, request: Request, me: Principal = Depends(require("jobs.approve")), db: AsyncSession = Depends(get_db)
):
    return {"data": await job_out(db, me, await _decide_job(db, me, job_id, True, None, request), detail=True)}


@admin.post("/{job_id}/reject", summary="Reject a job (the poster can correct and resubmit)")
async def reject_job(
    job_id: uuid.UUID, body: Decision, request: Request, me: Principal = Depends(require("jobs.reject")), db: AsyncSession = Depends(get_db)
):
    return {"data": await job_out(db, me, await _decide_job(db, me, job_id, False, body.reason, request), detail=True)}


@admin.delete("/{job_id}", summary="Delete a job")
async def delete_job(
    job_id: uuid.UUID, request: Request, me: Principal = Depends(require("jobs.delete")), db: AsyncSession = Depends(get_db)
):
    j = await db.get(JobPost, job_id)
    if not j:
        raise not_found("Job")
    await db.delete(j)
    await record(
        db, actor_id=me.id, action="delete", entity="job", entity_id=job_id, summary=f"Deleted job {j.title}", ip=client_ip(request)
    )
    return {"data": {"ok": True}}


@admin.get("/export", summary="Export jobs (CSV)")
async def export_jobs(request: Request, me: Principal = Depends(require("jobs.export")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(JobPost).order_by(JobPost.created_at.desc()))).scalars().all()
    apps = dict((await db.execute(select(JobApplication.job_id, func.count()).group_by(JobApplication.job_id))).all())
    await record(db, actor_id=me.id, action="export", entity="job", summary=f"Exported {len(rows)} jobs", ip=client_ip(request))
    await db.commit()
    return csv_response(
        "jobs.csv",
        ["Title", "Organisation", "Type", "Location", "Status", "Deadline", "Views", "Applications", "Posted"],
        (
            [
                j.title,
                j.organization,
                j.employment_type,
                j.location,
                j.status,
                j.deadline.isoformat() if j.deadline else "",
                j.views,
                apps.get(j.id, 0),
                j.created_at.isoformat(),
            ]
            for j in rows
        ),
    )


@admin.get("/employers", summary="Employer registrations")
async def admin_employers(
    status: Literal["pending", "approved", "rejected"] | None = None,
    me: Principal = Depends(require("jobs.view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Employer)
    if status:
        stmt = stmt.where(Employer.status == status)
    rows = (await db.execute(stmt.order_by(Employer.created_at.desc()).limit(500))).scalars().all()
    owners = await authors(db, {e.owner_id for e in rows})
    return {"data": [{**_employer_out(e, await _logo(db, e.logo_id)), "owner": owners.get(e.owner_id)} for e in rows]}


class EmployerDecision(BaseModel):
    approve: bool
    reason: str | None = Field(None, max_length=300)


@admin.post("/employers/{employer_id}/decide", summary="Approve or reject an employer")
async def decide_employer(
    employer_id: uuid.UUID,
    body: EmployerDecision,
    request: Request,
    me: Principal = Depends(require("jobs.approve")),
    db: AsyncSession = Depends(get_db),
):
    e = await db.get(Employer, employer_id)
    if not e:
        raise not_found("Employer")
    e.status, e.rejection_reason = ("approved", None) if body.approve else ("rejected", body.reason)
    if body.approve and e.owner_id:
        from ...models import Role

        u = await db.get(User, e.owner_id)
        role = (await db.execute(select(Role).where(Role.key == "employer"))).scalar_one_or_none()
        if u and role and role not in u.roles:
            u.roles = [*u.roles, role]  # may post jobs on behalf of the organisation
            from ...core.deps import forget_principals

            forget_principals(u.id)
    await record(
        db,
        actor_id=me.id,
        action="approve" if body.approve else "reject",
        entity="employer",
        entity_id=e.id,
        summary=f"Employer {e.name}: {'approved' if body.approve else 'rejected'}",
        ip=client_ip(request),
    )
    return {"data": _employer_out(e, await _logo(db, e.logo_id))}


class CategoryIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=80)
    position: int = 0


@admin.post("/categories", status_code=201, summary="Add a job category")
async def add_category(body: CategoryIn, me: Principal = Depends(require("jobs.edit")), db: AsyncSession = Depends(get_db)):
    if (await db.execute(select(JobCategory.id).where(func.lower(JobCategory.name) == body.name.strip().lower()))).first():
        raise conflict("EXISTS", "This category already exists.")
    c = JobCategory(name=body.name.strip(), position=body.position)
    db.add(c)
    await db.flush()
    return {"data": {"id": str(c.id), "name": c.name}}


@admin.delete("/categories/{category_id}", summary="Remove a job category")
async def delete_category(category_id: uuid.UUID, me: Principal = Depends(require("jobs.edit")), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(JobCategory).where(JobCategory.id == category_id))
    return {"data": {"ok": True}}


class ResourceIn(BaseModel):
    title: str = Field(..., min_length=2, max_length=200)
    category: str = Field("General", max_length=60)
    description: str = Field("", max_length=1000)
    url: str | None = Field(None, max_length=500)
    media_id: uuid.UUID | None = None
    published: bool = True
    position: int = 0


@admin.get("/resources", summary="Career resources (all)")
async def admin_resources(me: Principal = Depends(require("jobs.view")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(CareerResource).order_by(CareerResource.category, CareerResource.position))).scalars().all()
    return {
        "data": [
            {
                "id": str(r.id),
                "title": r.title,
                "category": r.category,
                "description": r.description,
                "url": r.url,
                "media_id": str(r.media_id) if r.media_id else None,
                "published": r.published,
                "position": r.position,
            }
            for r in rows
        ]
    }


@admin.post("/resources", status_code=201, summary="Add a career resource")
async def add_resource(body: ResourceIn, me: Principal = Depends(require("jobs.create")), db: AsyncSession = Depends(get_db)):
    if not body.url and not body.media_id:
        raise AppError(422, "VALIDATION_ERROR", "Add a link or a file.", [{"field": "url", "message": "Required."}])
    r = CareerResource(**body.model_dump())
    db.add(r)
    await db.flush()
    return {"data": {"id": str(r.id)}}


@admin.put("/resources/{resource_id}", summary="Edit a career resource")
async def edit_resource(
    resource_id: uuid.UUID, body: ResourceIn, me: Principal = Depends(require("jobs.edit")), db: AsyncSession = Depends(get_db)
):
    r = await db.get(CareerResource, resource_id)
    if not r:
        raise not_found("Resource")
    for k, v in body.model_dump().items():
        setattr(r, k, v)
    return {"data": {"id": str(r.id)}}


@admin.delete("/resources/{resource_id}", summary="Delete a career resource")
async def delete_resource(resource_id: uuid.UUID, me: Principal = Depends(require("jobs.delete")), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(CareerResource).where(CareerResource.id == resource_id))
    return {"data": {"ok": True}}
