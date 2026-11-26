"""Member settings (privacy, connections, preferences, locale, consents), trusted devices, support tickets and FAQs."""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, Sequence, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UUIDPk

TICKET_SEQ = Sequence("support_ticket_number_seq", start=10001)


class MemberSettings(Base):
    """One row per member; missing keys fall back to services.member_settings.DEFAULTS."""

    __tablename__ = "member_settings"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    data: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class TrustedDevice(UUIDPk, Base):
    """'Remember this device': skips the two-factor step on this browser until it expires."""

    __tablename__ = "trusted_devices"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True)
    user_agent: Mapped[str | None] = mapped_column(String(300))
    ip: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class SupportTicket(UUIDPk, Base):
    __tablename__ = "support_tickets"
    number: Mapped[int] = mapped_column(BigInteger, TICKET_SEQ, server_default=TICKET_SEQ.next_value(), unique=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # account | profile | verification | events | jobs | mentorship | donations | technical | other
    category: Mapped[str] = mapped_column(String(30))
    priority: Mapped[str] = mapped_column(String(10), default="medium")  # low | medium | high | urgent
    subject: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    attachments: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))  # media ids
    status: Mapped[str] = mapped_column(String(20), default="open", index=True)  # open | in_progress | resolved | closed
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), index=True)


class SupportReply(UUIDPk, Base):
    __tablename__ = "support_replies"
    ticket_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("support_tickets.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    staff: Mapped[bool] = mapped_column(Boolean, default=False)
    body: Mapped[str] = mapped_column(Text)
    attachments: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Faq(UUIDPk, Base):
    __tablename__ = "faqs"
    question: Mapped[str] = mapped_column(String(300))
    answer: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(60), default="General")
    position: Mapped[int] = mapped_column(Integer, default=0)
    published: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
