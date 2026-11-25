"""Institutional support: notifications, donations and scholarships, newsletters, gallery."""

import uuid
from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, Timestamps, UUIDPk


# ── notifications ───────────────────────────────────────────────────────────
class Notification(Base):
    """In-app notification (the bell). Persisted first, pushed live after commit, emailed per preference."""

    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    category: Mapped[str] = mapped_column(String(30))  # connections | messages | community | events | jobs | mentorship | ...
    kind: Mapped[str] = mapped_column(String(60))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(String(500), default="")
    link: Mapped[str | None] = mapped_column(String(300))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (
        Index("ix_notifications_user_created", "user_id", "created_at"),
        Index("ix_notifications_user_unread", "user_id", postgresql_where=text("read_at IS NULL")),
    )


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    category: Mapped[str] = mapped_column(String(30), primary_key=True)
    in_app: Mapped[bool] = mapped_column(Boolean, default=True)
    email: Mapped[bool] = mapped_column(Boolean, default=True)
    push: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))


# ── donations and scholarships ──────────────────────────────────────────────
class Campaign(UUIDPk, Timestamps, Base):
    __tablename__ = "donation_campaigns"
    title: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(120), unique=True)
    # general | scholarship | sponsorship | infrastructure | library | sports | emergency
    category: Mapped[str] = mapped_column(String(20), index=True)
    summary: Mapped[str] = mapped_column(String(300), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    image_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("media_library.id", ondelete="SET NULL"))
    goal_amount: Mapped[float | None] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(3), default="PKR")
    starts_on: Mapped[date | None] = mapped_column(Date)
    ends_on: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)  # draft | active | closed
    scholarship_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("scholarships.id", ondelete="SET NULL"))
    raised_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)  # confirmed donations only
    donor_count: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class Donation(UUIDPk, Timestamps, Base):
    """A pledge or recorded gift. Never contains card data; online gateways (when enabled) keep only their reference."""

    __tablename__ = "donations"
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("donation_campaigns.id", ondelete="SET NULL"), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    donor_name: Mapped[str] = mapped_column(String(150))
    donor_email: Mapped[str | None] = mapped_column(String(255))
    amount: Mapped[float] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(3))
    category: Mapped[str] = mapped_column(String(20))
    # bank_transfer | cash | cheque | online (gateway) | other
    method: Mapped[str] = mapped_column(String(20))
    # pledged (awaiting payment) | completed | cancelled | refunded
    status: Mapped[str] = mapped_column(String(20), default="pledged", index=True)
    anonymous: Mapped[bool] = mapped_column(Boolean, default=False)
    recognition_consent: Mapped[bool] = mapped_column(Boolean, default=False)  # may appear on donor walls
    message: Mapped[str | None] = mapped_column(String(500))
    reference: Mapped[str] = mapped_column(String(30), unique=True)  # quoted on bank transfers
    payment_reference: Mapped[str | None] = mapped_column(String(120))  # bank / cheque / gateway reference
    receipt_no: Mapped[str | None] = mapped_column(String(30), unique=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    confirmed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    notes: Mapped[str | None] = mapped_column(String(1000))  # finance only
    custom_fields: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))


class Scholarship(UUIDPk, Timestamps, Base):
    __tablename__ = "scholarships"
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    criteria: Mapped[str] = mapped_column(Text, default="")
    amount_per_award: Mapped[float | None] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(3), default="PKR")
    awards_per_year: Mapped[int | None] = mapped_column(Integer)
    sponsor_name: Mapped[str | None] = mapped_column(String(150))  # e.g. "Class of 2005" or a family
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)  # active | closed
    image_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("media_library.id", ondelete="SET NULL"))


class ScholarshipAward(UUIDPk, Base):
    """A scholarship given to a student. Recipient details are private to finance staff."""

    __tablename__ = "scholarship_awards"
    scholarship_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("scholarships.id", ondelete="CASCADE"), index=True)
    recipient_name: Mapped[str] = mapped_column(String(150))
    recipient_class: Mapped[str | None] = mapped_column(String(60))
    academic_year: Mapped[str] = mapped_column(String(20))
    amount: Mapped[float] = mapped_column(Numeric(14, 2))
    notes: Mapped[str | None] = mapped_column(String(1000))
    awarded_on: Mapped[date] = mapped_column(Date)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ── newsletters ─────────────────────────────────────────────────────────────
class NewsletterSubscriber(UUIDPk, Base):
    __tablename__ = "newsletter_subscribers"
    email: Mapped[str] = mapped_column(String(255))
    name: Mapped[str | None] = mapped_column(String(150))
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # pending (double opt-in) | subscribed | unsubscribed
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    token: Mapped[str] = mapped_column(String(64), unique=True)  # confirm / unsubscribe links
    source: Mapped[str] = mapped_column(String(20), default="website")  # website | portal | import
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    unsubscribed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (Index("uq_newsletter_subscribers_email", text("lower(email)"), unique=True),)


class Newsletter(UUIDPk, Timestamps, Base):
    __tablename__ = "newsletters"
    subject: Mapped[str] = mapped_column(String(200))
    preheader: Mapped[str] = mapped_column(String(200), default="")
    body: Mapped[str] = mapped_column(Text)  # plain text with simple formatting; rendered safely to HTML
    # audience: all_subscribers | verified_alumni | batch
    audience: Mapped[str] = mapped_column(String(20), default="all_subscribers")
    batch_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("alumni_batches.id", ondelete="SET NULL"))
    # draft | scheduled | sending | sent | cancelled
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    recipient_count: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class NewsletterDelivery(Base):
    """One row per recipient: makes sending resumable and idempotent."""

    __tablename__ = "newsletter_deliveries"
    newsletter_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("newsletters.id", ondelete="CASCADE"), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), primary_key=True)
    log_id: Mapped[int | None] = mapped_column(BigInteger)  # notification_logs row
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ── gallery ─────────────────────────────────────────────────────────────────
class Album(UUIDPk, Timestamps, Base):
    __tablename__ = "gallery_albums"
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(String(2000), default="")
    event_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("events.id", ondelete="SET NULL"))
    cover_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("media_library.id", ondelete="SET NULL"))
    taken_on: Mapped[date | None] = mapped_column(Date)
    visibility: Mapped[str] = mapped_column(String(20), default="members")  # public | members
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)  # draft | published
    photo_count: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AlbumPhoto(Base):
    __tablename__ = "gallery_photos"
    album_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("gallery_albums.id", ondelete="CASCADE"), primary_key=True)
    media_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("media_library.id", ondelete="CASCADE"), primary_key=True)
    caption: Mapped[str] = mapped_column(String(300), default="")
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ── mobile push ─────────────────────────────────────────────────────────────
class PushDevice(UUIDPk, Base):
    """A mobile device that receives push notifications (Expo push token) for the signed-in member."""

    __tablename__ = "push_devices"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token: Mapped[str] = mapped_column(String(200), unique=True)
    platform: Mapped[str] = mapped_column(String(10))  # android | ios
    device_name: Mapped[str | None] = mapped_column(String(120))
    app_version: Mapped[str | None] = mapped_column(String(30))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
