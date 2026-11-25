"""System Configuration Center API."""

import asyncio
import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, EmailStr, Field, TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.audit import record
from ...core.db import get_db
from ...core.deps import Principal, client_ip, require, require_staff
from ...core.errors import AppError, forbidden, not_found
from ...core.pagination import PageParams, page_params, paginate
from ...core.permissions import DEFAULT_ROLES
from ...core.settings_schemas import DEFAULT_MODULES, RESTART_FIELDS, SETTINGS_GROUPS, Branding
from ...models import BrandingSetting, FeatureFlag, IntegrationSetting, MessageTemplate, ModuleSetting, NotificationLog
from ...services import integrations, media, messaging, storage
from ...services.templates import render, wrap_email

router = APIRouter(prefix="/api/v1/admin/config", tags=["Admin: configuration"])
GROUP_PERMS = {"general": "settings", "security": "settings", "realtime": "settings"}


def _validation_error(e: ValidationError) -> AppError:
    return AppError(
        422,
        "VALIDATION_ERROR",
        "Some fields are not valid.",
        [{"field": ".".join(str(x) for x in err["loc"]), "message": err["msg"]} for err in e.errors()],
    )


# ── settings groups ──────────────────────────────────────────────────────────
# Who may read / change each group (system settings permissions always work).
GROUP_PERMS: dict[str, tuple[str, str]] = {
    "donations": ("donations.view", "donations.configure"),
    "alumni": ("alumni.view", "settings.configure"),
    "website": ("cms.view", "cms.publish"),
}


def _group_perm(group: str, write: bool):
    async def dep(p: Principal = Depends(require_staff())) -> Principal:
        read, change = GROUP_PERMS.get(group, ("settings.view", "settings.configure"))
        needed = (change, "settings.configure") if write else (read, "settings.view")
        if not any(p.can(x) for x in needed):
            raise forbidden()
        return p

    return dep


@router.get("/settings/{group}", summary="Read a settings group")
async def get_settings(
    group: Literal["general", "security", "realtime", "alumni", "dashboard", "donations", "website"],
    me: Principal = Depends(require_staff()),
    db: AsyncSession = Depends(get_db),
):
    await _group_perm(group, False)(me)
    value = await settings_store.get_group(db, group)
    return {"data": value.model_dump(mode="json"), "meta": {"restart_required_fields": RESTART_FIELDS.get(group, [])}}


@router.put("/settings/{group}", summary="Save a settings group")
async def put_settings(
    group: Literal["general", "security", "realtime", "alumni", "dashboard", "donations", "website"],
    body: dict,
    request: Request,
    me: Principal = Depends(require_staff()),
    db: AsyncSession = Depends(get_db),
):
    await _group_perm(group, True)(me)
    try:
        value = SETTINGS_GROUPS[group].model_validate(body)
    except ValidationError as e:
        raise _validation_error(e) from e
    before = (await settings_store.get_group(db, group)).model_dump(mode="json")
    await settings_store.save_group(db, group, value, me.id)
    after = value.model_dump(mode="json")
    diff = {k: {"from": before.get(k), "to": v} for k, v in after.items() if before.get(k) != v}
    restart = [f for f in RESTART_FIELDS.get(group, []) if f in diff]
    await record(
        db,
        actor_id=me.id,
        action="update",
        entity="settings",
        entity_id=group,
        summary=f"Updated {group} settings",
        data=diff,
        ip=client_ip(request),
    )
    return {"data": after, "meta": {"restart_required": restart}}


# ── branding ─────────────────────────────────────────────────────────────────
async def _brand_row(db: AsyncSession) -> BrandingSetting:
    row = await db.get(BrandingSetting, 1)
    if not row:
        d = Branding().model_dump(mode="json")
        row = BrandingSetting(id=1, draft=d, published=d, version=1)
        db.add(row)
        await db.flush()
    return row


