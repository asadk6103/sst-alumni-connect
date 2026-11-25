"""Donations (campaigns, pledges, confirmation, receipts, donor recognition) and scholarships.

No payment gateway is active until one is configured and verified: donors pledge and pay by bank transfer, cash or
cheque using a reference; the finance team confirms receipt and the receipt is issued. Card details are never handled.
"""

import html
import re
import secrets
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.audit import record
from ...core.db import get_db
from ...core.deps import Principal, client_ip, require, require_module
from ...core.errors import AppError, conflict, not_found
from ...core.pagination import PageParams, csv_response, page_params
from ...core.redis import enforce
from ...core.settings_schemas import DonationSettings
from ...models import Campaign, Donation, Media, Scholarship, ScholarshipAward, User
from ...services import custom_fields, notifications
from ...services.templates import simple_html
from ..events.service import image

router = APIRouter(prefix="/api/v1/donations", tags=["Donations"], dependencies=[Depends(require_module("donations"))])
admin = APIRouter(prefix="/api/v1/admin/donations", tags=["Admin: donations"])
public = APIRouter(prefix="/api/v1/public/campaigns", tags=["Public"])
scholarships_router = APIRouter(
    prefix="/api/v1/scholarships", tags=["Scholarships"], dependencies=[Depends(require_module("scholarships"))]
)
scholarships_admin = APIRouter(prefix="/api/v1/admin/scholarships", tags=["Admin: scholarships"])

CATEGORIES = {
    "general": "General donation",
    "scholarship": "Scholarship fund",
    "sponsorship": "Student sponsorship",
    "infrastructure": "Infrastructure development",
    "library": "Library development",
    "sports": "Sports development",
    "emergency": "Emergency assistance",
}
CATS = Literal["general", "scholarship", "sponsorship", "infrastructure", "library", "sports", "emergency"]
METHODS = Literal["bank_transfer", "cash", "cheque", "online", "other"]


