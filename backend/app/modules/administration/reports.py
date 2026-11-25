"""Reports and analytics: aggregated figures with date filters, chart data, tables and CSV / Excel / PDF exports.

Reports contain counts and totals only — never personal details. For staff who cannot see alumni records, groups
smaller than MIN_GROUP are merged into "Other" so that a count can never point at one person.
"""

from datetime import UTC, date, datetime, time, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import String, case, cast, func, literal_column, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.audit import record
from ...core.db import get_db
from ...core.deps import Principal, require
from ...core.pagination import csv_response
from ...models import (
    AlumniConnection,
    AlumniProfile,
    Campaign,
    Comment,
    Donation,
    Event,
    EventAttendance,
    EventFeedback,
    EventRegistration,
    JobApplication,
    JobPost,
    Mentor,
    MentorshipRequest,
    MentorshipSession,
    Message,
    Post,
    Scholarship,
    ScholarshipAward,
    Session,
    User,
)
from ...services import exports

router = APIRouter(prefix="/api/v1/admin/reports", tags=["Admin: reports"])
MIN_GROUP = 3

REPORTS: dict[str, tuple[str, str, str]] = {
    # key: (title, description, area permission that also unlocks small groups)
    "registrations": ("Alumni registration trends", "New registrations and verifications per month.", "alumni.view"),
    "graduation_year": ("Alumni by graduation year", "Registered alumni per graduating class.", "alumni.view"),
    "location": ("Alumni by location", "Where alumni live — by country, then city.", "alumni.view"),
    "profession": ("Alumni by profession", "Alumni per industry.", "alumni.view"),
    "organization": ("Alumni by organization", "Organizations where alumni work today.", "alumni.view"),
    "engagement": ("Alumni engagement", "Active members, posts, comments, messages and connections per month.", "alumni.view"),
    "events": ("Event participation", "Registrations, attendance and ratings per event.", "events.view"),
    "mentorship": ("Mentorship activity", "Requests, acceptance, sessions and mentors.", "mentorship.view"),
    "jobs": ("Job opportunities", "Jobs posted, by type, with applications.", "jobs.view"),
    "donations": ("Donation reports", "Confirmed donations per month and per campaign.", "donations.view"),
    "scholarships": ("Scholarship sponsorship", "Scholarship funds, sponsors and awards.", "scholarships.view"),
    "profile_completion": ("Profile completion", "How complete member profiles are.", "alumni.view"),
    "verification": ("Verification status", "Members by verification status.", "alumni.view"),
}
ReportKey = Literal[
    "registrations",
    "graduation_year",
    "location",
    "profession",
    "organization",
    "engagement",
    "events",
    "mentorship",
    "jobs",
    "donations",
    "scholarships",
    "profile_completion",
    "verification",
]


class Range:
    def __init__(self, date_from: date | None, date_to: date | None):
        today = datetime.now(UTC).date()
        self.to = date_to or today
        self.frm = date_from or (self.to.replace(day=1) - timedelta(days=334)).replace(day=1)  # about 12 months
        if self.frm > self.to:
            self.frm, self.to = self.to, self.frm
        self.start = datetime.combine(self.frm, time.min, UTC)
        self.end = datetime.combine(self.to + timedelta(days=1), time.min, UTC)

    def where(self, col):
        return (col >= self.start) & (col < self.end)

    def months(self) -> list[str]:
        out, d = [], self.frm.replace(day=1)
        while d <= self.to:
            out.append(d.strftime("%Y-%m"))
            d = (d.replace(day=28) + timedelta(days=4)).replace(day=1)
        return out[-60:]

    def label(self) -> str:
        return f"{self.frm:%d %b %Y} – {self.to:%d %b %Y}"


def month_of(col):
    return func.to_char(func.date_trunc("month", col), literal_column("'YYYY-MM'"))


def live_profiles():
    return select(AlumniProfile).join(User, (User.id == AlumniProfile.user_id) & User.deleted_at.is_(None))


