"""Jobs (redesign phase 4): job activity, job alerts, similar jobs and referrals."""

import uuid
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr, Field, model_validator
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.deps import Principal, require, require_module
from ...core.errors import conflict, forbidden, not_found
from ...core.redis import enforce
from ...models import JobAlert, JobApplication, JobPost, JobReferral, SavedJob, User
from ...services import notifications
from ..community.service import authors

router = APIRouter(prefix="/api/v1/jobs", tags=["Jobs"], dependencies=[Depends(require_module("jobs"))])
viewer = require("portal.jobs.view", "jobs.view", any_of=True)
ALERT_CAP = 500


def _matches(a: JobAlert, j: JobPost) -> bool:
    if a.employment_type and a.employment_type != j.employment_type:
        return False
    if a.remote is not None and a.remote != j.remote:
        return False
    if a.location and a.location.lower() not in (j.location or "").lower():
        return False
    if a.q:
        hay = " ".join([j.title, j.organization, " ".join(j.skills or [])]).lower()
        if not all(w in hay for w in a.q.lower().split()):
            return False
    return True


async def notify_alerts(db: AsyncSession, j: JobPost) -> int:
    """Tell members whose job alerts match a newly listed job (one notification per member)."""
    alerts = (await db.execute(select(JobAlert).where(JobAlert.user_id != j.posted_by).limit(ALERT_CAP * 4))).scalars().all()
    told: set[uuid.UUID] = set()
    for a in alerts:
        if a.user_id in told or len(told) >= ALERT_CAP or not _matches(a, j):
            continue
        told.add(a.user_id)
        await notifications.notify(
            db, a.user_id, "jobs", "job_alert", f"New job: {j.title} at {j.organization}", body=j.location, link=f"/portal/jobs/{j.id}"
        )
    return len(told)


@router.get("/activity", summary="Your applications, saved jobs, alerts and referrals (counts)")
async def activity(me: Principal = Depends(viewer), db: AsyncSession = Depends(get_db)):
    async def count(model, *where) -> int:
        return (await db.execute(select(func.count()).select_from(model).where(*where))).scalar_one()

    return {
        "data": {
            "applications": await count(JobApplication, JobApplication.user_id == me.id, JobApplication.status != "withdrawn"),
            "saved": await count(SavedJob, SavedJob.user_id == me.id),
            "alerts": await count(JobAlert, JobAlert.user_id == me.id),
            "referrals": await count(JobReferral, JobReferral.referrer_id == me.id),
        }
    }


class AlertIn(BaseModel):
    q: str | None = Field(None, max_length=100)
    employment_type: Literal["full_time", "part_time", "internship", "contract", "temporary", "volunteer"] | None = None
    location: str | None = Field(None, max_length=100)
    remote: bool | None = None

    @model_validator(mode="after")
    def _any(self):
        if not (self.q or self.employment_type or self.location or self.remote is not None):
            raise ValueError("Choose at least one filter for the alert.")
        return self


def _alert_out(a: JobAlert) -> dict:
    return {
        "id": str(a.id),
        "q": a.q,
        "employment_type": a.employment_type,
        "location": a.location,
        "remote": a.remote,
        "created_at": a.created_at,
    }


@router.get("/alerts", summary="Your job alerts")
async def list_alerts(me: Principal = Depends(viewer), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(JobAlert).where(JobAlert.user_id == me.id).order_by(JobAlert.created_at.desc()))).scalars().all()
    return {"data": [_alert_out(a) for a in rows]}


@router.post("/alerts", status_code=201, summary="Create a job alert")
async def create_alert(body: AlertIn, me: Principal = Depends(viewer), db: AsyncSession = Depends(get_db)):
    n = (await db.execute(select(func.count()).select_from(JobAlert).where(JobAlert.user_id == me.id))).scalar_one()
    if n >= 10:
        raise conflict("LIMIT_REACHED", "You can keep up to 10 job alerts.")
    a = JobAlert(
        user_id=me.id,
        q=(body.q or "").strip() or None,
        employment_type=body.employment_type,
        location=(body.location or "").strip() or None,
        remote=body.remote,
    )
    db.add(a)
    await db.flush()
    await db.refresh(a)
    return {"data": _alert_out(a)}


@router.delete("/alerts/{alert_id}", summary="Delete a job alert")
async def delete_alert(alert_id: uuid.UUID, me: Principal = Depends(viewer), db: AsyncSession = Depends(get_db)):
    a = await db.get(JobAlert, alert_id)
    if not a or a.user_id != me.id:
        raise not_found("Alert")
    await db.delete(a)
    return {"data": {"ok": True}}


