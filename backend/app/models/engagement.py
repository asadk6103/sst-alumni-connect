"""Engagement: events, jobs and careers, mentorship, featured alumni achievements."""

import uuid
from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, Timestamps, UUIDPk


# ── events ──────────────────────────────────────────────────────────────────
class Event(UUIDPk, Timestamps, Base):
    __tablename__ = "events"
    title: Mapped[str] = mapped_column(String(200))
    # reunion | batch_reunion | networking | seminar | webinar | sports | career | other
    kind: Mapped[str] = mapped_column(String(20), index=True)
    summary: Mapped[str] = mapped_column(String(300), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    banner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("media_library.id", ondelete="SET NULL"))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    venue: Mapped[str | None] = mapped_column(String(200))
    address: Mapped[str | None] = mapped_column(String(300))
    is_online: Mapped[bool] = mapped_column(Boolean, default=False)
    online_url: Mapped[str | None] = mapped_column(String(500))  # shown to registered attendees only
    capacity: Mapped[int | None] = mapped_column(Integer)  # None = unlimited
    max_guests: Mapped[int] = mapped_column(Integer, default=0)
    registration_deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    batch_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("alumni_batches.id", ondelete="SET NULL"))  # batch-only events
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)  # draft | published | cancelled
    cancel_reason: Mapped[str | None] = mapped_column(String(300))
    reminder_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    registered_count: Mapped[int] = mapped_column(Integer, default=0)  # seats taken incl. guests
    custom_fields: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))


class EventRegistration(UUIDPk, Base):
    __tablename__ = "event_registrations"
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(20))  # registered | waitlisted | cancelled | attended
    guests: Mapped[int] = mapped_column(Integer, default=0)
    checkin_code: Mapped[str] = mapped_column(String(40), unique=True)  # encoded in the attendee's QR code
    note: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    __table_args__ = (UniqueConstraint("event_id", "user_id", name="uq_event_registrations_event_user"),)


class EventAttendance(Base):
    __tablename__ = "event_attendance"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    method: Mapped[str] = mapped_column(String(10))  # qr | manual
    checked_in_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    checked_in_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (UniqueConstraint("event_id", "user_id", name="uq_event_attendance_event_user"),)


class EventMedia(Base):
    __tablename__ = "event_media"
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), primary_key=True)
    media_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("media_library.id", ondelete="CASCADE"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EventFeedback(Base):
    __tablename__ = "event_feedback"
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    rating: Mapped[int] = mapped_column(Integer)
    comment: Mapped[str | None] = mapped_column(String(2000))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ── careers ─────────────────────────────────────────────────────────────────
class Employer(UUIDPk, Timestamps, Base):
    __tablename__ = "employers"
    name: Mapped[str] = mapped_column(String(150))
    website: Mapped[str | None] = mapped_column(String(300))
    industry: Mapped[str | None] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(String(2000), default="")
    logo_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("media_library.id", ondelete="SET NULL"))
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)  # pending | approved | rejected
    rejection_reason: Mapped[str | None] = mapped_column(String(300))


class JobCategory(UUIDPk, Base):
    __tablename__ = "job_categories"
    name: Mapped[str] = mapped_column(String(80), unique=True)
    position: Mapped[int] = mapped_column(Integer, default=0)


class JobPost(UUIDPk, Timestamps, Base):
    __tablename__ = "job_posts"
    title: Mapped[str] = mapped_column(String(150))
    organization: Mapped[str] = mapped_column(String(150))
    employer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("employers.id", ondelete="SET NULL"))
    category_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("job_categories.id", ondelete="SET NULL"))
    # full_time | part_time | internship | contract | temporary | volunteer
    employment_type: Mapped[str] = mapped_column(String(20), index=True)
    location: Mapped[str] = mapped_column(String(150))
    remote: Mapped[bool] = mapped_column(Boolean, default=False)
    salary_min: Mapped[int | None] = mapped_column(Integer)
    salary_max: Mapped[int | None] = mapped_column(Integer)
    salary_currency: Mapped[str | None] = mapped_column(String(3))
    experience: Mapped[str | None] = mapped_column(String(100))
    skills: Mapped[list] = mapped_column(JSONB, default=list)
    description: Mapped[str] = mapped_column(Text)
    deadline: Mapped[date | None] = mapped_column(Date)
    apply_url: Mapped[str | None] = mapped_column(String(500))
    apply_email: Mapped[str | None] = mapped_column(String(255))
    apply_in_portal: Mapped[bool] = mapped_column(Boolean, default=True)
    is_referral: Mapped[bool] = mapped_column(Boolean, default=False)  # an alumnus can refer applicants
    # pending (awaiting approval) | approved | rejected | closed
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    rejection_reason: Mapped[str | None] = mapped_column(String(300))
    posted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    views: Mapped[int] = mapped_column(Integer, default=0)
    custom_fields: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))