async def _brand_assets(db: AsyncSession, b: dict) -> dict:
    from ...models import Media

    out = {}
    for f in ("institution_logo", "logo_light", "logo_dark", "favicon", "login_background", "dashboard_banner"):
        if b.get(f):
            try:
                m = await db.get(Media, uuid.UUID(b[f]))
            except ValueError:
                m = None
            out[f] = await media.to_public(db, m) if m and not m.deleted_at else None
    return out


@router.get("/branding", summary="Draft and published branding")
async def get_branding(_: Principal = Depends(require("branding.view")), db: AsyncSession = Depends(get_db)):
    row = await _brand_row(db)
    draft, published = Branding.model_validate(row.draft or {}), Branding.model_validate(row.published or {})
    return {
        "data": {
            "draft": draft.model_dump(mode="json"),
            "published": published.model_dump(mode="json"),
            "assets": await _brand_assets(db, {**row.published, **row.draft}),
            "has_unpublished_changes": row.draft != row.published,
            "version": row.version,
            "published_at": row.published_at,
        }
    }


@router.put("/branding", summary="Save the branding draft (not visible until published)")
async def put_branding(body: dict, request: Request, me: Principal = Depends(require("branding.edit")), db: AsyncSession = Depends(get_db)):
    try:
        value = Branding.model_validate(body).model_dump(mode="json")
    except ValidationError as e:
        raise _validation_error(e) from e
    row = await _brand_row(db)
    row.draft, row.updated_by = value, me.id
    await settings_store.changed()
    return {"data": {"draft": value, "has_unpublished_changes": value != row.published}}


@router.post("/branding/publish", summary="Publish the branding draft to every app")
async def publish_branding(request: Request, me: Principal = Depends(require("branding.publish")), db: AsyncSession = Depends(get_db)):
    row = await _brand_row(db)
    row.published, row.version, row.published_at, row.updated_by = row.draft, row.version + 1, datetime.now(UTC), me.id
    await settings_store.changed()
    await record(
        db, actor_id=me.id, action="publish", entity="branding", summary=f"Published branding v{row.version}", ip=client_ip(request)
    )
    return {"data": {"version": row.version}}


@router.post("/branding/discard", summary="Discard unpublished branding changes")
async def discard_branding(me: Principal = Depends(require("branding.edit")), db: AsyncSession = Depends(get_db)):
    row = await _brand_row(db)
    row.draft = row.published
    await settings_store.changed()
    return {"data": {"draft": row.published}}


# ── modules ──────────────────────────────────────────────────────────────────
@router.get("/modules", summary="Module switches")
async def get_modules(_: Principal = Depends(require("modules.view")), db: AsyncSession = Depends(get_db)):
    rows = {m.key: m for m in (await db.execute(select(ModuleSetting))).scalars()}
    return {
        "data": [
            {
                "key": k,
                "name": n,
                "description": d,
                "enabled": rows[k].enabled if k in rows else True,
                "updated_at": rows[k].updated_at if k in rows else None,
            }
            for k, (n, d) in DEFAULT_MODULES.items()
        ]
    }


class ModuleIn(BaseModel):
    enabled: bool


@router.put("/modules/{key}", summary="Enable or disable a module (data is kept)")
async def put_module(
    key: str, body: ModuleIn, request: Request, me: Principal = Depends(require("modules.configure")), db: AsyncSession = Depends(get_db)
):
    if key not in DEFAULT_MODULES:
        raise not_found("Module")
    row = await db.get(ModuleSetting, key)
    if not row:
        row = ModuleSetting(key=key, config={})
        db.add(row)
    row.enabled, row.updated_by = body.enabled, me.id
    await settings_store.changed()
    await record(
        db,
        actor_id=me.id,
        action="enable" if body.enabled else "disable",
        entity="module",
        entity_id=key,
        summary=f"{'Enabled' if body.enabled else 'Disabled'} module {DEFAULT_MODULES[key][0]}",
        ip=client_ip(request),
    )
    return {"data": {"key": key, "enabled": row.enabled}}