def suppress(rows: list[tuple[str, int]], full: bool) -> list[tuple[str, int]]:
    if full:
        return rows
    big = [(k, v) for k, v in rows if v >= MIN_GROUP]
    small = sum(v for _, v in rows if v < MIN_GROUP)
    return big + ([(f"Other (groups under {MIN_GROUP})", small)] if small else [])


def _series(months: list[str], data: dict[str, int | float]) -> list:
    return [data.get(m, 0) for m in months]


def _monthly(rows) -> dict[str, int | float]:
    return {m: (float(v) if not isinstance(v, int) else v) for m, v in rows}


def fmt_month(m: str) -> str:
    return datetime.strptime(m, "%Y-%m").strftime("%b %Y")


async def _count_by_month(db: AsyncSession, col, rng: Range, *where) -> dict:
    stmt = select(month_of(col), func.count()).where(rng.where(col), *where).group_by(literal_column("1"))
    return _monthly((await db.execute(stmt)).all())


async def _distribution(
    db: AsyncSession, column, rng: Range, full: bool, label: str, unknown: str = "Not given", limit: int | None = None, *where
) -> dict:
    stmt = (
        select(func.coalesce(func.nullif(func.trim(cast(column, String)), ""), unknown), func.count())
        .select_from(AlumniProfile)
        .join(User, (User.id == AlumniProfile.user_id) & User.deleted_at.is_(None))
        .where(rng.where(User.created_at), *where)
        .group_by(literal_column("1"))
        .order_by(func.count().desc())
    )
    rows = [(str(k), v) for k, v in (await db.execute(stmt)).all()]
    rows = suppress(rows, full)
    total = sum(v for _, v in rows)
    shown = rows[:limit] if limit else rows
    return {
        "summary": [
            {"label": "Members", "value": total},
            {"label": f"{label}s", "value": len([r for r in rows if not r[0].startswith("Other")])},
        ],
        "chart": {
            "type": "hbar",
            "labels": [k for k, _ in shown[:20]],
            "series": [{"name": "Members", "values": [v for _, v in shown[:20]]}],
        },
        "columns": [
            {"key": "group", "label": label},
            {"key": "count", "label": "Members", "type": "number"},
            {"key": "share", "label": "Share", "type": "percent"},
        ],
        "rows": [[k, v, round(100 * v / total, 1) if total else 0] for k, v in shown],
    }


# ── report builders ─────────────────────────────────────────────────────────
async def r_registrations(db, rng: Range, full: bool):
    months = rng.months()
    live = User.deleted_at.is_(None)
    regs = await _count_by_month(db, User.created_at, rng, live, User.id.in_(select(AlumniProfile.user_id)))
    ver = await _count_by_month(db, AlumniProfile.verified_at, rng)
    rows = [[fmt_month(m), regs.get(m, 0), ver.get(m, 0)] for m in months]
    return {
        "summary": [{"label": "Registrations", "value": sum(regs.values())}, {"label": "Verified", "value": sum(ver.values())}],
        "chart": {
            "type": "line",
            "labels": [fmt_month(m) for m in months],
            "series": [{"name": "Registrations", "values": _series(months, regs)}, {"name": "Verified", "values": _series(months, ver)}],
        },
        "columns": [
            {"key": "month", "label": "Month"},
            {"key": "registrations", "label": "Registrations", "type": "number"},
            {"key": "verified", "label": "Verified", "type": "number"},
        ],
        "rows": rows,
    }


