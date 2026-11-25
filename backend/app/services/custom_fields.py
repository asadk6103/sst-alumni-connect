"""User-defined custom fields: definitions, validation, conditional visibility and per-viewer output.

Values are stored in each entity's `custom_fields` JSONB column keyed by field key, so new fields never need a
schema change. Values of fields that are later deactivated or deleted are kept (never destroyed) but no longer shown.
"""

import re
import uuid
from datetime import date

from email_validator import EmailNotValidError, validate_email
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.errors import AppError
from ..models import CustomField, Media

ENTITIES = {
    "alumni_profile": "Alumni profiles (and registration)",
    "job_post": "Job postings",
    "event": "Events",
    "mentor": "Mentor profiles",
    "donation": "Donations",
}
TYPES = ("text", "textarea", "number", "email", "phone", "date", "select", "multiselect", "checkbox", "radio", "file", "url")
CHOICE_TYPES = ("select", "multiselect", "radio")
VISIBILITY = ("public", "members", "connections", "private")
# who is looking → which visibility levels they may see
LEVELS = {
    "public": {"public"},
    "member": {"public", "members"},
    "connection": {"public", "members", "connections"},
    "owner": {"public", "members", "connections", "private"},
}
PHONE = re.compile(r"^\+?[0-9 ()\-]{7,20}$")
DEFAULT_MAX = {"text": 500, "textarea": 5000, "url": 500, "email": 255, "phone": 20}


async def definitions(db: AsyncSession, entity: str, *, active_only: bool = True, registration: bool = False) -> list[CustomField]:
    stmt = select(CustomField).where(CustomField.entity == entity)
    if active_only:
        stmt = stmt.where(CustomField.active.is_(True))
    if registration:
        stmt = stmt.where(CustomField.on_registration.is_(True))
    return list((await db.execute(stmt.order_by(CustomField.position, CustomField.created_at))).scalars())


def definition_out(f: CustomField, lang: str | None = None) -> dict:
    return {
        "id": str(f.id),
        "entity": f.entity,
        "key": f.key,
        "label": (f.labels or {}).get(lang or "", "") or f.label,
        "labels": f.labels or {},
        "help_text": f.help_text,
        "type": f.field_type,
        "options": f.options or [],
        "required": f.required,
        "visibility": f.visibility,
        "validation": f.validation or {},
        "condition": f.condition,
        "on_registration": f.on_registration,
        "position": f.position,
        "active": f.active,
    }


def _norm(x) -> str:
    return ("true" if x else "false") if isinstance(x, bool) else str(x)


def condition_met(f: CustomField, values: dict) -> bool:
    c = f.condition
    if not c or not c.get("field"):
        return True
    other = values.get(c["field"])
    op, want = c.get("operator", "equals"), c.get("value")
    present = other not in (None, "", [], False)
    if op == "filled":
        return present
    wanted = {_norm(w) for w in want} if isinstance(want, list) else {_norm(want)}
    got = {_norm(o) for o in other} if isinstance(other, list) else ({_norm(other)} if other is not None else set())
    hit = bool(got & wanted)
    return not hit if op == "not_equals" else hit


def _err(errors: list, key: str, message: str) -> None:
    errors.append({"field": f"custom_fields.{key}", "message": message})


