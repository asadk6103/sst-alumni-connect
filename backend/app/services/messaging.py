"""Email (SMTP) and SMS (generic HTTP) delivery with delivery logs.

`queue_email` / `queue_sms` render a template and hand delivery to a Celery worker; delivery is
logged in notification_logs (queued → sent / failed / skipped).
"""

import json
import logging
import smtplib
import ssl
from datetime import UTC, datetime
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core import settings_store
from ..models import MessageTemplate, NotificationLog
from . import integrations
from .templates import render, wrap_email

log = logging.getLogger("app.messaging")


class DeliveryError(Exception):
    pass


# ── raw senders (used by workers and by "send test" buttons) ─────────────────
def smtp_send(cfg: dict, secrets: dict, to: str, subject: str, html_body: str, timeout: float = 15) -> None:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((cfg.get("sender_name") or "", cfg["sender_email"]))
    msg["To"] = to
    msg["Message-ID"] = make_msgid()
    if cfg.get("reply_to"):
        msg["Reply-To"] = cfg["reply_to"]
    msg.set_content("This message requires an HTML-capable email client.")
    msg.add_alternative(html_body, subtype="html")
    try:
        if cfg.get("encryption") == "ssl":
            server = smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=timeout, context=ssl.create_default_context())
        else:
            server = smtplib.SMTP(cfg["host"], cfg["port"], timeout=timeout)
        with server:
            if cfg.get("encryption") == "starttls":
                server.starttls(context=ssl.create_default_context())
            if cfg.get("username"):
                server.login(cfg["username"], secrets.get("password", ""))
            server.send_message(msg)
    except (OSError, smtplib.SMTPException) as e:
        raise DeliveryError(f"{type(e).__name__}: {e}") from e


def smtp_check(cfg: dict, secrets: dict, timeout: float = 10) -> str:
    """Connect (and authenticate) without sending."""
    try:
        if cfg.get("encryption") == "ssl":
            server = smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=timeout, context=ssl.create_default_context())
        else:
            server = smtplib.SMTP(cfg["host"], cfg["port"], timeout=timeout)
        with server:
            server.ehlo()
            if cfg.get("encryption") == "starttls":
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
            if cfg.get("username"):
                server.login(cfg["username"], secrets.get("password", ""))
        return "Connected successfully" + (" and signed in." if cfg.get("username") else ".")
    except (OSError, smtplib.SMTPException) as e:
        raise DeliveryError(f"{type(e).__name__}: {e}") from e


def sms_send(cfg: dict, secrets: dict, to: str, message: str, timeout: float = 15) -> str:
    values = {
        "to": to,
        "message": message,
        "sender_id": cfg.get("sender_id") or "",
        "account_id": cfg.get("account_id") or "",
        "api_key": secrets.get("api_key", ""),
    }
    # JSON-escape values placed into the JSON body template
    if cfg.get("content_type", "json") == "json":
        body_text = render(cfg["body_template"], {k: json.dumps(v)[1:-1] for k, v in values.items()})
        try:
            body = json.loads(body_text)
        except json.JSONDecodeError as e:
            raise DeliveryError(f"The request template is not valid JSON: {e}") from e
    else:
        body = {k: render(v, values) for k, v in json.loads(cfg["body_template"]).items()}
    headers, params = {}, {k: render(v, values) for k, v in (cfg.get("extra_params") or {}).items()}
    style, field = cfg.get("auth_style", "bearer"), cfg.get("auth_field", "api_key")
    if style == "bearer":
        headers["Authorization"] = f"Bearer {values['api_key']}"
    elif style == "header":
        headers[field] = values["api_key"]
    elif style == "query":
        params[field] = values["api_key"]
    elif style == "body" and isinstance(body, dict):
        body[field] = values["api_key"]
    try:
        with httpx.Client(timeout=timeout) as c:
            if cfg.get("method", "POST") == "GET":
                r = c.get(cfg["endpoint"], params={**params, **(body if isinstance(body, dict) else {})}, headers=headers)
            elif cfg.get("content_type", "json") == "json":
                r = c.post(cfg["endpoint"], params=params, json=body, headers=headers)
            else:
                r = c.post(cfg["endpoint"], params=params, data=body, headers=headers)
    except httpx.HTTPError as e:
        raise DeliveryError(f"{type(e).__name__}: {e}") from e
    if r.status_code not in (cfg.get("success_codes") or [200, 201, 202]):
        raise DeliveryError(f"Provider answered HTTP {r.status_code}: {r.text[:200]}")
    return f"Provider answered HTTP {r.status_code}."


