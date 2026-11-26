"""Resource hub: shared documents, links and videos; curated collections; saves and downloads."""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, Timestamps, UUIDPk


class Resource(UUIDPk, Timestamps, Base):
    __tablename__ = "resources"
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    # career | higher_studies | scholarships | publications | archives | forms | guides | videos
    category: Mapped[str] = mapped_column(String(30), index=True)
    kind: Mapped[str] = mapped_column(String(10), default="file")  # file | link | video
    media_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("media_library.id", ondelete="SET NULL"))
    url: Mapped[str | None] = mapped_column(String(500))
    file_type: Mapped[str | None] = mapped_column(String(10))  # pdf | doc | ppt | xls | video | link …
    size: Mapped[int | None] = mapped_column(BigInteger)
    # pending (member upload, awaiting review) | published | rejected
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    rejection_reason: Mapped[str | None] = mapped_column(String(300))
    featured: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    downloads: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class ResourceCollection(UUIDPk, Timestamps, Base):
    __tablename__ = "resource_collections"
    title: Mapped[str] = mapped_column(String(150))
    subtitle: Mapped[str] = mapped_column(String(300), default="")
    icon: Mapped[str] = mapped_column(String(30), default="folder")  # briefcase | graduation | archive | video | folder
    position: Mapped[int] = mapped_column(Integer, default=0)
    published: Mapped[bool] = mapped_column(Boolean, default=True)


class ResourceCollectionItem(Base):
    __tablename__ = "resource_collection_items"
    collection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("resource_collections.id", ondelete="CASCADE"), primary_key=True)
    resource_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("resources.id", ondelete="CASCADE"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer, default=0)


class ResourceSave(Base):
    __tablename__ = "resource_saves"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    resource_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("resources.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ResourceDownload(Base):
    """One row per member and resource (repeat downloads update the time; the counter counts every download)."""

    __tablename__ = "resource_downloads"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    resource_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("resources.id", ondelete="CASCADE"), primary_key=True)
    last_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