async def _check(db: AsyncSession, f: CustomField, v, actor: uuid.UUID | None, previous, errors: list):
    """Returns the normalised value, or appends an error and returns None."""
    rules, t, label = f.validation or {}, f.field_type, f.label
    msg = rules.get("message")
    if t in ("text", "textarea", "email", "phone", "url"):
        if not isinstance(v, str):
            return _err(errors, f.key, f"{label}: enter text.")
        v = v.strip()
        lo, hi = rules.get("min_length"), rules.get("max_length") or DEFAULT_MAX[t]
        if lo and len(v) < lo:
            return _err(errors, f.key, msg or f"{label}: at least {lo} characters.")
        if len(v) > hi:
            return _err(errors, f.key, msg or f"{label}: at most {hi} characters.")
        if t == "email":
            try:
                v = validate_email(v, check_deliverability=False).normalized
            except EmailNotValidError:
                return _err(errors, f.key, msg or f"{label}: enter a valid email address.")
        if t == "phone" and not PHONE.match(v):
            return _err(errors, f.key, msg or f"{label}: enter a valid phone number.")
        if t == "url" and not re.match(r"^https?://[^\s/$.?#][^\s]*$", v, re.I):
            return _err(errors, f.key, msg or f"{label}: enter a web address starting with https://")
        if rules.get("pattern") and not re.fullmatch(rules["pattern"], v):
            return _err(errors, f.key, msg or f"{label}: the format is not valid.")
        return v
    if t == "number":
        try:
            n = float(v)
        except (TypeError, ValueError):
            return _err(errors, f.key, f"{label}: enter a number.")
        if n != n or n in (float("inf"), float("-inf")):
            return _err(errors, f.key, f"{label}: enter a number.")
        if rules.get("min") is not None and n < float(rules["min"]):
            return _err(errors, f.key, msg or f"{label}: at least {rules['min']}.")
        if rules.get("max") is not None and n > float(rules["max"]):
            return _err(errors, f.key, msg or f"{label}: at most {rules['max']}.")
        return int(n) if n.is_integer() else n
    if t == "date":
        try:
            d = date.fromisoformat(str(v))
        except ValueError:
            return _err(errors, f.key, f"{label}: enter a valid date.")
        if rules.get("min") and d < date.fromisoformat(rules["min"]):
            return _err(errors, f.key, msg or f"{label}: on or after {rules['min']}.")
        if rules.get("max") and d > date.fromisoformat(rules["max"]):
            return _err(errors, f.key, msg or f"{label}: on or before {rules['max']}.")
        return d.isoformat()
    allowed = {str(o.get("value")) for o in f.options or []}
    if t in ("select", "radio"):
        if str(v) not in allowed:
            return _err(errors, f.key, f"{label}: choose one of the options.")
        return str(v)
    if t == "multiselect":
        if not isinstance(v, list) or any(str(x) not in allowed for x in v):
            return _err(errors, f.key, f"{label}: choose from the options.")
        v = list(dict.fromkeys(str(x) for x in v))
        if rules.get("min") and len(v) < int(rules["min"]):
            return _err(errors, f.key, msg or f"{label}: choose at least {rules['min']}.")
        if rules.get("max") and len(v) > int(rules["max"]):
            return _err(errors, f.key, msg or f"{label}: choose at most {rules['max']}.")
        return v
    if t == "checkbox":
        if not isinstance(v, bool):
            return _err(errors, f.key, f"{label}: tick or untick the box.")
        return v
    if t == "file":
        if v == previous:
            return v  # unchanged
        try:
            mid = uuid.UUID(str(v))
        except ValueError:
            return _err(errors, f.key, f"{label}: upload the file again.")
        m = await db.get(Media, mid)
        # Only a private file the same person uploaded can be attached (no attaching other people's files).
        if not m or m.deleted_at or not m.private or (actor and m.uploaded_by != actor):
            return _err(errors, f.key, f"{label}: upload the file again.")
        return str(mid)
    return _err(errors, f.key, f"{label}: unsupported field.")


def _empty(v) -> bool:
    return v is None or v == "" or v == [] or (isinstance(v, str) and not v.strip())


async def clean(
    db: AsyncSession,
    entity: str,
    incoming: dict | None,
    existing: dict | None = None,
    *,
    registration: bool = False,
    actor: uuid.UUID | None = None,
    defs: list[CustomField] | None = None,
) -> dict:
    """Validate submitted values for all active fields of an entity and merge them into the stored values.

    Fields hidden by their condition are cleared and never required; unknown keys are ignored (stale clients).
    Raises a 422 with one detail per field so the form can show every problem at once.
    """
    defs = defs if defs is not None else await definitions(db, entity, registration=registration)
    incoming, merged = dict(incoming or {}), dict(existing or {})
    errors: list = []
    # Conditions are evaluated against the submitted values (falling back to stored ones).
    view = {**merged, **{k: v for k, v in incoming.items() if any(d.key == k for d in defs)}}
    for f in defs:
        if not condition_met(f, view):
            merged.pop(f.key, None)
            continue
        v = incoming.get(f.key, merged.get(f.key))
        if _empty(v) or (f.field_type == "checkbox" and v is False and f.required):
            if f.required:
                _err(errors, f.key, f"{f.label} is required." if f.field_type != "checkbox" else f"Please tick “{f.label}”.")
            else:
                merged.pop(f.key, None)
            continue
        out = await _check(db, f, v, actor, (existing or {}).get(f.key), errors)
        if out is not None:
            merged[f.key] = out
    if errors:
        raise AppError(
            422, "VALIDATION_ERROR", errors[0]["message"] if len(errors) == 1 else "Please check the highlighted fields.", errors
        )
    return merged


def display(f: CustomField, v) -> str:
    labels = {str(o.get("value")): o.get("label") or str(o.get("value")) for o in f.options or []}
    if f.field_type == "multiselect" and isinstance(v, list):
        return ", ".join(labels.get(str(x), str(x)) for x in v)
    if f.field_type in ("select", "radio"):
        return labels.get(str(v), str(v))
    if f.field_type == "checkbox":
        return "Yes" if v else "No"
    if f.field_type == "file":
        return "Attached file"
    return str(v)


def visible(defs: list[CustomField], values: dict | None, level: str, lang: str | None = None) -> list[dict]:
    """Values the viewer may see, in field order, ready to display."""
    allowed, values = LEVELS[level], values or {}
    out = []
    for f in defs:
        v = values.get(f.key)
        if f.visibility not in allowed or _empty(v) or not condition_met(f, values):
            continue
        out.append(
            {
                "key": f.key,
                "label": (f.labels or {}).get(lang or "", "") or f.label,
                "type": f.field_type,
                "value": v,
                "display": display(f, v),
            }
        )
    return out


async def visible_for(db: AsyncSession, entity: str, values: dict | None, level: str, lang: str | None = None) -> list[dict]:
    if not values:
        return []
    return visible(await definitions(db, entity), values, level, lang)