# ── feature flags ────────────────────────────────────────────────────────────
@router.get("/feature-flags", summary="Feature flags")
async def get_flags(_: Principal = Depends(require("feature_flags.view")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(FeatureFlag).order_by(FeatureFlag.name))).scalars().all()
    return {
        "data": [
            {
                "key": f.key,
                "name": f.name,
                "description": f.description,
                "enabled": f.enabled,
                "roles": f.roles or [],
                "updated_at": f.updated_at,
            }
            for f in rows
        ]
    }


class FlagIn(BaseModel):
    enabled: bool
    roles: list[str] = Field(default_factory=list)


@router.put("/feature-flags/{key}", summary="Turn a feature flag on/off, optionally for some roles only")
async def put_flag(
    key: str,
    body: FlagIn,
    request: Request,
    me: Principal = Depends(require("feature_flags.configure")),
    db: AsyncSession = Depends(get_db),
):
    flag = await db.get(FeatureFlag, key)
    if not flag:
        raise not_found("Feature flag")
    from ...models import Role

    known = {r for (r,) in (await db.execute(select(Role.key))).all()} | set(DEFAULT_ROLES)
    if bad := [r for r in body.roles if r not in known]:
        raise AppError(422, "UNKNOWN_ROLE", f"Unknown role(s): {', '.join(bad)}")
    flag.enabled, flag.roles = body.enabled, body.roles
    await settings_store.changed()
    await record(
        db,
        actor_id=me.id,
        action="update",
        entity="feature_flag",
        entity_id=key,
        summary=f"{'Enabled' if body.enabled else 'Disabled'} feature {flag.name}",
        data={"roles": body.roles},
        ip=client_ip(request),
    )
    return {"data": {"key": key, "enabled": flag.enabled, "roles": flag.roles}}


# ── integrations ─────────────────────────────────────────────────────────────
Kind = Literal["email", "sms", "storage", "payment"]


@router.get("/integrations", summary="All integrations (secrets masked)")
async def list_integrations(_: Principal = Depends(require("integrations.view")), db: AsyncSession = Depends(get_db)):
    out = []
    for kind in ("email", "sms", "storage", "payment"):
        out.append(
            integrations.public_view(await db.get(IntegrationSetting, kind), kind)
            | {"providers": list(integrations.PROVIDERS[kind].keys())}
        )
    return {"data": out, "meta": {"bundled_storage": bool(integrations.bundled_minio_defaults())}}


@router.put("/integrations/{kind}", summary="Save an integration (empty secret = keep the stored one)")
async def put_integration(
    kind: Kind,
    body: integrations.IntegrationUpdate,
    request: Request,
    me: Principal = Depends(require("integrations.configure")),
    db: AsyncSession = Depends(get_db),
):
    if kind == "payment":
        raise AppError(409, "NOT_AVAILABLE", "Payment providers are not available yet.")
    try:
        row = await integrations.save(db, kind, body, me.id)
    except ValidationError as e:
        raise _validation_error(e) from e
    await record(
        db,
        actor_id=me.id,
        action="update",
        entity="integration",
        entity_id=kind,
        summary=f"Updated {kind} integration ({body.provider}, {'enabled' if body.enabled else 'disabled'})",
        data={"secrets_changed": sorted(body.secrets)},
        ip=client_ip(request),
    )
    return {"data": integrations.public_view(row, kind)}


class TestIn(BaseModel):
    send_to: str | None = Field(None, max_length=255)


