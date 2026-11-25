"""Page builder blocks: validated shapes, and server-side resolution for the website.

Blocks are stored as JSON on the page. When the website asks for a page, images become URLs, rich text becomes
safe HTML (everything escaped, then a small syntax applied) and dynamic blocks (events, news, gallery, featured
alumni, statistics) are filled with live data, so the website only renders.
"""

import re
import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, TypeAdapter, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...models import Achievement, Album, AlumniProfile, Batch, Event, JobPost, Mentor, NewsPost, User
from ...services.templates import simple_html
from ..events.service import image

SAFE_LINK = re.compile(r"^(/[^\s]*|https?://[^\s]+|mailto:[^\s]+|tel:[+0-9 ()\-]+|#[\w-]*)$", re.I)


def _link(v: str | None) -> str | None:
    v = (v or "").strip()
    if not v:
        return None
    if not SAFE_LINK.match(v):
        raise ValueError("Use a path like /contact, a full https:// address, mailto: or tel:")
    return v


class _Block(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12], max_length=40)
    hidden: bool = False
    heading: str = Field("", max_length=200)


class _LinkMixin(BaseModel):
    button_label: str = Field("", max_length=60)
    button_url: str | None = Field(None, max_length=500)

    @field_validator("button_url")
    @classmethod
    def _v(cls, v):
        return _link(v)


class Hero(_Block, _LinkMixin):
    type: Literal["hero"]
    subheading: str = Field("", max_length=400)
    image_id: uuid.UUID | None = None
    secondary_label: str = Field("", max_length=60)
    secondary_url: str | None = Field(None, max_length=500)
    align: Literal["left", "center"] = "left"
    overlay: int = Field(60, ge=0, le=90)

    @field_validator("secondary_url")
    @classmethod
    def _v2(cls, v):
        return _link(v)


class ImageText(_Block, _LinkMixin):
    type: Literal["image_text"]
    text: str = Field("", max_length=10000)
    image_id: uuid.UUID | None = None
    image_side: Literal["left", "right"] = "left"


class RichText(_Block):
    type: Literal["rich_text"]
    text: str = Field("", max_length=50000)


class StatItem(BaseModel):
    label: str = Field(..., min_length=1, max_length=80)
    value: str = Field("", max_length=30)  # fixed value, or empty with a live source
    source: Literal["", "alumni", "verified", "countries", "batches", "events", "mentors", "jobs"] = ""


class Stats(_Block):
    type: Literal["stats"]
    items: list[StatItem] = Field(default_factory=list, max_length=8)


