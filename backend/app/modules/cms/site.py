"""Website navigation builder, website extras (settings, events) and the contact form inbox."""

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.audit import record
from ...core.db import get_db
from ...core.deps import Principal, client_ip, require
from ...core.errors import AppError, not_found
from ...core.pagination import PageParams, page_params, paginate
from ...core.redis import enforce
from ...models import CmsPage, ContactMessage, Event, NavMenu
from ...services import messaging
from ...services.templates import simple_html
from ..events.service import image
from . import blocks as B

admin = APIRouter(prefix="/api/v1/admin/website", tags=["Admin: website"])
public = APIRouter(prefix="/api/v1/public", tags=["Public"])

MENUS = ("header", "footer")
# Built-in website and app routes the menu can point at.
ROUTES = {
    "/": "site.home",
    "/news": "site.news",
    "/events": "site.events",
    "/gallery": "site.gallery",
    "/distinguished-alumni": "site.distinguished",
    "/contact": "site.contact",
    "/newsletter": "site.newsletter",
    "/login": "site.sign_in",
    "/register": "site.join",
}
DEFAULT_MENUS = {
    "header": [
        {"label": "Home", "type": "route", "target": "/"},
        {"label": "About", "type": "page", "target": "about"},
        {"label": "News", "type": "route", "target": "/news"},
        {"label": "Events", "type": "route", "target": "/events"},
        {"label": "Gallery", "type": "route", "target": "/gallery"},
        {"label": "Distinguished alumni", "type": "route", "target": "/distinguished-alumni"},
        {"label": "Contact", "type": "route", "target": "/contact"},
    ],
    "footer": [
        {"label": "About", "type": "page", "target": "about"},
        {"label": "News", "type": "route", "target": "/news"},
        {"label": "Newsletter", "type": "route", "target": "/newsletter"},
        {"label": "Contact", "type": "route", "target": "/contact"},
        {"label": "Join the network", "type": "route", "target": "/register"},
    ],
}


class MenuItem(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:10], max_length=40)
    label: str = Field(..., min_length=1, max_length=60)
    labels: dict[str, str] = Field(default_factory=dict)  # {lang: label}
    type: Literal["page", "route", "url"]
    target: str = Field(..., min_length=1, max_length=500)
    new_tab: bool = False
    visible: bool = True
    children: list["MenuItem"] = Field(default_factory=list, max_length=20)

    @field_validator("labels")
    @classmethod
    def _labels(cls, v: dict) -> dict:
        return {k[:10]: s.strip()[:60] for k, s in v.items() if isinstance(s, str) and s.strip()}

    @field_validator("children")
    @classmethod
    def _depth(cls, v: list) -> list:
        if any(c.children for c in v):
            raise ValueError("Menus can have one level of sub-items.")
        return v


async def _validate_items(db: AsyncSession, items: list[MenuItem]) -> None:
    for it in [i for top in items for i in (top, *top.children)]:
        if it.type == "route" and it.target not in ROUTES:
            raise AppError(422, "VALIDATION_ERROR", f"“{it.label}”: choose one of the website sections.")
        if it.type == "url":
            try:
                B._link(it.target)  # https://, mailto:, tel: or a path
            except ValueError as e:
                raise AppError(422, "VALIDATION_ERROR", f"“{it.label}”: {e}") from e
        if it.type == "page":
            ok = (await db.execute(select(CmsPage.id).where(CmsPage.slug == it.target, CmsPage.deleted_at.is_(None)))).first()
            if not ok:
                raise AppError(422, "VALIDATION_ERROR", f"“{it.label}”: the page no longer exists.")


async def menu_items(db: AsyncSession, key: str) -> list[dict]:
    row = await db.get(NavMenu, key)
    return row.items if row else [MenuItem(**i).model_dump() for i in DEFAULT_MENUS[key]]


@admin.get("/navigation", summary="Website menus")
async def get_menus(_: Principal = Depends(require("navigation.view")), db: AsyncSession = Depends(get_db)):
    pages = (
        await db.execute(select(CmsPage.slug, CmsPage.title, CmsPage.status).where(CmsPage.deleted_at.is_(None)).order_by(CmsPage.title))
    ).all()
    return {
        "data": {k: await menu_items(db, k) for k in MENUS},
        "meta": {"routes": ROUTES, "pages": [{"slug": s, "title": t, "status": st} for s, t, st in pages]},
    }


