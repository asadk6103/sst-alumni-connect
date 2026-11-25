"""Administration: CMS pages, news, navigation menus, contact messages, custom fields, languages and translations."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, Timestamps, UUIDPk


# ── CMS ─────────────────────────────────────────────────────────────────────
class CmsPage(UUIDPk, Timestamps, Base):
    """A public page built from blocks. Edits go to `draft`; publishing copies it to `published`."""

    __tablename__ = "cms_pages"
    __table_args__ = (Index("uq_cms_pages_slug", "slug", unique=True, postgresql_where=text("deleted_at IS NULL")),)
    slug: Mapped[str] = mapped_column(String(120))
    title: Mapped[str] = mapped_column(String(200))
    # draft (never published) | scheduled | published | archived
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    # {title, seo_title, seo_description, featured_image_id, blocks: [...]}
    draft: Mapped[dict] = mapped_column(JSONB, default=dict)
    published: Mapped[dict | None] = mapped_column(JSONB)
    has_unpublished_changes: Mapped[bool] = mapped_column(Boolean, default=True)
    publish_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # visible from this moment
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class NewsPost(UUIDPk, Timestamps, Base):
    __tablename__ = "news_posts"
    __table_args__ = (
        Index("uq_news_posts_slug", "slug", unique=True, postgresql_where=text("deleted_at IS NULL")),
        Index("ix_news_posts_feed", "status", "publish_at"),
    )
    slug: Mapped[str] = mapped_column(String(160))
    title: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(20), default="news")  # news | announcement | success_story
    summary: Mapped[str] = mapped_column(String(400), default="")
    body: Mapped[str] = mapped_column(Text, default="")  # safe formatting syntax (escaped, then rendered)
    cover_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("media_library.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)  # draft | published
    publish_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    members_only: Mapped[bool] = mapped_column(Boolean, default=False)  # shown in the portal, not on the website
    seo_title: Mapped[str | None] = mapped_column(String(200))
    seo_description: Mapped[str | None] = mapped_column(String(300))
    author_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class NavMenu(Base):
    """header | footer — items: [{id, label, labels:{lang: text}, type: page|url|route, target, new_tab, audience, children}]."""

    __tablename__ = "nav_menus"
    key: Mapped[str] = mapped_column(String(30), primary_key=True)
    items: Mapped[list] = mapped_column(JSONB, default=list)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class ContactMessage(UUIDPk, Base):
    __tablename__ = "contact_messages"
    name: Mapped[str] = mapped_column(String(150))
    email: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(40))
    subject: Mapped[str] = mapped_column(String(200))
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="new", index=True)  # new | read | replied | spam
    ip: Mapped[str | None] = mapped_column(String(64))
    handled_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


# ── custom fields ───────────────────────────────────────────────────────────
class CustomField(UUIDPk, Timestamps, Base):
    """Definition only; values live in the target entity's `custom_fields` JSONB column (no schema change per field)."""

    __tablename__ = "custom_fields"
    __table_args__ = (UniqueConstraint("entity", "key"),)
    # alumni_profile | job_post | event | mentor | donation
    entity: Mapped[str] = mapped_column(String(30), index=True)
    key: Mapped[str] = mapped_column(String(60))
    label: Mapped[str] = mapped_column(String(150))
    labels: Mapped[dict] = mapped_column(JSONB, default=dict)  # translations {lang: label}
    help_text: Mapped[str] = mapped_column(String(300), default="")
    # text | textarea | number | email | phone | date | select | multiselect | checkbox | radio | file | url
    field_type: Mapped[str] = mapped_column(String(20))
    options: Mapped[list] = mapped_column(JSONB, default=list)  # [{value, label}]
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    # members | connections | private (owner and staff) | public (also on the website where shown)
    visibility: Mapped[str] = mapped_column(String(20), default="members")
    validation: Mapped[dict] = mapped_column(JSONB, default=dict)  # min, max, min_length, max_length, pattern, message
    condition: Mapped[dict | None] = mapped_column(JSONB)  # {field, operator: equals|not_equals|in|filled, value}
    on_registration: Mapped[bool] = mapped_column(Boolean, default=False)  # alumni_profile: also asked when registering
    position: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


# ── localization ────────────────────────────────────────────────────────────
class Language(Base):
    __tablename__ = "languages"
    code: Mapped[str] = mapped_column(String(10), primary_key=True)
    name: Mapped[str] = mapped_column(String(60))
    native_name: Mapped[str] = mapped_column(String(60))
    rtl: Mapped[bool] = mapped_column(Boolean, default=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    position: Mapped[int] = mapped_column(Integer, default=0)


class Translation(Base):
    """Overrides on top of the built-in catalog (app/i18n.py)."""

    __tablename__ = "translations"
    language: Mapped[str] = mapped_column(ForeignKey("languages.code", ondelete="CASCADE"), primary_key=True)
    key: Mapped[str] = mapped_column(String(150), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


# ── privacy ─────────────────────────────────────────────────────────────────
class PrivacyRequest(UUIDPk, Base):
    """A member's request to delete their account (data exports are immediate and only audit-logged)."""

    __tablename__ = "privacy_requests"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="deletion")
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)  # pending | completed | rejected | cancelled
    reason: Mapped[str | None] = mapped_column(String(1000))
    admin_note: Mapped[str | None] = mapped_column(String(1000))
    handled_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    handled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