async def r_graduation_year(db, rng, full):
    stmt = (
        select(AlumniProfile.graduation_year, func.count())
        .select_from(AlumniProfile)
        .join(User, (User.id == AlumniProfile.user_id) & User.deleted_at.is_(None))
        .where(rng.where(User.created_at), AlumniProfile.graduation_year.is_not(None), AlumniProfile.kind == "alumni")
        .group_by(literal_column("1"))
        .order_by(literal_column("1"))
    )
    rows = suppress([(str(y), n) for y, n in (await db.execute(stmt)).all()], full)
    total = sum(n for _, n in rows)
    return {
        "summary": [{"label": "Alumni with a graduation year", "value": total}, {"label": "Classes", "value": len(rows)}],
        "chart": {"type": "bar", "labels": [y for y, _ in rows], "series": [{"name": "Alumni", "values": [n for _, n in rows]}]},
        "columns": [
            {"key": "year", "label": "Graduation year"},
            {"key": "count", "label": "Alumni", "type": "number"},
            {"key": "share", "label": "Share", "type": "percent"},
        ],
        "rows": [[y, n, round(100 * n / total, 1) if total else 0] for y, n in rows],
    }


async def r_location(db, rng, full):
    country = await _distribution(db, AlumniProfile.country, rng, full, "Country")
    stmt = (
        select(
            func.coalesce(AlumniProfile.country, "Not given"),
            func.coalesce(func.nullif(func.trim(AlumniProfile.city), ""), "Not given"),
            func.count(),
        )
        .select_from(AlumniProfile)
        .join(User, (User.id == AlumniProfile.user_id) & User.deleted_at.is_(None))
        .where(rng.where(User.created_at))
        .group_by(literal_column("1"), literal_column("2"))
        .order_by(func.count().desc())
    )
    cities = [(f"{c}, {k}", n) for k, c, n in (await db.execute(stmt)).all()]
    cities = suppress(cities, full)
    total = sum(n for _, n in cities)
    country["columns"] = [
        {"key": "place", "label": "City, country"},
        {"key": "count", "label": "Members", "type": "number"},
        {"key": "share", "label": "Share", "type": "percent"},
    ]
    country["rows"] = [[k, n, round(100 * n / total, 1) if total else 0] for k, n in cities]
    country["summary"].append({"label": "Cities", "value": len([c for c in cities if not c[0].startswith("Other")])})
    return country


async def r_profession(db, rng, full):
    return await _distribution(db, AlumniProfile.industry, rng, full, "Industry")


async def r_organization(db, rng, full):
    return await _distribution(db, AlumniProfile.organization, rng, full, "Organization", "Not given", 200)


async def r_engagement(db, rng, full):
    months = rng.months()
    active = _monthly(
        (
            await db.execute(
                select(month_of(Session.last_used_at), func.count(func.distinct(Session.user_id)))
                .where(rng.where(Session.last_used_at))
                .group_by(literal_column("1"))
            )
        ).all()
    )
    posts = await _count_by_month(db, Post.created_at, rng, Post.status == "published")
    comments = await _count_by_month(db, Comment.created_at, rng, Comment.status == "published")
    messages = await _count_by_month(db, Message.created_at, rng, Message.deleted_at.is_(None))
    conns = await _count_by_month(db, AlumniConnection.responded_at, rng, AlumniConnection.status == "accepted")
    series = [("Active members", active), ("Posts", posts), ("Comments", comments), ("Messages", messages), ("New connections", conns)]
    return {
        "summary": [{"label": n, "value": sum(d.values()) if n != "Active members" else max(d.values(), default=0)} for n, d in series],
        "chart": {
            "type": "line",
            "labels": [fmt_month(m) for m in months],
            "series": [{"name": n, "values": _series(months, d)} for n, d in series if n != "Messages"],
        },
        "columns": [{"key": "month", "label": "Month"}]
        + [{"key": n.lower().replace(" ", "_"), "label": n, "type": "number"} for n, _ in series],
        "rows": [[fmt_month(m), *[d.get(m, 0) for _, d in series]] for m in months],
        "notes": "Active members: distinct members who used the portal in the month. The highest month is shown above.",
    }