@router.get("/{job_id}/similar", summary="Similar open jobs")
async def similar(job_id: uuid.UUID, me: Principal = Depends(viewer), db: AsyncSession = Depends(get_db)):
    from .router import job_out, today

    j = await db.get(JobPost, job_id)
    if not j:
        raise not_found("Job")
    same = [JobPost.employment_type == j.employment_type]
    if j.category_id:
        same.append(JobPost.category_id == j.category_id)
    rows = (
        (
            await db.execute(
                select(JobPost)
                .where(
                    JobPost.status == "approved",
                    JobPost.id != j.id,
                    or_(JobPost.deadline.is_(None), JobPost.deadline >= today()),
                    or_(*same),
                )
                .order_by((JobPost.category_id == j.category_id).desc().nulls_last(), JobPost.approved_at.desc().nulls_last())
                .limit(4)
            )
        )
        .scalars()
        .all()
    )
    return {"data": [await job_out(db, me, x) for x in rows]}


class ReferralIn(BaseModel):
    candidate_user_id: uuid.UUID | None = None
    candidate_name: str | None = Field(None, max_length=150)
    candidate_email: EmailStr | None = None
    note: str = Field("", max_length=1000)

    @model_validator(mode="after")
    def _who(self):
        if not self.candidate_user_id and not (self.candidate_name and self.candidate_email):
            raise ValueError("Choose a member, or enter the candidate's name and email.")
        return self


def _ref_out(r: JobReferral, people: dict, job: JobPost | None = None) -> dict:
    return {
        "id": str(r.id),
        "job": {"id": str(job.id), "title": job.title, "organization": job.organization} if job else None,
        "referrer": people.get(r.referrer_id),
        "candidate": people.get(r.candidate_user_id) if r.candidate_user_id else None,
        "candidate_name": r.candidate_name,
        "candidate_email": r.candidate_email,
        "note": r.note,
        "status": r.status,
        "created_at": r.created_at,
    }


@router.post("/{job_id}/referrals", status_code=201, summary="Refer a candidate for a job")
async def refer(
    job_id: uuid.UUID, body: ReferralIn, me: Principal = Depends(require("portal.jobs.view")), db: AsyncSession = Depends(get_db)
):
    j = await db.get(JobPost, job_id)
    if not j or j.status != "approved":
        raise not_found("Job")
    await enforce(f"job-referral:{me.id}", 20, 86400, "You have sent many referrals today.")
    name, email = body.candidate_name, body.candidate_email
    if body.candidate_user_id:
        u = await db.get(User, body.candidate_user_id)
        if not u or u.deleted_at or u.id == me.id:
            raise not_found("Member")
        name, email = u.full_name, None
        dup = (await db.execute(select(JobReferral.id).where(JobReferral.job_id == j.id, JobReferral.candidate_user_id == u.id))).first()
        if dup:
            raise conflict("ALREADY_REFERRED", "This member has already been referred for this job.")
    r = JobReferral(
        job_id=j.id, referrer_id=me.id, candidate_user_id=body.candidate_user_id, candidate_name=name, candidate_email=email, note=body.note
    )
    db.add(r)
    await db.flush()
    await db.refresh(r)
    if j.posted_by and j.posted_by != me.id:
        await notifications.notify(
            db,
            j.posted_by,
            "jobs",
            "job_referral",
            f"{me.full_name} referred {name} for {j.title}",
            body=body.note[:140],
            link=f"/portal/jobs/{j.id}?tab=referrals",
            actor_id=me.id,
        )
    if body.candidate_user_id:
        await notifications.notify(
            db,
            body.candidate_user_id,
            "jobs",
            "job_referred",
            f"{me.full_name} referred you for {j.title} at {j.organization}",
            link=f"/portal/jobs/{j.id}",
            actor_id=me.id,
        )
    return {"data": _ref_out(r, await authors(db, {me.id, body.candidate_user_id}), j)}


@router.get("/{job_id}/referrals", summary="Referrals for a job you posted")
async def job_referrals(job_id: uuid.UUID, me: Principal = Depends(viewer), db: AsyncSession = Depends(get_db)):
    j = await db.get(JobPost, job_id)
    if not j:
        raise not_found("Job")
    if j.posted_by != me.id and not me.can("jobs.view"):
        raise forbidden()
    rows = (await db.execute(select(JobReferral).where(JobReferral.job_id == j.id).order_by(JobReferral.created_at.desc()))).scalars().all()
    people = await authors(db, {r.referrer_id for r in rows} | {r.candidate_user_id for r in rows if r.candidate_user_id})
    return {"data": [_ref_out(r, people, j) for r in rows]}


@router.get("/referrals/mine", summary="Referrals you made")
async def my_referrals(me: Principal = Depends(viewer), db: AsyncSession = Depends(get_db)):
    rows = (
        await db.execute(
            select(JobReferral, JobPost)
            .join(JobPost, JobPost.id == JobReferral.job_id)
            .where(JobReferral.referrer_id == me.id)
            .order_by(JobReferral.created_at.desc())
        )
    ).all()
    people = await authors(db, {r.candidate_user_id for r, _ in rows if r.candidate_user_id} | {me.id})
    return {"data": [_ref_out(r, people, j) for r, j in rows]}