@admin.put("/navigation/{key}", summary="Save a menu")
async def save_menu(
    key: Literal["header", "footer"],
    body: list[MenuItem],
    me: Principal = Depends(require("navigation.edit")),
    db: AsyncSession = Depends(get_db),
):
    if len(body) > 20:
        raise AppError(422, "VALIDATION_ERROR", "A menu can have at most 20 top-level items.")
    await _validate_items(db, body)
    row = await db.get(NavMenu, key) or NavMenu(key=key)
    row.items, row.updated_by = [i.model_dump() for i in body], me.id
    db.add(row)
    await record(db, actor_id=me.id, action="update", entity="navigation", entity_id=key, summary=f"Updated the {key} menu")
    await db.commit()
    await settings_store.changed()
    return {"data": row.items}


async def _resolve(db: AsyncSession, items: list[dict], lang: str, live_pages: set[str]) -> list[dict]:
    out = []
    for raw in items:
        if not raw.get("visible", True):
            continue
        label = (raw.get("labels") or {}).get(lang) or raw["label"]
        if raw["type"] == "page":
            if raw["target"] not in live_pages:
                continue  # unpublished pages are not linked
            href = f"/{raw['target']}"
        else:
            href = raw["target"]
        out.append(
            {
                "label": label,
                "href": href,
                "new_tab": raw.get("new_tab", False),
                "i18n": ROUTES.get(href) if raw["type"] == "route" else None,
                "children": await _resolve(db, raw.get("children") or [], lang, live_pages),
            }
        )
    return out


@public.get("/website", summary="Menus, footer and contact details for the website")
async def website(response: Response, lang: str = Query("en", max_length=10), db: AsyncSession = Depends(get_db)):
    async def load():
        from .pages import _live

        live_pages = set((await db.execute(select(CmsPage.slug).where(_live()))).scalars())
        web = await settings_store.get_group(db, "website")
        general = await settings_store.get_group(db, "general")
        mods = await settings_store.modules(db)
        return {
            "header": await _resolve(db, await menu_items(db, "header"), lang, live_pages),
            "footer": await _resolve(db, await menu_items(db, "footer"), lang, live_pages),
            "footer_text": web.footer_text,
            "social": {k: getattr(web, k) for k in ("facebook", "instagram", "linkedin", "youtube", "x") if getattr(web, k)},
            "contact": {"email": general.contact_email, "phone": general.contact_phone, "address": general.address},
            "contact_form": web.contact_form,
            "show_events": web.show_events and mods.get("events", True),
            "newsletter": mods.get("newsletters", True),
            "home_page": web.home_page,
        }

    response.headers["Cache-Control"] = "public, max-age=15"
    return {"data": await settings_store.cached(f"website:{lang}", load)}