class Resume(UUIDPk, Base):
    __tablename__ = "resumes"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    media_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("media_library.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(120))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class JobApplication(UUIDPk, Timestamps, Base):
    __tablename__ = "job_applications"
    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("job_posts.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    resume_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("resumes.id", ondelete="SET NULL"))
    cover_letter: Mapped[str | None] = mapped_column(Text)
    # submitted | reviewed | shortlisted | rejected | hired | withdrawn
    status: Mapped[str] = mapped_column(String(20), default="submitted")
    poster_note: Mapped[str | None] = mapped_column(String(1000))  # private to the job poster
    __table_args__ = (UniqueConstraint("job_id", "user_id", name="uq_job_applications_job_user"),)


class SavedJob(Base):
    __tablename__ = "saved_jobs"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("job_posts.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CareerResource(UUIDPk, Timestamps, Base):
    __tablename__ = "career_resources"
    title: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(60), default="General")
    description: Mapped[str] = mapped_column(String(1000), default="")
    url: Mapped[str | None] = mapped_column(String(500))
    media_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("media_library.id", ondelete="SET NULL"))
    published: Mapped[bool] = mapped_column(Boolean, default=True)
    position: Mapped[int] = mapped_column(Integer, default=0)


# ── mentorship ──────────────────────────────────────────────────────────────
class Mentor(Timestamps, Base):
    __tablename__ = "mentors"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)  # pending | approved | rejected | paused
    industry: Mapped[str | None] = mapped_column(String(100), index=True)
    expertise: Mapped[list] = mapped_column(JSONB, default=list)
    skills: Mapped[list] = mapped_column(JSONB, default=list)
    experience_years: Mapped[int | None] = mapped_column(Integer)
    hours_per_month: Mapped[int] = mapped_column(Integer, default=2)
    formats: Mapped[list] = mapped_column(JSONB, default=list)  # video | phone | in_person | chat
    mentees_students: Mapped[bool] = mapped_column(Boolean, default=True)
    mentees_alumni: Mapped[bool] = mapped_column(Boolean, default=True)
    max_mentees: Mapped[int] = mapped_column(Integer, default=3)
    introduction: Mapped[str] = mapped_column(Text, default="")
    rejection_reason: Mapped[str | None] = mapped_column(String(300))
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    custom_fields: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))


class MentorshipRequest(UUIDPk, Timestamps, Base):
    __tablename__ = "mentorship_requests"
    mentor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    mentee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    topic: Mapped[str] = mapped_column(String(200))
    goals: Mapped[str] = mapped_column(Text, default="")
    preferred_format: Mapped[str | None] = mapped_column(String(20))
    # pending | accepted | declined | cancelled | completed
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    response_note: Mapped[str | None] = mapped_column(String(1000))
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (Index("ix_mentorship_requests_pair_open", "mentor_id", "mentee_id", "status"),)


class MentorshipSession(UUIDPk, Timestamps, Base):
    __tablename__ = "mentorship_sessions"
    request_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("mentorship_requests.id", ondelete="CASCADE"), index=True)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    duration_minutes: Mapped[int] = mapped_column(Integer, default=45)
    format: Mapped[str] = mapped_column(String(20))
    location: Mapped[str | None] = mapped_column(String(500))  # meeting link or place
    agenda: Mapped[str | None] = mapped_column(String(2000))
    status: Mapped[str] = mapped_column(String(20), default="scheduled")  # scheduled | completed | cancelled
    outcome: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class MentorshipFeedback(UUIDPk, Base):
    __tablename__ = "mentorship_feedback"
    request_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("mentorship_requests.id", ondelete="CASCADE"), index=True)
    from_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    rating: Mapped[int] = mapped_column(Integer)
    comment: Mapped[str | None] = mapped_column(String(2000))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (UniqueConstraint("request_id", "from_user_id", name="uq_mentorship_feedback_request_from"),)


# ── featured achievements (nominations → approval → public) ────────────────
class Achievement(UUIDPk, Timestamps, Base):
    __tablename__ = "achievements"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # distinguished | alumni_of_month | success_story | award | milestone
    kind: Mapped[str] = mapped_column(String(20), index=True)
    title: Mapped[str] = mapped_column(String(200))
    summary: Mapped[str] = mapped_column(String(500), default="")
    story: Mapped[str] = mapped_column(Text, default="")
    image_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("media_library.id", ondelete="SET NULL"))
    year: Mapped[int | None] = mapped_column(Integer)
    month: Mapped[int | None] = mapped_column(Integer)  # alumni of the month
    # nominated | approved (internal) | published (public) | rejected
    status: Mapped[str] = mapped_column(String(20), default="nominated", index=True)
    featured: Mapped[bool] = mapped_column(Boolean, default=False)
    # The member decides whether a published achievement may also appear on the public website (None = not asked yet).
    public_consent: Mapped[bool | None] = mapped_column(Boolean)
    nominated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    nomination_reason: Mapped[str | None] = mapped_column(String(2000))
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    rejection_reason: Mapped[str | None] = mapped_column(String(300))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