# ── templates + queueing ─────────────────────────────────────────────────────
async def _template(db: AsyncSession, key: str, channel: str, language: str = "en") -> MessageTemplate | None:
    rows = (
        (
            await db.execute(
                select(MessageTemplate).where(
                    MessageTemplate.key == key, MessageTemplate.channel == channel, MessageTemplate.enabled.is_(True)
                )
            )
        )
        .scalars()
        .all()
    )
    return next((r for r in rows if r.language == language), None) or next((r for r in rows if r.language == "en"), None)


async def render_email(db: AsyncSession, key: str, data: dict, language: str = "en") -> tuple[str, str] | None:
    tpl = await _template(db, key, "email", language)
    if not tpl:
        return None
    general = await settings_store.get_group(db, "general")
    brand = await settings_store.branding(db)
    data = {"app_name": general.app_name, **data}
    subject = render(tpl.subject or "", data)
    return subject, wrap_email(render(tpl.body, data, escape=True), general.app_name, brand.colors.primary)


async def queue_email(db: AsyncSession, to: str, key: str, data: dict, language: str = "en") -> int | None:
    rendered = await render_email(db, key, data, language)
    if not rendered:
        return None
    subject, body = rendered
    entry = NotificationLog(
        channel="email", recipient=to, template=key, subject=subject, status="queued", payload={"to": to, "subject": subject, "html": body}
    )
    db.add(entry)
    await db.flush()
    payload = {"log_id": entry.id, **entry.payload}
    from ..worker import dispatch

    dispatch("app.tasks.send_email", payload, after_commit_of=db)
    return entry.id


async def queue_sms(db: AsyncSession, to: str, key: str, data: dict, language: str = "en") -> int | None:
    tpl = await _template(db, key, "sms", language)
    if not tpl:
        return None
    general = await settings_store.get_group(db, "general")
    text = render(tpl.body, {"app_name": general.app_name, **data})
    entry = NotificationLog(channel="sms", recipient=to, template=key, status="queued", payload={"to": to, "message": text})
    db.add(entry)
    await db.flush()
    from ..worker import dispatch

    dispatch("app.tasks.send_sms", {"log_id": entry.id, **entry.payload}, after_commit_of=db)
    return entry.id


async def deliver(db: AsyncSession, channel: str, payload: dict) -> None:
    """Executed by the worker: send and update the delivery log."""
    entry = await db.get(NotificationLog, payload["log_id"])
    if entry:
        entry.attempts = (entry.attempts or 0) + 1
    integ = await integrations.load(db, "email" if channel == "email" else "sms")
    if not integ or not integ.enabled:
        if entry:
            entry.status, entry.error = "skipped", f"{channel.upper()} is not configured or disabled."
        return
    import asyncio

    try:
        if channel == "email":
            await asyncio.to_thread(smtp_send, integ.config, integ.secrets, payload["to"], payload["subject"], payload["html"])
        else:
            await asyncio.to_thread(sms_send, integ.config, integ.secrets, payload["to"], payload["message"])
        if entry:
            entry.status, entry.sent_at, entry.error, entry.payload = "sent", datetime.now(UTC), None, None
    except DeliveryError as e:
        log.warning("%s delivery to %s failed: %s", channel, payload["to"], e)
        if entry:
            entry.status, entry.error = "failed", str(e)[:500]
        raise


async def queue_html_email(db: AsyncSession, to: str, subject: str, content_html: str, label: str, footer_html: str = "") -> int:
    """Queue an email whose (already safe) HTML was composed in the app, e.g. a newsletter issue."""
    general = await settings_store.get_group(db, "general")
    brand = await settings_store.branding(db)
    body = wrap_email(content_html + footer_html, general.app_name, brand.colors.primary)
    entry = NotificationLog(
        channel="email",
        recipient=to,
        template=label,
        subject=subject[:250],
        status="queued",
        payload={"to": to, "subject": subject, "html": body},
    )
    db.add(entry)
    await db.flush()
    from ..worker import dispatch

    dispatch("app.tasks.send_email", {"log_id": entry.id, **entry.payload}, after_commit_of=db)
    return entry.id