# ── public events (website) ─────────────────────────────────────────────────
@public.get("/events", summary="Upcoming events for the website")
async def public_events(response: Response, limit: int = Query(12, ge=1, le=50), db: AsyncSession = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=30"
    return {"data": await B.upcoming_events(db, limit)}


@public.get("/events/{event_id}", summary="An upcoming event (registration happens in the portal)")
async def public_event(event_id: uuid.UUID, response: Response, db: AsyncSession = Depends(get_db)):
    web = await settings_store.get_group(db, "website")
    ev = await db.get(Event, event_id)
    if (
        not ev
        or ev.status != "published"
        or ev.batch_id
        or not web.show_events
        or not (await settings_store.modules(db)).get("events", True)
    ):
        raise not_found("Event")
    response.headers["Cache-Control"] = "public, max-age=30"
    return {
        "data": {
            **B.event_public(ev, await image(db, ev.banner_id)),
            "html": simple_html(ev.description or ""),
            "past": ev.ends_at < B.now(),
        }
    }


@public.get("/stats", summary="Headline figures for the website")
async def public_stats(response: Response, db: AsyncSession = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=60"
    s = await B.stats(db)
    return {"data": {k: s[k] for k in ("alumni", "verified", "countries", "batches")}}


# ── contact form ────────────────────────────────────────────────────────────
class ContactIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=150)
    email: EmailStr
    phone: str | None = Field(None, max_length=40, pattern=r"^\+?[0-9 ()\-]{7,20}$")
    subject: str = Field(..., min_length=2, max_length=200)
    message: str = Field(..., min_length=10, max_length=5000)
    website: str | None = Field(None, max_length=200)  # honeypot: people never fill this hidden field


@public.post("/contact", status_code=201, summary="Send a message to the alumni office")
async def contact(body: ContactIn, request: Request, db: AsyncSession = Depends(get_db)):
    web = await settings_store.get_group(db, "website")
    if not web.contact_form:
        raise AppError(403, "CONTACT_CLOSED", "The contact form is not available. Please email the alumni office.")
    ip = client_ip(request)
    await enforce(f"contact:{ip}", 5, 3600, "You have sent several messages already. Please try again later.")
    if body.website:  # bot: pretend success, store nothing
        return {"data": {"ok": True}}
    m = ContactMessage(
        name=body.name.strip(),
        email=str(body.email).lower(),
        phone=body.phone,
        subject=body.subject.strip(),
        message=body.message.strip(),
        ip=ip,
    )
    db.add(m)
    general = await settings_store.get_group(db, "general")
    to = web.contact_recipient or general.contact_email
    if to:
        await messaging.queue_email(
            db,
            str(to),
            "website.contact",
            {
                "name": m.name,
                "email": m.email,
                "phone": m.phone or "—",
                "subject": m.subject,
                "message": m.message,
                "link": f"{general.app_url}/admin/website/messages",
            },
            general.default_language,
        )
    await db.commit()
    return {"data": {"ok": True}}


@admin.get("/messages", summary="Messages from the website contact form")
async def list_messages(
    status: Literal["new", "read", "replied", "spam"] | None = None,
    q: str | None = Query(None, max_length=100),
    p: PageParams = Depends(page_params),
    _: Principal = Depends(require("communications.view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ContactMessage)
    if status:
        stmt = stmt.where(ContactMessage.status == status)
    if q:
        stmt = stmt.where(
            ContactMessage.subject.ilike(f"%{q}%") | ContactMessage.email.ilike(f"%{q}%") | ContactMessage.name.ilike(f"%{q}%")
        )
    rows, meta = await paginate(db, stmt.order_by(ContactMessage.created_at.desc()), p)
    new = (await db.execute(select(func.count()).select_from(ContactMessage).where(ContactMessage.status == "new"))).scalar_one()
    return {
        "data": [
            {
                "id": str(m.id),
                "name": m.name,
                "email": m.email,
                "phone": m.phone,
                "subject": m.subject,
                "message": m.message,
                "status": m.status,
                "created_at": m.created_at,
            }
            for m in rows
        ],
        "meta": {**meta, "new": new},
    }


class MessageStatus(BaseModel):
    status: Literal["new", "read", "replied", "spam"]


@admin.patch("/messages/{message_id}", summary="Mark a message read, replied or spam")
async def mark_message(
    message_id: uuid.UUID, body: MessageStatus, me: Principal = Depends(require("communications.view")), db: AsyncSession = Depends(get_db)
):
    m = await db.get(ContactMessage, message_id)
    if not m:
        raise not_found("Message")
    m.status, m.handled_by = body.status, me.id
    await db.commit()
    return {"data": {"id": str(m.id), "status": m.status}}


@admin.delete("/messages/{message_id}", summary="Delete a message")
async def delete_message(
    message_id: uuid.UUID, me: Principal = Depends(require("communications.configure")), db: AsyncSession = Depends(get_db)
):
    m = await db.get(ContactMessage, message_id)
    if not m:
        raise not_found("Message")
    await db.delete(m)
    await record(
        db, actor_id=me.id, action="delete", entity="contact_message", entity_id=m.id, summary=f"Deleted contact message from {m.email}"
    )
    await db.commit()
    return {"data": {"ok": True}}