def _meta(p: PageParams, total: int) -> dict:
    return {"page": p.page, "page_size": p.page_size, "total": total, "pages": max(1, -(-total // p.page_size))}


def money(v) -> float:
    return float(v or 0)


async def dsettings(db: AsyncSession) -> DonationSettings:
    return await settings_store.get_group(db, "donations")  # type: ignore[return-value]


def _slug(title: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:80] or "campaign"
    return f"{s}-{secrets.token_hex(2)}"


async def campaign_out(db: AsyncSession, c: Campaign, detail: bool = False) -> dict:
    goal = money(c.goal_amount)
    out = {
        "id": str(c.id),
        "slug": c.slug,
        "title": c.title,
        "category": c.category,
        "category_label": CATEGORIES.get(c.category, c.category),
        "summary": c.summary,
        "image": await image(db, c.image_id),
        "goal_amount": goal or None,
        "currency": c.currency,
        "raised_amount": money(c.raised_amount),
        "donor_count": c.donor_count,
        "progress": min(100, round(money(c.raised_amount) / goal * 100)) if goal else None,
        "starts_on": c.starts_on,
        "ends_on": c.ends_on,
        "status": c.status,
        "scholarship_id": str(c.scholarship_id) if c.scholarship_id else None,
    }
    if detail:
        out["description"] = c.description
        out["description_html"] = simple_html(c.description) if c.description else ""
        cfg = await dsettings(db)
        if cfg.show_donor_wall:
            rows = (
                (
                    await db.execute(
                        select(Donation)
                        .where(Donation.campaign_id == c.id, Donation.status == "completed", Donation.recognition_consent.is_(True))
                        .order_by(Donation.confirmed_at.desc())
                        .limit(30)
                    )
                )
                .scalars()
                .all()
            )
            out["donors"] = [
                {"name": "Anonymous" if d.anonymous else d.donor_name, "message": d.message, "at": d.confirmed_at} for d in rows
            ]
    return out


def donation_out(d: Donation, campaign: Campaign | None = None, staff: bool = False) -> dict:
    out = {
        "id": str(d.id),
        "reference": d.reference,
        "receipt_no": d.receipt_no,
        "amount": money(d.amount),
        "currency": d.currency,
        "category": d.category,
        "category_label": CATEGORIES.get(d.category, d.category),
        "method": d.method,
        "status": d.status,
        "anonymous": d.anonymous,
        "recognition_consent": d.recognition_consent,
        "message": d.message,
        "created_at": d.created_at,
        "confirmed_at": d.confirmed_at,
        "campaign": {"id": str(campaign.id), "title": campaign.title, "slug": campaign.slug} if campaign else None,
        "custom_fields": d.custom_fields or {},  # only ever returned to the donor and finance staff
    }
    if staff:
        out.update(
            {
                "donor_name": d.donor_name,
                "donor_email": d.donor_email,
                "user_id": str(d.user_id) if d.user_id else None,
                "payment_reference": d.payment_reference,
                "notes": d.notes,
            }
        )
    return out


def payment_info(cfg: DonationSettings) -> dict:
    return {
        "bank": {
            "bank_name": cfg.bank_name,
            "account_title": cfg.account_title,
            "account_number": cfg.account_number,
            "iban": cfg.iban,
            "branch": cfg.branch,
        }
        if (cfg.iban or cfg.account_number)
        else None,
        "other_methods": cfg.other_methods,
        "instructions": cfg.instructions,
        "min_amount": cfg.min_amount,
        "online_available": False,
    }  # payment gateways stay disabled until configured and verified


# ── members ─────────────────────────────────────────────────────────────────
@router.get("/campaigns", summary="Active fundraising campaigns")
async def campaigns(category: CATS | None = None, me: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    stmt = select(Campaign).where(Campaign.status == "active")
    if category:
        stmt = stmt.where(Campaign.category == category)
    rows = (await db.execute(stmt.order_by(Campaign.ends_on.asc().nulls_last(), Campaign.created_at.desc()))).scalars().all()
    return {"data": [await campaign_out(db, c) for c in rows], "meta": {"categories": CATEGORIES}}


@router.get("/campaigns/{campaign_id}", summary="A campaign with progress and donor recognition")
async def campaign(campaign_id: uuid.UUID, me: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    c = await db.get(Campaign, campaign_id)
    if not c or (c.status == "draft" and not me.can("donations.view")):
        raise not_found("Campaign")
    return {"data": await campaign_out(db, c, detail=True)}


@router.get("/payment-info", summary="How to pay (bank transfer and other methods)")
async def get_payment_info(me: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    return {"data": payment_info(await dsettings(db))}


class PledgeIn(BaseModel):
    campaign_id: uuid.UUID | None = None
    category: CATS = "general"
    amount: Decimal = Field(..., gt=0, max_digits=14, decimal_places=2)
    method: Literal["bank_transfer", "cash", "cheque"] = "bank_transfer"
    anonymous: bool = False
    recognition_consent: bool = False
    message: str | None = Field(None, max_length=500)
    custom_fields: dict = Field(default_factory=dict)


def _reference() -> str:
    return f"DN-{datetime.now(UTC):%y%m}-{secrets.token_hex(3).upper()}"


@router.post("/pledges", status_code=201, summary="Pledge a donation (you then pay by bank transfer, cash or cheque)")
async def pledge(body: PledgeIn, me: Principal = Depends(require("portal.donate")), db: AsyncSession = Depends(get_db)):
    await enforce(f"pledge:{me.id}", 20, 86400, "You have made many pledges today.")
    cfg = await dsettings(db)
    if body.amount < cfg.min_amount:
        raise AppError(
            422, "VALIDATION_ERROR", f"The minimum donation is {cfg.min_amount}.", [{"field": "amount", "message": "Too small."}]
        )
    c = None
    general = await settings_store.get_group(db, "general")
    currency, category = general.currency, body.category
    if body.campaign_id:
        c = await db.get(Campaign, body.campaign_id)
        if not c or c.status != "active":
            raise conflict("CAMPAIGN_CLOSED", "This campaign is not accepting donations.")
        currency, category = c.currency, c.category
    extra = await custom_fields.clean(db, "donation", body.custom_fields, actor=me.id)
    u = await db.get(User, me.id)
    d = Donation(
        custom_fields=extra,
        campaign_id=c.id if c else None,
        user_id=me.id,
        donor_name=u.full_name,
        donor_email=u.email,
        amount=body.amount,
        currency=currency,
        category=category,
        method=body.method,
        status="pledged",
        anonymous=body.anonymous,
        recognition_consent=body.recognition_consent,
        message=body.message,
        reference=_reference(),
    )
    db.add(d)
    await db.flush()
    info = payment_info(cfg)
    bank = info["bank"]
    bank_text = (
        f"{bank['bank_name']} — {bank['account_title']} — IBAN {bank['iban'] or bank['account_number']}" if bank else cfg.other_methods
    )
    await notifications.notify(
        db,
        me.id,
        "donations",
        "pledged",
        f"Thank you for your pledge ({d.reference})",
        body=f"{currency} {money(d.amount):,.0f}",
        link="/portal/donations/history",
        email=(
            "donations.pledged",
            {
                "amount": f"{currency} {money(d.amount):,.2f}",
                "reference": d.reference,
                "campaign": c.title if c else CATEGORIES[category],
                "bank": bank_text,
                "instructions": cfg.instructions,
                "link": f"{general.app_url}/portal/donations/history",
            },
        ),
    )
    return {"data": {**donation_out(d, c), "payment_info": info}}


@router.get("/mine", summary="Your donation history")
async def mine(me: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    rows = (
        await db.execute(
            select(Donation, Campaign)
            .outerjoin(Campaign, Campaign.id == Donation.campaign_id)
            .where(Donation.user_id == me.id)
            .order_by(Donation.created_at.desc())
        )
    ).all()
    total = sum(money(d.amount) for d, _ in rows if d.status == "completed")
    return {"data": [donation_out(d, c) for d, c in rows], "meta": {"total_given": total}}


@router.post("/{donation_id}/cancel", summary="Cancel a pledge you have not paid yet")
async def cancel_pledge(donation_id: uuid.UUID, me: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    d = await db.get(Donation, donation_id)
    if not d or d.user_id != me.id:
        raise not_found("Donation")
    if d.status != "pledged":
        raise conflict("NOT_PLEDGED", "Only unpaid pledges can be cancelled.")
    d.status = "cancelled"
    return {"data": donation_out(d)}


async def _receipt_html(db: AsyncSession, d: Donation) -> str:
    general = await settings_store.get_group(db, "general")
    cfg = await dsettings(db)
    c = await db.get(Campaign, d.campaign_id) if d.campaign_id else None
    e = html.escape
    rows = [
        ("Receipt number", d.receipt_no),
        ("Date received", d.confirmed_at.strftime("%d %B %Y") if d.confirmed_at else ""),
        ("Received from", d.donor_name),
        ("Amount", f"{d.currency} {money(d.amount):,.2f}"),
        ("Purpose", c.title if c else CATEGORIES.get(d.category, d.category)),
        ("Payment method", d.method.replace("_", " ").title()),
        ("Payment reference", d.payment_reference or d.reference),
    ]
    table = "".join(f"<tr><th>{e(k)}</th><td>{e(str(v or ''))}</td></tr>" for k, v in rows)
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Receipt {e(d.receipt_no or '')}</title>
<style>body{{font-family:Inter,Segoe UI,Arial,sans-serif;color:#20283A;max-width:720px;margin:40px auto;padding:0 24px}}
h1{{font-size:22px;margin:0}}.muted{{color:#718096}}table{{width:100%;border-collapse:collapse;margin:24px 0}}
th,td{{text-align:left;padding:10px 8px;border-bottom:1px solid #E6E8F0}}th{{width:40%;color:#718096;font-weight:500}}
.head{{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #102344;padding-bottom:12px}}
@media print{{button{{display:none}}}}</style></head><body>
<div class="head"><div><h1>{e(general.institution_name)}</h1>
<div class="muted">{e(general.app_name)} · {e(general.address or '')}</div></div>
<div><strong>Donation receipt</strong></div></div>
<p>Thank you for your generous support.</p><table>{table}</table>
<p class="muted">{e(cfg.receipt_footer)}</p><p class="muted">{e(general.contact_email or '')} {e(general.contact_phone or '')}</p>
<button onclick="window.print()">Print</button></body></html>"""


@router.get("/{donation_id}/receipt", summary="Printable receipt for a confirmed donation", response_class=HTMLResponse)
async def receipt(donation_id: uuid.UUID, me: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    d = await db.get(Donation, donation_id)
    if not d or (d.user_id != me.id and not me.can("donations.view")) or d.status != "completed":
        raise not_found("Receipt")
    return HTMLResponse(
        await _receipt_html(db, d),
        headers={
            "Cache-Control": "private, no-store",
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
        },
    )


@public.get("", summary="Active campaigns for the public website")
async def public_campaigns(db: AsyncSession = Depends(get_db)):
    mods = await settings_store.modules(db)
    if not mods.get("donations", True):
        return {"data": []}
    rows = (
        (await db.execute(select(Campaign).where(Campaign.status == "active").order_by(Campaign.created_at.desc()).limit(12)))
        .scalars()
        .all()
    )
    return {"data": [await campaign_out(db, c) for c in rows]}


# ── finance ─────────────────────────────────────────────────────────────────
class CampaignIn(BaseModel):
    title: str = Field(..., min_length=3, max_length=200)
    category: CATS
    summary: str = Field("", max_length=300)
    description: str = Field("", max_length=20000)
    image_id: uuid.UUID | None = None
    goal_amount: Decimal | None = Field(None, gt=0, max_digits=14, decimal_places=2)
    currency: str = Field("PKR", pattern=r"^[A-Z]{3}$")
    starts_on: date | None = None
    ends_on: date | None = None
    scholarship_id: uuid.UUID | None = None

    @field_validator("ends_on")
    @classmethod
    def _end(cls, v, info):
        start = info.data.get("starts_on")
        if v and start and v < start:
            raise ValueError("The campaign must end after it starts.")
        return v


@admin.get("/campaigns", summary="All campaigns")
async def admin_campaigns(
    status: Literal["draft", "active", "closed"] | None = None,
    me: Principal = Depends(require("donations.view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Campaign)
    if status:
        stmt = stmt.where(Campaign.status == status)
    rows = (await db.execute(stmt.order_by(Campaign.created_at.desc()))).scalars().all()
    pledged = dict(
        (
            await db.execute(
                select(Donation.campaign_id, func.sum(Donation.amount)).where(Donation.status == "pledged").group_by(Donation.campaign_id)
            )
        ).all()
    )
    return {"data": [{**await campaign_out(db, c, detail=True), "pledged_amount": money(pledged.get(c.id))} for c in rows]}


async def _check_campaign(db: AsyncSession, body: CampaignIn) -> None:
    if body.image_id:
        m = await db.get(Media, body.image_id)
        if not m or m.private or not m.mime.startswith("image/"):
            raise AppError(422, "VALIDATION_ERROR", "Choose an image.", [{"field": "image_id", "message": "Not an image."}])
    if body.scholarship_id and not await db.get(Scholarship, body.scholarship_id):
        raise AppError(422, "VALIDATION_ERROR", "Unknown scholarship.", [{"field": "scholarship_id", "message": "Unknown."}])


@admin.post("/campaigns", status_code=201, summary="Create a campaign (draft)")
async def create_campaign(
    body: CampaignIn, request: Request, me: Principal = Depends(require("donations.create")), db: AsyncSession = Depends(get_db)
):
    await _check_campaign(db, body)
    c = Campaign(**body.model_dump(), slug=_slug(body.title), status="draft", raised_amount=0, donor_count=0, created_by=me.id)
    db.add(c)
    await db.flush()
    await record(
        db, actor_id=me.id, action="create", entity="campaign", entity_id=c.id, summary=f"Created campaign {c.title}", ip=client_ip(request)
    )
    return {"data": await campaign_out(db, c, detail=True)}


@admin.put("/campaigns/{campaign_id}", summary="Edit a campaign")
async def edit_campaign(
    campaign_id: uuid.UUID, body: CampaignIn, me: Principal = Depends(require("donations.edit")), db: AsyncSession = Depends(get_db)
):
    c = await db.get(Campaign, campaign_id)
    if not c:
        raise not_found("Campaign")
    await _check_campaign(db, body)
    for k, v in body.model_dump().items():
        setattr(c, k, v)
    return {"data": await campaign_out(db, c, detail=True)}


class StatusIn(BaseModel):
    status: Literal["draft", "active", "closed"]


@admin.post("/campaigns/{campaign_id}/status", summary="Open, close or unpublish a campaign")
async def campaign_status(
    campaign_id: uuid.UUID,
    body: StatusIn,
    request: Request,
    me: Principal = Depends(require("donations.edit")),
    db: AsyncSession = Depends(get_db),
):
    c = await db.get(Campaign, campaign_id)
    if not c:
        raise not_found("Campaign")
    c.status = body.status
    await record(
        db,
        actor_id=me.id,
        action=body.status,
        entity="campaign",
        entity_id=c.id,
        summary=f"Campaign {c.title}: {body.status}",
        ip=client_ip(request),
    )
    return {"data": await campaign_out(db, c)}


def _donations_stmt(status: str | None, campaign: uuid.UUID | None, q: str | None, method: str | None):
    stmt = select(Donation, Campaign).outerjoin(Campaign, Campaign.id == Donation.campaign_id)
    if status:
        stmt = stmt.where(Donation.status == status)
    if campaign:
        stmt = stmt.where(Donation.campaign_id == campaign)
    if method:
        stmt = stmt.where(Donation.method == method)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Donation.donor_name).like(like),
                func.lower(Donation.donor_email).like(like),
                func.lower(Donation.reference).like(like),
                func.lower(Donation.receipt_no).like(like),
                func.lower(Donation.payment_reference).like(like),
            )
        )
    return stmt


@admin.get("", summary="Donations and pledges")
async def admin_donations(
    status: Literal["pledged", "completed", "cancelled", "refunded"] | None = None,
    campaign: uuid.UUID | None = None,
    method: str | None = Query(None, max_length=20),
    q: str | None = Query(None, max_length=100),
    p: PageParams = Depends(page_params),
    me: Principal = Depends(require("donations.view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = _donations_stmt(status, campaign, q, method)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(stmt.order_by(Donation.created_at.desc()).offset((p.page - 1) * p.page_size).limit(p.page_size))).all()
    return {"data": [donation_out(d, c, staff=True) for d, c in rows], "meta": _meta(p, total)}


@admin.get("/stats", summary="Donation statistics")
async def stats(me: Principal = Depends(require("donations.view")), db: AsyncSession = Depends(get_db)):
    done = Donation.status == "completed"
    total = (await db.execute(select(func.coalesce(func.sum(Donation.amount), 0)).where(done))).scalar_one()
    count = (await db.execute(select(func.count()).select_from(Donation).where(done))).scalar_one()
    donors = (await db.execute(select(func.count(func.distinct(func.lower(Donation.donor_email)))).where(done))).scalar_one()
    pledged = (
        await db.execute(select(func.coalesce(func.sum(Donation.amount), 0), func.count()).where(Donation.status == "pledged"))
    ).one()
    by_cat = (await db.execute(select(Donation.category, func.sum(Donation.amount)).where(done).group_by(Donation.category))).all()
    by_month = (
        await db.execute(
            select(func.date_trunc("month", Donation.confirmed_at).label("m"), func.sum(Donation.amount))
            .where(done)
            .group_by("m")
            .order_by("m")
            .limit(24)
        )
    ).all()
    return {
        "data": {
            "total": money(total),
            "count": count,
            "donors": donors,
            "pledged_amount": money(pledged[0]),
            "pledged_count": pledged[1],
            "by_category": [{"category": c, "label": CATEGORIES.get(c, c), "amount": money(a)} for c, a in by_cat],
            "by_month": [{"month": m.strftime("%Y-%m"), "amount": money(a)} for m, a in by_month if m],
        }
    }


@admin.get("/export", summary="Export donations (CSV)")
async def export(
    request: Request, status: str | None = None, me: Principal = Depends(require("donations.export")), db: AsyncSession = Depends(get_db)
):
    rows = (await db.execute(_donations_stmt(status, None, None, None).order_by(Donation.created_at.desc()))).all()
    await record(db, actor_id=me.id, action="export", entity="donation", summary=f"Exported {len(rows)} donations", ip=client_ip(request))
    await db.commit()
    return csv_response(
        "donations.csv",
        [
            "Reference",
            "Receipt",
            "Donor",
            "Email",
            "Anonymous",
            "Amount",
            "Currency",
            "Purpose",
            "Method",
            "Status",
            "Payment reference",
            "Pledged",
            "Confirmed",
        ],
        (
            [
                d.reference,
                d.receipt_no or "",
                d.donor_name,
                d.donor_email or "",
                "yes" if d.anonymous else "",
                money(d.amount),
                d.currency,
                c.title if c else CATEGORIES.get(d.category, d.category),
                d.method,
                d.status,
                d.payment_reference or "",
                d.created_at.isoformat(),
                d.confirmed_at.isoformat() if d.confirmed_at else "",
            ]
            for d, c in rows
        ),
    )


async def _complete(db: AsyncSession, d: Donation, me: Principal, payment_reference: str | None) -> None:
    d.status, d.confirmed_at, d.confirmed_by = "completed", datetime.now(UTC), me.id
    d.payment_reference = payment_reference or d.payment_reference
    d.receipt_no = f"RC-{datetime.now(UTC):%Y}-{secrets.token_hex(3).upper()}"
    if d.campaign_id:
        c = await db.get(Campaign, d.campaign_id, with_for_update=True)
        first = not (
            await db.execute(
                select(Donation.id).where(
                    Donation.campaign_id == c.id,
                    Donation.status == "completed",
                    Donation.id != d.id,
                    func.lower(Donation.donor_email) == (d.donor_email or "").lower(),
                )
            )
        ).first()
        c.raised_amount = money(c.raised_amount) + money(d.amount)
        if first:
            c.donor_count += 1
    if d.user_id:
        general = await settings_store.get_group(db, "general")
        await notifications.notify(
            db,
            d.user_id,
            "donations",
            "confirmed",
            f"Donation received — receipt {d.receipt_no}",
            body=f"{d.currency} {money(d.amount):,.0f}",
            link="/portal/donations/history",
            email=(
                "donations.receipt",
                {
                    "amount": f"{d.currency} {money(d.amount):,.2f}",
                    "receipt": d.receipt_no,
                    "link": f"{general.app_url}/portal/donations/history",
                },
            ),
        )


class ConfirmIn(BaseModel):
    payment_reference: str | None = Field(None, max_length=120)
    notes: str | None = Field(None, max_length=1000)


@admin.post("/{donation_id}/confirm", summary="Confirm that a pledge was received (issues the receipt)")
async def confirm(
    donation_id: uuid.UUID,
    body: ConfirmIn,
    request: Request,
    me: Principal = Depends(require("donations.edit")),
    db: AsyncSession = Depends(get_db),
):
    d = await db.get(Donation, donation_id, with_for_update=True)
    if not d:
        raise not_found("Donation")
    if d.status != "pledged":
        raise conflict("NOT_PLEDGED", "Only pledges waiting for payment can be confirmed.")
    if body.notes:
        d.notes = body.notes
    await _complete(db, d, me, body.payment_reference)
    await record(
        db,
        actor_id=me.id,
        action="confirm",
        entity="donation",
        entity_id=d.id,
        summary=f"Confirmed donation {d.reference} ({d.currency} {money(d.amount):,.2f})",
        ip=client_ip(request),
    )
    return {"data": donation_out(d, staff=True)}


class OfflineIn(BaseModel):
    donor_name: str = Field(..., min_length=2, max_length=150)
    donor_email: EmailStr | None = None
    user_id: uuid.UUID | None = None
    campaign_id: uuid.UUID | None = None
    category: CATS = "general"
    amount: Decimal = Field(..., gt=0, max_digits=14, decimal_places=2)
    currency: str | None = Field(None, pattern=r"^[A-Z]{3}$")
    method: METHODS = "cash"
    payment_reference: str | None = Field(None, max_length=120)
    anonymous: bool = False
    recognition_consent: bool = False
    notes: str | None = Field(None, max_length=1000)


@admin.post("", status_code=201, summary="Record a donation received offline (issues the receipt)")
async def record_offline(
    body: OfflineIn, request: Request, me: Principal = Depends(require("donations.create")), db: AsyncSession = Depends(get_db)
):
    c = None
    general = await settings_store.get_group(db, "general")
    currency, category = body.currency or general.currency, body.category
    if body.campaign_id:
        c = await db.get(Campaign, body.campaign_id)
        if not c:
            raise not_found("Campaign")
        currency, category = c.currency, c.category
    email = str(body.donor_email).lower() if body.donor_email else None
    if body.user_id:
        u = await db.get(User, body.user_id)
        email = email or (u.email if u else None)
    d = Donation(
        campaign_id=c.id if c else None,
        user_id=body.user_id,
        donor_name=body.donor_name.strip(),
        donor_email=email,
        amount=body.amount,
        currency=currency,
        category=category,
        method=body.method,
        status="pledged",
        anonymous=body.anonymous,
        recognition_consent=body.recognition_consent,
        notes=body.notes,
        reference=_reference(),
    )
    db.add(d)
    await db.flush()
    await _complete(db, d, me, body.payment_reference)
    await record(
        db,
        actor_id=me.id,
        action="create",
        entity="donation",
        entity_id=d.id,
        summary=f"Recorded donation {d.reference} from {d.donor_name}",
        ip=client_ip(request),
    )
    return {"data": donation_out(d, c, staff=True)}


class StatusChange(BaseModel):
    status: Literal["cancelled", "refunded"]
    notes: str | None = Field(None, max_length=1000)


@admin.post("/{donation_id}/status", summary="Cancel a pledge or mark a donation as refunded")
async def change_status(
    donation_id: uuid.UUID,
    body: StatusChange,
    request: Request,
    me: Principal = Depends(require("donations.configure")),
    db: AsyncSession = Depends(get_db),
):
    d = await db.get(Donation, donation_id, with_for_update=True)
    if not d:
        raise not_found("Donation")
    if body.status == "refunded" and d.status != "completed":
        raise conflict("NOT_COMPLETED", "Only completed donations can be refunded.")
    if body.status == "cancelled" and d.status != "pledged":
        raise conflict("NOT_PLEDGED", "Only pledges can be cancelled.")
    if body.status == "refunded" and d.campaign_id:
        c = await db.get(Campaign, d.campaign_id, with_for_update=True)
        c.raised_amount = max(0.0, money(c.raised_amount) - money(d.amount))
    d.status = body.status
    if body.notes:
        d.notes = body.notes
    await record(
        db,
        actor_id=me.id,
        action=body.status,
        entity="donation",
        entity_id=d.id,
        summary=f"Donation {d.reference}: {body.status}",
        ip=client_ip(request),
    )
    return {"data": donation_out(d, staff=True)}


@admin.get("/{donation_id}/receipt", summary="Receipt (staff)", response_class=HTMLResponse)
async def admin_receipt(donation_id: uuid.UUID, me: Principal = Depends(require("donations.view")), db: AsyncSession = Depends(get_db)):
    d = await db.get(Donation, donation_id)
    if not d or d.status != "completed":
        raise not_found("Receipt")
    return HTMLResponse(await _receipt_html(db, d), headers={"Cache-Control": "private, no-store"})


# ── scholarships ────────────────────────────────────────────────────────────
async def scholarship_out(db: AsyncSession, s: Scholarship, staff: bool = False) -> dict:
    funds = (
        await db.execute(select(func.coalesce(func.sum(Campaign.raised_amount), 0)).where(Campaign.scholarship_id == s.id))
    ).scalar_one()
    awarded, n = (
        await db.execute(
            select(func.coalesce(func.sum(ScholarshipAward.amount), 0), func.count()).where(ScholarshipAward.scholarship_id == s.id)
        )
    ).one()
    camp = (
        await db.execute(select(Campaign).where(Campaign.scholarship_id == s.id, Campaign.status == "active").limit(1))
    ).scalar_one_or_none()
    out = {
        "id": str(s.id),
        "name": s.name,
        "description": s.description,
        "criteria": s.criteria,
        "amount_per_award": money(s.amount_per_award) or None,
        "currency": s.currency,
        "awards_per_year": s.awards_per_year,
        "sponsor_name": s.sponsor_name,
        "status": s.status,
        "image": await image(db, s.image_id),
        "funds_raised": money(funds),
        "awards_count": n,
        "awarded_amount": money(awarded),
        "campaign": {"id": str(camp.id), "title": camp.title} if camp else None,
    }
    if staff:
        out["image_id"] = str(s.image_id) if s.image_id else None
    return out


@scholarships_router.get("", summary="Scholarship funds")
async def list_scholarships(me: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Scholarship).where(Scholarship.status == "active").order_by(Scholarship.name))).scalars().all()
    return {"data": [await scholarship_out(db, s) for s in rows]}


class ScholarshipIn(BaseModel):
    name: str = Field(..., min_length=3, max_length=200)
    description: str = Field("", max_length=10000)
    criteria: str = Field("", max_length=5000)
    amount_per_award: Decimal | None = Field(None, gt=0, max_digits=14, decimal_places=2)
    currency: str = Field("PKR", pattern=r"^[A-Z]{3}$")
    awards_per_year: int | None = Field(None, ge=1, le=1000)
    sponsor_name: str | None = Field(None, max_length=150)
    status: Literal["active", "closed"] = "active"
    image_id: uuid.UUID | None = None


@scholarships_admin.get("", summary="All scholarships")
async def admin_scholarships(me: Principal = Depends(require("scholarships.view")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Scholarship).order_by(Scholarship.status, Scholarship.name))).scalars().all()
    return {"data": [await scholarship_out(db, s, staff=True) for s in rows]}


@scholarships_admin.post("", status_code=201, summary="Create a scholarship")
async def create_scholarship(
    body: ScholarshipIn, me: Principal = Depends(require("scholarships.create")), db: AsyncSession = Depends(get_db)
):
    s = Scholarship(**body.model_dump())
    db.add(s)
    await db.flush()
    return {"data": await scholarship_out(db, s, staff=True)}


@scholarships_admin.put("/{scholarship_id}", summary="Edit a scholarship")
async def edit_scholarship(
    scholarship_id: uuid.UUID,
    body: ScholarshipIn,
    me: Principal = Depends(require("scholarships.edit")),
    db: AsyncSession = Depends(get_db),
):
    s = await db.get(Scholarship, scholarship_id)
    if not s:
        raise not_found("Scholarship")
    for k, v in body.model_dump().items():
        setattr(s, k, v)
    return {"data": await scholarship_out(db, s, staff=True)}


@scholarships_admin.delete("/{scholarship_id}", summary="Delete a scholarship without awards")
async def delete_scholarship(
    scholarship_id: uuid.UUID, me: Principal = Depends(require("scholarships.delete")), db: AsyncSession = Depends(get_db)
):
    s = await db.get(Scholarship, scholarship_id)
    if not s:
        raise not_found("Scholarship")
    if (await db.execute(select(ScholarshipAward.id).where(ScholarshipAward.scholarship_id == s.id))).first():
        raise conflict("HAS_AWARDS", "This scholarship has awards. Close it instead.")
    await db.delete(s)
    return {"data": {"ok": True}}


class AwardIn(BaseModel):
    recipient_name: str = Field(..., min_length=2, max_length=150)
    recipient_class: str | None = Field(None, max_length=60)
    academic_year: str = Field(..., pattern=r"^\d{4}(-\d{2,4})?$")
    amount: Decimal = Field(..., gt=0, max_digits=14, decimal_places=2)
    awarded_on: date
    notes: str | None = Field(None, max_length=1000)


@scholarships_admin.get("/{scholarship_id}/awards", summary="Awards of a scholarship (private)")
async def awards(scholarship_id: uuid.UUID, me: Principal = Depends(require("scholarships.view")), db: AsyncSession = Depends(get_db)):
    rows = (
        (
            await db.execute(
                select(ScholarshipAward)
                .where(ScholarshipAward.scholarship_id == scholarship_id)
                .order_by(ScholarshipAward.awarded_on.desc())
            )
        )
        .scalars()
        .all()
    )
    return {
        "data": [
            {
                "id": str(a.id),
                "recipient_name": a.recipient_name,
                "recipient_class": a.recipient_class,
                "academic_year": a.academic_year,
                "amount": money(a.amount),
                "awarded_on": a.awarded_on,
                "notes": a.notes,
            }
            for a in rows
        ]
    }


@scholarships_admin.post("/{scholarship_id}/awards", status_code=201, summary="Record a scholarship award")
async def add_award(
    scholarship_id: uuid.UUID,
    body: AwardIn,
    request: Request,
    me: Principal = Depends(require("scholarships.create")),
    db: AsyncSession = Depends(get_db),
):
    s = await db.get(Scholarship, scholarship_id)
    if not s:
        raise not_found("Scholarship")
    a = ScholarshipAward(scholarship_id=s.id, created_by=me.id, **body.model_dump())
    db.add(a)
    await record(
        db,
        actor_id=me.id,
        action="award",
        entity="scholarship",
        entity_id=s.id,
        summary=f"Scholarship award recorded: {s.name}",
        ip=client_ip(request),
    )
    await db.flush()
    return {"data": {"id": str(a.id)}}


@scholarships_admin.get("/export", summary="Export scholarship awards (CSV)")
async def export_awards(me: Principal = Depends(require("scholarships.export")), db: AsyncSession = Depends(get_db)):
    rows = (
        await db.execute(
            select(ScholarshipAward, Scholarship.name)
            .join(Scholarship, Scholarship.id == ScholarshipAward.scholarship_id)
            .order_by(ScholarshipAward.awarded_on.desc())
        )
    ).all()
    return csv_response(
        "scholarship-awards.csv",
        ["Scholarship", "Recipient", "Class", "Academic year", "Amount", "Awarded on"],
        ([n, a.recipient_name, a.recipient_class or "", a.academic_year, money(a.amount), a.awarded_on.isoformat()] for a, n in rows),
    )