async def r_events(db, rng, full):
    regs = (
        select(EventRegistration.event_id, func.count().label("n"))
        .where(EventRegistration.status.in_(("registered", "attended")))
        .group_by(EventRegistration.event_id)
        .subquery()
    )
    att = select(EventAttendance.event_id, func.count().label("n")).group_by(EventAttendance.event_id).subquery()
    fb = select(EventFeedback.event_id, func.avg(EventFeedback.rating).label("r")).group_by(EventFeedback.event_id).subquery()
    stmt = (
        select(Event.title, Event.kind, Event.starts_at, func.coalesce(regs.c.n, 0), func.coalesce(att.c.n, 0), fb.c.r, Event.status)
        .outerjoin(regs, regs.c.event_id == Event.id)
        .outerjoin(att, att.c.event_id == Event.id)
        .outerjoin(fb, fb.c.event_id == Event.id)
        .where(rng.where(Event.starts_at), Event.status != "draft")
        .order_by(Event.starts_at)
    )
    rows = (await db.execute(stmt)).all()
    total_r, total_a = sum(r[3] for r in rows), sum(r[4] for r in rows)
    return {
        "summary": [
            {"label": "Events", "value": len(rows)},
            {"label": "Registrations", "value": total_r},
            {"label": "Attended", "value": total_a},
            {"label": "Attendance rate", "value": f"{round(100 * total_a / total_r)}%" if total_r else "—"},
        ],
        "chart": {
            "type": "bar",
            "labels": [r[0][:28] for r in rows[-15:]],
            "series": [
                {"name": "Registered", "values": [r[3] for r in rows[-15:]]},
                {"name": "Attended", "values": [r[4] for r in rows[-15:]]},
            ],
        },
        "columns": [
            {"key": "event", "label": "Event"},
            {"key": "kind", "label": "Type"},
            {"key": "date", "label": "Date"},
            {"key": "registered", "label": "Registered", "type": "number"},
            {"key": "attended", "label": "Attended", "type": "number"},
            {"key": "rating", "label": "Rating", "type": "number"},
            {"key": "status", "label": "Status"},
        ],
        "rows": [
            [t, k.replace("_", " ").capitalize(), f"{s:%d %b %Y}", n, a, round(float(r), 1) if r else "", st.capitalize()]
            for t, k, s, n, a, r, st in rows
        ],
    }


async def r_mentorship(db, rng, full):
    months = rng.months()
    req = await _count_by_month(db, MentorshipRequest.created_at, rng)
    acc = await _count_by_month(db, MentorshipRequest.responded_at, rng, MentorshipRequest.status.in_(("accepted", "completed")))
    ses = await _count_by_month(db, MentorshipSession.scheduled_at, rng, MentorshipSession.status == "completed")
    status = dict(
        (
            await db.execute(
                select(MentorshipRequest.status, func.count()).where(rng.where(MentorshipRequest.created_at)).group_by(literal_column("1"))
            )
        ).all()
    )
    mentors = (await db.execute(select(func.count()).select_from(Mentor).where(Mentor.status == "approved"))).scalar_one()
    total = sum(status.values())
    return {
        "summary": [
            {"label": "Approved mentors", "value": mentors},
            {"label": "Requests", "value": total},
            {"label": "Accepted", "value": status.get("accepted", 0) + status.get("completed", 0)},
            {"label": "Completed sessions", "value": sum(ses.values())},
        ],
        "chart": {
            "type": "line",
            "labels": [fmt_month(m) for m in months],
            "series": [
                {"name": "Requests", "values": _series(months, req)},
                {"name": "Accepted", "values": _series(months, acc)},
                {"name": "Sessions held", "values": _series(months, ses)},
            ],
        },
        "columns": [
            {"key": "month", "label": "Month"},
            {"key": "requests", "label": "Requests", "type": "number"},
            {"key": "accepted", "label": "Accepted", "type": "number"},
            {"key": "sessions", "label": "Sessions held", "type": "number"},
        ],
        "rows": [[fmt_month(m), req.get(m, 0), acc.get(m, 0), ses.get(m, 0)] for m in months],
    }