@router.post("/integrations/{kind}/test", summary="Test the saved integration (optionally send a test message)")
async def test_integration(
    kind: Literal["email", "sms", "storage"],
    body: TestIn,
    request: Request,
    me: Principal = Depends(require("integrations.configure")),
    db: AsyncSession = Depends(get_db),
):
    integ = await integrations.load(db, kind)
    if not integ:
        raise AppError(409, "NOT_CONFIGURED", "Save the settings first.")
    general = await settings_store.get_group(db, "general")
    try:
        if kind == "email":
            if body.send_to:
                try:
                    TypeAdapter(EmailStr).validate_python(body.send_to)
                except ValidationError as e:
                    raise AppError(
                        422,
                        "INVALID_EMAIL",
                        "Enter a valid email address.",
                        [{"field": "send_to", "message": "Not a valid email address."}],
                    ) from e
                html = wrap_email(render("<p>This is a test message. Your email settings work.</p>", {}), general.app_name)
                await asyncio.to_thread(
                    messaging.smtp_send, integ.config, integ.secrets, body.send_to, f"Test email from {general.app_name}", html
                )
                msg = f"Test email sent to {body.send_to}."
                db.add(
                    NotificationLog(
                        channel="email",
                        recipient=body.send_to,
                        template="system.test_email",
                        subject=f"Test email from {general.app_name}",
                        status="sent",
                        sent_at=datetime.now(UTC),
                    )
                )
            else:
                msg = await asyncio.to_thread(messaging.smtp_check, integ.config, integ.secrets)
        elif kind == "sms":
            if not body.send_to:
                raise AppError(422, "PHONE_REQUIRED", "Enter a mobile number to send the test SMS to.")
            msg = await asyncio.to_thread(
                messaging.sms_send,
                integ.config,
                integ.secrets,
                body.send_to,
                f"Test message from {general.app_name}: your SMS settings work.",
            )
            db.add(
                NotificationLog(channel="sms", recipient=body.send_to, template="system.test_sms", status="sent", sent_at=datetime.now(UTC))
            )
        else:
            msg = await (await storage.backend(db)).check() if integ.enabled else "Storage is disabled; using local storage."
        ok = True
    except (messaging.DeliveryError, storage.StorageError) as e:
        ok, msg = False, str(e)
    await integrations.record_test(db, kind, ok, msg)
    await record(
        db,
        actor_id=me.id,
        action="test",
        entity="integration",
        entity_id=kind,
        summary=f"Tested {kind} integration: {'OK' if ok else 'failed'}",
        ip=client_ip(request),
    )
    return {"data": {"ok": ok, "message": msg}}


# ── message templates ────────────────────────────────────────────────────────
def tpl_out(t: MessageTemplate) -> dict:
    return {
        "id": str(t.id),
        "key": t.key,
        "channel": t.channel,
        "language": t.language,
        "name": t.name,
        "subject": t.subject,
        "body": t.body,
        "placeholders": t.placeholders,
        "enabled": t.enabled,
        "updated_at": t.updated_at,
    }