class Person(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    title: str = Field("", max_length=150)
    batch: str = Field("", max_length=60)
    text: str = Field("", max_length=600)
    photo_id: uuid.UUID | None = None


class AlumniProfiles(_Block):
    type: Literal["alumni_profiles"]
    items: list[Person] = Field(default_factory=list, max_length=24)


class FeaturedAlumni(_Block):
    type: Literal["featured_alumni"]
    kind: Literal["", "distinguished", "alumni_of_month", "success_story", "award", "milestone"] = ""
    limit: int = Field(6, ge=1, le=24)


class Events(_Block):
    type: Literal["events"]
    limit: int = Field(3, ge=1, le=12)


class News(_Block):
    type: Literal["news"]
    category: Literal["", "news", "announcement", "success_story"] = ""
    limit: int = Field(3, ge=1, le=12)


class Gallery(_Block):
    type: Literal["gallery"]
    limit: int = Field(6, ge=1, le=24)


class Quote(BaseModel):
    quote: str = Field(..., min_length=1, max_length=800)
    name: str = Field(..., min_length=1, max_length=150)
    role: str = Field("", max_length=150)
    photo_id: uuid.UUID | None = None


class Testimonials(_Block):
    type: Literal["testimonials"]
    items: list[Quote] = Field(default_factory=list, max_length=12)


class Cta(_Block, _LinkMixin):
    type: Literal["cta"]
    text: str = Field("", max_length=600)
    style: Literal["primary", "navy", "light"] = "primary"


class Contact(_Block):
    type: Literal["contact"]
    text: str = Field("", max_length=600)
    show_form: bool = True


class Newsletter(_Block):
    type: Literal["newsletter"]
    text: str = Field("", max_length=400)


Block = Annotated[
    Hero
    | ImageText
    | RichText
    | Stats
    | AlumniProfiles
    | FeaturedAlumni
    | Events
    | News
    | Gallery
    | Testimonials
    | Cta
    | Contact
    | Newsletter,
    Field(discriminator="type"),
]
BlockList = TypeAdapter(list[Block])

BLOCK_TYPES = {
    "hero": "Hero banner",
    "image_text": "Image and text",
    "rich_text": "Rich text",
    "stats": "Statistics",
    "alumni_profiles": "Alumni profiles",
    "featured_alumni": "Featured alumni",
    "events": "Events",
    "news": "News",
    "gallery": "Gallery",
    "testimonials": "Testimonials",
    "cta": "Call to action",
    "contact": "Contact information",
    "newsletter": "Newsletter subscription",
}


def now() -> datetime:
    return datetime.now(UTC)


# ── live data used by blocks and the website ────────────────────────────────
async def stats(db: AsyncSession) -> dict[str, int]:
    async def load():
        live = (AlumniProfile.user_id == User.id) & User.deleted_at.is_(None)
        base = select(func.count()).select_from(AlumniProfile).join(User, live)
        return {
            "alumni": (await db.execute(base.where(AlumniProfile.kind == "alumni"))).scalar_one(),
            "verified": (await db.execute(base.where(AlumniProfile.verification_status == "verified"))).scalar_one(),
            "countries": (
                await db.execute(
                    select(func.count(func.distinct(AlumniProfile.country)))
                    .select_from(AlumniProfile)
                    .join(User, live)
                    .where(AlumniProfile.country.is_not(None))
                )
            ).scalar_one(),
            "batches": (await db.execute(select(func.count()).select_from(Batch).where(Batch.is_active.is_(True)))).scalar_one(),
            "events": (await db.execute(select(func.count()).select_from(Event).where(Event.status == "published"))).scalar_one(),
            "mentors": (await db.execute(select(func.count()).select_from(Mentor).where(Mentor.status == "approved"))).scalar_one(),
            "jobs": (await db.execute(select(func.count()).select_from(JobPost).where(JobPost.approved_at.is_not(None)))).scalar_one(),
        }

    return await settings_store.cached("public-stats", load)


def event_public(ev: Event, banner: dict | None) -> dict:
    # Never includes the online meeting link (registered attendees only, inside the portal).
    return {
        "id": str(ev.id),
        "title": ev.title,
        "kind": ev.kind,
        "summary": ev.summary,
        "starts_at": ev.starts_at,
        "ends_at": ev.ends_at,
        "venue": ev.venue,
        "address": ev.address,
        "is_online": ev.is_online,
        "banner": banner,
        "full": bool(ev.capacity and ev.registered_count >= ev.capacity),
    }


def public_events_stmt():
    return select(Event).where(Event.status == "published", Event.batch_id.is_(None), Event.ends_at >= now())


async def upcoming_events(db: AsyncSession, limit: int) -> list[dict]:
    web = await settings_store.get_group(db, "website")
    mods = await settings_store.modules(db)
    if not web.show_events or not mods.get("events", True):
        return []
    rows = (await db.execute(public_events_stmt().order_by(Event.starts_at).limit(limit))).scalars().all()
    return [event_public(e, await image(db, e.banner_id)) for e in rows]


def news_visible(members: bool = False):
    cond = (
        (NewsPost.status == "published") & NewsPost.deleted_at.is_(None) & (NewsPost.publish_at.is_(None) | (NewsPost.publish_at <= now()))
    )
    return cond if members else cond & NewsPost.members_only.is_(False)


async def news_card(db: AsyncSession, n: NewsPost) -> dict:
    return {
        "id": str(n.id),
        "slug": n.slug,
        "title": n.title,
        "category": n.category,
        "summary": n.summary,
        "cover": await image(db, n.cover_id),
        "published_at": n.publish_at or n.created_at,
        "pinned": n.pinned,
    }


async def latest_news(db: AsyncSession, limit: int, category: str = "") -> list[dict]:
    stmt = select(NewsPost).where(news_visible())
    if category:
        stmt = stmt.where(NewsPost.category == category)
    rows = (
        (
            await db.execute(
                stmt.order_by(NewsPost.pinned.desc(), func.coalesce(NewsPost.publish_at, NewsPost.created_at).desc()).limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return [await news_card(db, n) for n in rows]


async def public_albums(db: AsyncSession, limit: int) -> list[dict]:
    if not (await settings_store.modules(db)).get("gallery", True):
        return []
    from ..institutional.gallery import album_out

    rows = (
        (
            await db.execute(
                select(Album)
                .where(Album.status == "published", Album.visibility == "public")
                .order_by(Album.published_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return [await album_out(db, a) for a in rows]


async def featured_alumni(db: AsyncSession, limit: int, kind: str = "") -> list[dict]:
    if not (await settings_store.modules(db)).get("achievements", True):
        return []
    from ..achievements.router import authors, out

    stmt = (
        select(Achievement)
        .join(User, User.id == Achievement.user_id)
        .where(Achievement.status == "published", Achievement.public_consent.is_(True), User.deleted_at.is_(None))
    )
    if kind:
        stmt = stmt.where(Achievement.kind == kind)
    rows = (await db.execute(stmt.order_by(Achievement.featured.desc(), Achievement.published_at.desc()).limit(limit))).scalars().all()
    people = await authors(db, {a.user_id for a in rows})
    return [await out(db, a, people, public_view=True) for a in rows]


# ── resolution ──────────────────────────────────────────────────────────────
async def resolve(db: AsyncSession, raw_blocks: list[dict]) -> list[dict]:
    """Stored blocks → what the website renders. Invalid stored blocks are skipped, never shown broken."""
    out: list[dict] = []
    live = None
    for raw in raw_blocks or []:
        try:
            b = BlockList.validate_python([raw])[0]
        except ValueError:
            continue
        if b.hidden:
            continue
        d = b.model_dump(mode="json")
        if b.type in ("hero", "image_text"):
            d["image"] = await image(db, b.image_id)
        if b.type in ("image_text", "rich_text"):
            d["html"] = simple_html(b.text)
        if b.type == "stats":
            live = live or await stats(db)
            d["items"] = [{"label": i.label, "value": i.value or (f"{live.get(i.source, 0):,}" if i.source else "")} for i in b.items]
        if b.type == "alumni_profiles":
            d["items"] = [{**p.model_dump(mode="json"), "photo": await image(db, p.photo_id)} for p in b.items]
        if b.type == "testimonials":
            d["items"] = [{**q.model_dump(mode="json"), "photo": await image(db, q.photo_id)} for q in b.items]
        if b.type == "featured_alumni":
            d["items"] = await featured_alumni(db, b.limit, b.kind)
        if b.type == "events":
            d["items"] = await upcoming_events(db, b.limit)
        if b.type == "news":
            d["items"] = await latest_news(db, b.limit, b.category)
        if b.type == "gallery":
            d["items"] = await public_albums(db, b.limit)
        if b.type == "contact":
            general = await settings_store.get_group(db, "general")
            web = await settings_store.get_group(db, "website")
            d.update(
                {
                    "email": general.contact_email,
                    "phone": general.contact_phone,
                    "address": general.address,
                    "show_form": b.show_form and web.contact_form,
                }
            )
        out.append(d)
    return out