async def r_jobs(db, rng, full):
    apps = select(JobApplication.job_id, func.count().label("n")).group_by(JobApplication.job_id).subquery()
    stmt = (
        select(
            JobPost.employment_type,
            func.count(),
            func.sum(func.coalesce(apps.c.n, 0)),
            func.count().filter(JobPost.approved_at.is_not(None)),
        )
        .outerjoin(apps, apps.c.job_id == JobPost.id)
        .where(rng.where(JobPost.created_at))
        .group_by(literal_column("1"))
        .order_by(func.count().desc())
    )
    rows = (await db.execute(stmt)).all()
    months = rng.months()
    posted = await _count_by_month(db, JobPost.created_at, rng)
    return {
        "summary": [
            {"label": "Jobs posted", "value": sum(r[1] for r in rows)},
            {"label": "Approved", "value": sum(r[3] for r in rows)},
            {"label": "Applications", "value": int(sum(r[2] or 0 for r in rows))},
        ],
        "chart": {
            "type": "line",
            "labels": [fmt_month(m) for m in months],
            "series": [{"name": "Jobs posted", "values": _series(months, posted)}],
        },
        "columns": [
            {"key": "type", "label": "Job type"},
            {"key": "posted", "label": "Posted", "type": "number"},
            {"key": "approved", "label": "Approved", "type": "number"},
            {"key": "applications", "label": "Applications", "type": "number"},
        ],
        "rows": [[t.replace("_", " ").capitalize(), n, a, int(ap or 0)] for t, n, ap, a in rows],
    }


async def r_donations(db, rng, full):
    months = rng.months()
    confirmed = Donation.status == "confirmed"
    by_month = _monthly(
        (
            await db.execute(
                select(month_of(Donation.confirmed_at), func.sum(Donation.amount))
                .where(confirmed, rng.where(Donation.confirmed_at))
                .group_by(literal_column("1"))
            )
        ).all()
    )
    stmt = (
        select(
            func.coalesce(Campaign.title, "General fund"),
            Donation.category,
            func.count(),
            func.sum(Donation.amount),
            func.count(func.distinct(func.coalesce(cast(Donation.user_id, String), Donation.donor_email))),
        )
        .outerjoin(Campaign, Campaign.id == Donation.campaign_id)
        .where(confirmed, rng.where(Donation.confirmed_at))
        .group_by(literal_column("1"), literal_column("2"))
        .order_by(func.sum(Donation.amount).desc())
    )
    rows = (await db.execute(stmt)).all()
    pledged = (
        await db.execute(
            select(func.count(), func.coalesce(func.sum(Donation.amount), 0)).where(
                Donation.status == "pledged", rng.where(Donation.created_at)
            )
        )
    ).one()
    currency = (await settings_store.get_group(db, "general")).currency
    total = float(sum(r[3] or 0 for r in rows))
    return {
        "summary": [
            {"label": f"Raised ({currency})", "value": f"{total:,.0f}"},
            {"label": "Gifts", "value": sum(r[2] for r in rows)},
            {"label": "Awaiting payment", "value": f"{pledged[0]} ({float(pledged[1]):,.0f})"},
        ],
        "chart": {
            "type": "bar",
            "labels": [fmt_month(m) for m in months],
            "series": [{"name": f"Raised ({currency})", "values": _series(months, by_month)}],
        },
        "columns": [
            {"key": "campaign", "label": "Campaign"},
            {"key": "purpose", "label": "Purpose"},
            {"key": "gifts", "label": "Gifts", "type": "number"},
            {"key": "amount", "label": f"Amount ({currency})", "type": "money"},
            {"key": "donors", "label": "Donors", "type": "number"},
        ],
        "rows": [[c, p.replace("_", " ").capitalize(), n, float(a or 0), d] for c, p, n, a, d in rows],
    }


