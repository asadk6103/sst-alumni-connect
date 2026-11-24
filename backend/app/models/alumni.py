"""Alumni core: profiles and their sections, batches, institutional records, verification, connections."""

import uuid
from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Index, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, Timestamps, UUIDPk


class Batch(UUIDPk, Timestamps, Base):
    """A graduating class (one or more per graduation year, e.g. by section)."""

    __tablename__ = "alumni_batches"
    name: Mapped[str] = mapped_column(String(100), unique=True)
    graduation_year: Mapped[int] = mapped_column(Integer, index=True)
    admission_year: Mapped[int | None] = mapped_column(Integer)
    description: Mapped[str] = mapped_column(String(500), default="")
    coordinator_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class StudentRecord(UUIDPk, Timestamps, Base):
    """Institutional student record (imported from school records) used to verify registrations."""

    __tablename__ = "student_records"
    registration_no: Mapped[str] = mapped_column(String(40))
    # Upper-case letters and digits only — the comparison key.
    reg_norm: Mapped[str] = mapped_column(String(40), unique=True)
    full_name: Mapped[str] = mapped_column(String(150))
    father_name: Mapped[str | None] = mapped_column(String(150))
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    gender: Mapped[str | None] = mapped_column(String(20))
    admission_year: Mapped[int | None] = mapped_column(Integer)
    graduation_year: Mapped[int | None] = mapped_column(Integer, index=True)
    class_name: Mapped[str | None] = mapped_column(String(60))
    email: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(32))
    batch_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("alumni_batches.id", ondelete="SET NULL"))
    source: Mapped[str] = mapped_column(String(150), default="")
    imported_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    matched_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    invited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AlumniProfile(Timestamps, Base):
    __tablename__ = "alumni_profiles"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), default="alumni")  # alumni | student
    gender: Mapped[str | None] = mapped_column(String(20))
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    admission_year: Mapped[int | None] = mapped_column(Integer)
    graduation_year: Mapped[int | None] = mapped_column(Integer, index=True)
    batch_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("alumni_batches.id", ondelete="SET NULL"), index=True)
    class_name: Mapped[str | None] = mapped_column(String(60))
    registration_no: Mapped[str | None] = mapped_column(String(40))
    reg_norm: Mapped[str | None] = mapped_column(String(40), index=True)
    city: Mapped[str | None] = mapped_column(String(100))
    country: Mapped[str | None] = mapped_column(String(100), index=True)
    designation: Mapped[str | None] = mapped_column(String(150))
    organization: Mapped[str | None] = mapped_column(String(150))
    industry: Mapped[str | None] = mapped_column(String(100), index=True)
    bio: Mapped[str | None] = mapped_column(Text)
    photo_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("media_library.id", ondelete="SET NULL"))
    website: Mapped[str | None] = mapped_column(String(300))
    linkedin: Mapped[str | None] = mapped_column(String(300))
    # Profile visibility (members | connections | hidden) and per-section visibility (members | connections | only_me).
    visibility: Mapped[str] = mapped_column(String(20), default="members")
    privacy: Mapped[dict] = mapped_column(JSONB, default=dict)
    # Verification: pending | verified | rejected. Nobody is verified without an explicit method.
    verification_status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    verification_method: Mapped[str | None] = mapped_column(String(30))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    verification_note: Mapped[str | None] = mapped_column(String(500))  # from the applicant
    rejection_reason: Mapped[str | None] = mapped_column(String(500))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    evidence_ids: Mapped[list] = mapped_column(JSONB, default=list)  # private media ids
    matched_record_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("student_records.id", ondelete="SET NULL"))
    match_strength: Mapped[str | None] = mapped_column(String(20))  # strong | partial
    completion: Mapped[int] = mapped_column(Integer, default=0)
    # Directory search document: only fields visible to all members are indexed.
    search: Mapped[str | None] = mapped_column(TSVECTOR)

    __table_args__ = (Index("ix_alumni_profiles_search", "search", postgresql_using="gin"),)


class AlumniEducation(UUIDPk, Timestamps, Base):
    __tablename__ = "alumni_education"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    institution: Mapped[str] = mapped_column(String(200))
    qualification: Mapped[str] = mapped_column(String(150))
    field_of_study: Mapped[str | None] = mapped_column(String(150))
    start_year: Mapped[int | None] = mapped_column(Integer)
    end_year: Mapped[int | None] = mapped_column(Integer)
    is_sst: Mapped[bool] = mapped_column(Boolean, default=False)
    description: Mapped[str | None] = mapped_column(String(1000))


class AlumniEmployment(UUIDPk, Timestamps, Base):
    __tablename__ = "alumni_employment"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    organization: Mapped[str] = mapped_column(String(150))
    designation: Mapped[str] = mapped_column(String(150))
    industry: Mapped[str | None] = mapped_column(String(100))
    location: Mapped[str | None] = mapped_column(String(150))
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)
    description: Mapped[str | None] = mapped_column(String(2000))


class AlumniAchievement(UUIDPk, Timestamps, Base):
    __tablename__ = "alumni_achievements"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # award | recognition | publication | milestone | certification
    title: Mapped[str] = mapped_column(String(200))
    issuer: Mapped[str | None] = mapped_column(String(150))
    year: Mapped[int | None] = mapped_column(Integer)
    url: Mapped[str | None] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(String(1000))


class AlumniSkill(Base):
    __tablename__ = "alumni_skills"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    name: Mapped[str] = mapped_column(String(60), primary_key=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    __table_args__ = (Index("ix_alumni_skills_name_lower", text("lower(name)")),)


class AlumniConnection(UUIDPk, Base):
    __tablename__ = "alumni_connections"
    requester_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    addressee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(15), default="pending")  # pending | accepted | declined
    message: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # One relationship per pair, whichever side asked.
    __table_args__ = (Index("uq_alumni_connections_pair", text("least(requester_id, addressee_id)"),
                            text("greatest(requester_id, addressee_id)"), unique=True),)


class AlumniFollow(Base):
    __tablename__ = "alumni_follows"
    follower_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    followee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ProfileReport(UUIDPk, Base):
    __tablename__ = "profile_reports"
    reporter_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    reason: Mapped[str] = mapped_column(String(30))
    details: Mapped[str | None] = mapped_column(String(1000))
    status: Mapped[str] = mapped_column(String(15), default="open", index=True)  # open | resolved | dismissed
    resolution_note: Mapped[str | None] = mapped_column(String(500))
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class VerificationCode(UUIDPk, Base):
    """One-time (or limited-use) codes issued by the alumni office through an institutional process."""

    __tablename__ = "verification_codes"
    code_hash: Mapped[str] = mapped_column(String(128), unique=True)
    hint: Mapped[str] = mapped_column(String(8))  # last characters, to recognise a code in the list
    label: Mapped[str] = mapped_column(String(150))
    batch_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("alumni_batches.id", ondelete="SET NULL"))
    max_uses: Mapped[int] = mapped_column(Integer, default=1)
    uses: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class VerificationEvent(Base):
    """History of a member's verification (submissions, matches, decisions)."""

    __tablename__ = "alumni_verification_events"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    action: Mapped[str] = mapped_column(String(30))  # submitted | resubmitted | matched | approved | rejected | revoked
    method: Mapped[str | None] = mapped_column(String(30))
    note: Mapped[str | None] = mapped_column(String(500))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