@router.get("/templates", summary="Email / SMS templates")
async def list_templates(
    channel: Literal["email", "sms", "inapp"] | None = None,
    _: Principal = Depends(require("communications.view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(MessageTemplate).order_by(MessageTemplate.channel, MessageTemplate.key, MessageTemplate.language)
    if channel:
        stmt = stmt.where(MessageTemplate.channel == channel)
    return {"data": [tpl_out(t) for t in (await db.execute(stmt)).scalars()]}


class TemplateIn(BaseModel):
    subject: str | None = Field(None, max_length=250)
    body: str = Field(..., min_length=1, max_length=20000)
    enabled: bool = True


@router.put("/templates/{template_id}", summary="Edit a template")
async def put_template(
    template_id: uuid.UUID,
    body: TemplateIn,
    request: Request,
    me: Principal = Depends(require("communications.configure")),
    db: AsyncSession = Depends(get_db),
):
    t = await db.get(MessageTemplate, template_id)
    if not t:
        raise not_found("Template")
    if t.channel == "email" and not (body.subject or "").strip():
        raise AppError(422, "SUBJECT_REQUIRED", "Email templates need a subject.", [{"field": "subject", "message": "Required."}])
    if t.channel == "sms" and len(body.body) > 640:
        raise AppError(422, "TOO_LONG", "SMS templates are limited to 640 characters.", [{"field": "body", "message": "Too long."}])
    t.subject, t.body, t.enabled = body.subject, body.body, body.enabled
    await record(
        db,
        actor_id=me.id,
        action="update",
        entity="template",
        entity_id=t.id,
        summary=f"Edited template {t.name} ({t.language})",
        ip=client_ip(request),
    )
    return {"data": tpl_out(t)}


class TemplateLangIn(BaseModel):
    language: str = Field(..., pattern=r"^[a-z]{2}(-[A-Z]{2})?$")


@router.post("/templates/{template_id}/translations", status_code=201, summary="Add a language version")
async def add_translation(
    template_id: uuid.UUID,
    body: TemplateLangIn,
    me: Principal = Depends(require("communications.configure")),
    db: AsyncSession = Depends(get_db),
):
    t = await db.get(MessageTemplate, template_id)
    if not t:
        raise not_found("Template")
    exists = (
        await db.execute(
            select(MessageTemplate.id).where(
                MessageTemplate.key == t.key, MessageTemplate.channel == t.channel, MessageTemplate.language == body.language
            )
        )
    ).first()
    if exists:
        raise AppError(409, "EXISTS", "That language version already exists.")
    n = MessageTemplate(
        key=t.key,
        channel=t.channel,
        language=body.language,
        name=t.name,
        subject=t.subject,
        body=t.body,
        placeholders=t.placeholders,
        enabled=t.enabled,
    )
    db.add(n)
    await db.flush()
    return {"data": tpl_out(n)}


@router.post("/templates/{template_id}/preview", summary="Render a template with sample values")
async def preview_template(
    template_id: uuid.UUID, body: TemplateIn, _: Principal = Depends(require("communications.view")), db: AsyncSession = Depends(get_db)
):
    t = await db.get(MessageTemplate, template_id)
    if not t:
        raise not_found("Template")
    general = await settings_store.get_group(db, "general")
    brand = await settings_store.branding(db)
    sample = {p: f"[{p}]" for p in t.placeholders} | {
        "app_name": general.app_name,
        "name": "Asad Mehmood",
        "link": f"{general.app_url}/example",
        "code": "123456",
    }
    if t.channel == "email":
        return {
            "data": {
                "subject": render(body.subject or "", sample),
                "html": wrap_email(render(body.body, sample, escape=True), general.app_name, brand.colors.primary),
            }
        }
    return {"data": {"text": render(body.body, sample)}}


# ── delivery logs ────────────────────────────────────────────────────────────
@router.get("/delivery-logs", summary="Email / SMS delivery log")
async def delivery_logs(
    channel: Literal["email", "sms"] | None = None,
    status: Literal["queued", "sent", "failed", "skipped"] | None = None,
    q: str | None = Query(None, max_length=100),
    p: PageParams = Depends(page_params),
    _: Principal = Depends(require("communications.view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(NotificationLog)
    if channel:
        stmt = stmt.where(NotificationLog.channel == channel)
    if status:
        stmt = stmt.where(NotificationLog.status == status)
    if q:
        stmt = stmt.where(NotificationLog.recipient.ilike(f"%{q}%"))
    rows, meta = await paginate(db, stmt.order_by(NotificationLog.created_at.desc(), NotificationLog.id.desc()), p)
    return {
        "data": [
            {
                "id": r.id,
                "channel": r.channel,
                "recipient": r.recipient,
                "template": r.template,
                "subject": r.subject,
                "status": r.status,
                "error": r.error,
                "attempts": r.attempts,
                "created_at": r.created_at,
                "sent_at": r.sent_at,
            }
            for r in rows
        ],
        "meta": meta,
    }