async def r_scholarships(db, rng, full):
    awards = (
        select(ScholarshipAward.scholarship_id, func.count().label("n"), func.sum(ScholarshipAward.amount).label("a"))
        .where(ScholarshipAward.awarded_on >= rng.frm, ScholarshipAward.awarded_on <= rng.to)
        .group_by(ScholarshipAward.scholarship_id)
        .subquery()
    )
    stmt = (
        select(Scholarship.name, Scholarship.sponsor_name, Scholarship.status, func.coalesce(awards.c.n, 0), func.coalesce(awards.c.a, 0))
        .outerjoin(awards, awards.c.scholarship_id == Scholarship.id)
        .order_by(func.coalesce(awards.c.a, 0).desc(), Scholarship.name)
    )
    rows = (await db.execute(stmt)).all()
    currency = (await settings_store.get_group(db, "general")).currency
    return {
        "summary": [
            {"label": "Scholarship funds", "value": len(rows)},
            {"label": "Sponsors", "value": len({r[1] for r in rows if r[1]})},
            {"label": "Awards", "value": sum(r[3] for r in rows)},
            {"label": f"Awarded ({currency})", "value": f"{float(sum(r[4] for r in rows)):,.0f}"},
        ],
        "chart": {
            "type": "hbar",
            "labels": [r[0][:30] for r in rows[:15]],
            "series": [{"name": f"Awarded ({currency})", "values": [float(r[4]) for r in rows[:15]]}],
        },
        "columns": [
            {"key": "fund", "label": "Scholarship"},
            {"key": "sponsor", "label": "Sponsor"},
            {"key": "status", "label": "Status"},
            {"key": "awards", "label": "Awards", "type": "number"},
            {"key": "amount", "label": f"Amount ({currency})", "type": "money"},
        ],
        "rows": [[n, s or "—", st.capitalize(), c, float(a)] for n, s, st, c, a in rows],
        "notes": "Recipients are never listed in reports.",
    }


async def r_profile_completion(db, rng, full):
    bucket = case(
        (AlumniProfile.completion >= 100, "100%"),
        (AlumniProfile.completion >= 75, "75–99%"),
        (AlumniProfile.completion >= 50, "50–74%"),
        (AlumniProfile.completion >= 25, "25–49%"),
        else_="Under 25%",
    )
    stmt = (
        select(bucket, func.count(), func.avg(AlumniProfile.completion))
        .select_from(AlumniProfile)
        .join(User, (User.id == AlumniProfile.user_id) & User.deleted_at.is_(None))
        .where(rng.where(User.created_at))
        .group_by(literal_column("1"))
    )
    got = {b: (n, a) for b, n, a in (await db.execute(stmt)).all()}
    order = ["Under 25%", "25–49%", "50–74%", "75–99%", "100%"]
    total = sum(n for n, _ in got.values())
    avg = (sum(float(a) * n for n, a in got.values()) / total) if total else 0
    return {
        "summary": [
            {"label": "Members", "value": total},
            {"label": "Average completion", "value": f"{avg:.0f}%"},
            {"label": "Complete profiles", "value": got.get("100%", (0, 0))[0]},
        ],
        "chart": {"type": "bar", "labels": order, "series": [{"name": "Members", "values": [got.get(b, (0, 0))[0] for b in order]}]},
        "columns": [
            {"key": "band", "label": "Completion"},
            {"key": "count", "label": "Members", "type": "number"},
            {"key": "share", "label": "Share", "type": "percent"},
        ],
        "rows": [[b, got.get(b, (0, 0))[0], round(100 * got.get(b, (0, 0))[0] / total, 1) if total else 0] for b in order],
    }


