"""Per-member settings with defaults: privacy, connections, preferences, locale, consents, security.

Profile visibility and per-section visibility stay on AlumniProfile (visibility / privacy); everything else lives here.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import MemberSettings

DEFAULTS: dict = {
    # privacy & visibility
    "show_in_directory": True,
    "appear_in_search": True,
    "show_communities": True,
    "show_online": True,
    "show_last_active": True,
    "show_activity": True,
    "show_connections": True,
    "show_mutual": True,
    "suggest_me": True,
    # connections & messaging
    "connection_requests": "anyone",  # anyone | batch | batch_range | none
    "msg_batchmates": True,  # batchmates may message me without a connection
    "msg_alumni": False,  # any verified alumnus may message me
    "msg_community": False,  # members of my communities may message me
    "allow_follow": True,
    "group_invites": "connections",  # connections | none
    # preferences
    "feed_sources": ["network", "communities", "batch", "all"],
    "feed_types": ["posts", "events", "jobs", "announcements"],
    "feed_order": "relevant",  # relevant | latest
    "hide_not_interested": True,
    "autoplay": True,
    "read_receipts": True,
    "typing": True,
    "theme": "light",  # light | dark | system
    "font_size": "medium",  # small | medium | large
    "compact": False,
    "open_links_new_tab": True,
    "show_suggestions": True,
    "weekly_digest": False,
    # language & region (language itself is users.language)
    "timezone": "Asia/Karachi",
    "date_format": "DD MMM, YYYY",  # DD MMM, YYYY | MMM DD, YYYY | DD/MM/YYYY | YYYY-MM-DD
    "time_format": "12",  # 12 | 24
    "first_day": "monday",  # monday | sunday | saturday
    "calendar": "gregorian",
    "region_country": None,
    "region_city": None,
    "regional_content": True,
    "local_time_in_emails": True,
    # data & privacy
    "consent_analytics": True,
    "consent_personalization": True,
    "consent_product_updates": True,
    "consent_announcements": True,
    "data_retention": "policy",
    # security
    "login_alerts": True,
}
CHOICES: dict[str, tuple] = {
    "connection_requests": ("anyone", "batch", "batch_range", "none"),
    "group_invites": ("connections", "none"),
    "feed_order": ("relevant", "latest"),
    "theme": ("light", "dark", "system"),
    "font_size": ("small", "medium", "large"),
    "date_format": ("DD MMM, YYYY", "MMM DD, YYYY", "DD/MM/YYYY", "YYYY-MM-DD"),
    "time_format": ("12", "24"),
    "first_day": ("monday", "sunday", "saturday"),
    "calendar": ("gregorian",),
    "data_retention": ("policy", "1y", "3y", "5y"),
}
LISTS: dict[str, tuple] = {
    "feed_sources": ("network", "communities", "batch", "all"),
    "feed_types": ("posts", "events", "jobs", "announcements"),
}
TEXT = {"timezone": 64, "region_country": 100, "region_city": 100}


def clean(changes: dict) -> tuple[dict, list[str]]:
    """Validate a partial update; returns (accepted values, rejected keys)."""
    ok, bad = {}, []
    for k, v in changes.items():
        if k not in DEFAULTS:
            bad.append(k)
        elif k in CHOICES:
            (ok.__setitem__(k, v) if v in CHOICES[k] else bad.append(k))
        elif k in LISTS:
            (ok.__setitem__(k, list(dict.fromkeys(x for x in v if x in LISTS[k]))) if isinstance(v, list) else bad.append(k))
        elif k in TEXT:
            (
                ok.__setitem__(k, (str(v).strip()[: TEXT[k]] or None) if v is not None else None)
                if v is None or isinstance(v, str)
                else bad.append(k)
            )
        elif isinstance(DEFAULTS[k], bool):
            (ok.__setitem__(k, v) if isinstance(v, bool) else bad.append(k))
        else:
            bad.append(k)
    return ok, bad


async def get(db: AsyncSession, user_id: uuid.UUID) -> dict:
    row = await db.get(MemberSettings, user_id)
    return {**DEFAULTS, **((row.data or {}) if row else {})}


async def get_many(db: AsyncSession, ids) -> dict[uuid.UUID, dict]:
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    rows = {r.user_id: r.data or {} for r in (await db.execute(select(MemberSettings).where(MemberSettings.user_id.in_(ids)))).scalars()}
    return {i: {**DEFAULTS, **rows.get(i, {})} for i in ids}


async def save(db: AsyncSession, user_id: uuid.UUID, changes: dict) -> dict:
    row = await db.get(MemberSettings, user_id)
    if not row:
        row = MemberSettings(user_id=user_id, data={})
        db.add(row)
    row.data = {**(row.data or {}), **changes}
    await db.flush()
    return {**DEFAULTS, **row.data}


def opted_out(key: str):
    """Subquery of member ids whose boolean setting `key` is switched off (default on)."""
    return select(MemberSettings.user_id).where(MemberSettings.data[key].astext == "false")


def opted_in(key: str):
    """Subquery of member ids whose boolean setting `key` is switched on (default off)."""
    return select(MemberSettings.user_id).where(MemberSettings.data[key].astext == "true")