async def r_verification(db, rng, full):
    stmt = (
        select(AlumniProfile.verification_status, func.count())
        .select_from(AlumniProfile)
        .join(User, (User.id == AlumniProfile.user_id) & User.deleted_at.is_(None))
        .where(rng.where(User.created_at))
        .group_by(literal_column("1"))
    )
    got = dict((await db.execute(stmt)).all())
    labels = {
        "verified": "Verified",
        "pending": "Pending review",
        "more_info": "More information requested",
        "rejected": "Rejected",
        "unverified": "Not submitted",
    }
    keys = [k for k in labels if k in got] + [k for k in got if k not in labels]
    total = sum(got.values())
    days = (
        await db.execute(
            select(func.avg(func.extract("epoch", AlumniProfile.verified_at - AlumniProfile.submitted_at) / 86400)).where(
                AlumniProfile.verified_at.is_not(None), AlumniProfile.submitted_at.is_not(None), rng.where(AlumniProfile.verified_at)
            )
        )
    ).scalar()
    methods = dict(
        (
            await db.execute(
                select(AlumniProfile.verification_method, func.count())
                .where(AlumniProfile.verification_status == "verified", rng.where(AlumniProfile.verified_at))
                .group_by(literal_column("1"))
            )
        ).all()
    )
    return {
        "summary": [
            {"label": "Members", "value": total},
            {"label": "Verified", "value": got.get("verified", 0)},
            {"label": "Waiting", "value": got.get("pending", 0) + got.get("more_info", 0)},
            {"label": "Average days to verify", "value": f"{float(days):.1f}" if days is not None else "—"},
        ],
        "chart": {
            "type": "donut",
            "labels": [labels.get(k, k) for k in keys],
            "series": [{"name": "Members", "values": [got[k] for k in keys]}],
        },
        "columns": [
            {"key": "status", "label": "Status"},
            {"key": "count", "label": "Members", "type": "number"},
            {"key": "share", "label": "Share", "type": "percent"},
        ],
        "rows": [[labels.get(k, k), got[k], round(100 * got[k] / total, 1) if total else 0] for k in keys]
        + [[f"  verified by {(m or 'other').replace('_', ' ')}", n, round(100 * n / total, 1) if total else 0] for m, n in methods.items()],
    }


BUILDERS = {k: globals()[f"r_{k}"] for k in REPORTS}


async def build(db: AsyncSession, key: str, rng: Range, p: Principal) -> dict:
    title, desc, area = REPORTS[key]
    full = p.can(area)
    data = await BUILDERS[key](db, rng, full)
    return {
        "key": key,
        "title": title,
        "description": desc,
        "period": rng.label(),
        "date_from": rng.frm,
        "date_to": rng.to,
        "suppressed": not full,
        **data,
    }


@router.get("", summary="Available reports")
async def list_reports(_: Principal = Depends(require("reports.view"))):
    return {"data": [{"key": k, "title": t, "description": d} for k, (t, d, _a) in REPORTS.items()]}


@router.get("/{key}", summary="Run a report")
async def run_report(
    key: ReportKey,
    date_from: date | None = None,
    date_to: date | None = None,
    me: Principal = Depends(require("reports.view")),
    db: AsyncSession = Depends(get_db),
):
    return {"data": await build(db, key, Range(date_from, date_to), me)}


@router.get("/{key}/export", summary="Export a report as CSV, Excel or PDF")
async def export_report(
    key: ReportKey,
    format: Literal["csv", "xlsx", "pdf"] = Query("csv"),
    date_from: date | None = None,
    date_to: date | None = None,
    me: Principal = Depends(require("reports.export")),
    db: AsyncSession = Depends(get_db),
):
    rng = Range(date_from, date_to)
    data = await build(db, key, rng, me)
    header = [c["label"] for c in data["columns"]]
    rows = data["rows"]
    general = await settings_store.get_group(db, "general")
    name = f"{key.replace('_', '-')}-{rng.frm:%Y%m%d}-{rng.to:%Y%m%d}"
    await record(
        db,
        actor_id=me.id,
        action="export",
        entity="report",
        entity_id=key,
        summary=f"Exported report '{data['title']}' ({format.upper()}, {rng.label()})",
    )
    await db.commit()
    subtitle = f"{data['period']} · {data['description']}"
    if format == "csv":
        return csv_response(f"{name}.csv", header, rows)
    if format == "xlsx":
        body = exports.xlsx(data["title"], header, rows, subtitle)
        return Response(
            body,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{name}.xlsx"'},
        )
    body = exports.pdf(
        data["title"], header, rows, subtitle, [(s["label"], str(s["value"])) for s in data["summary"]], general.institution_name
    )
    return Response(body, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}.pdf"'})
