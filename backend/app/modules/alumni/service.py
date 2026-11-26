"""Alumni domain logic shared by the portal, administration and registration endpoints."""

import re
import unicodedata
import uuid
from datetime import UTC, datetime

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.deps import Principal, forget_principals
from ...core.errors import AppError
from ...core.settings_schemas import AlumniSettings
from ...models import (
    AlumniAchievement,
    AlumniConnection,
    AlumniEducation,
    AlumniEmployment,
    AlumniFollow,
    AlumniProfile,
    AlumniSkill,
    Batch,
    Media,
    Role,
    StudentRecord,
    User,
    VerificationEvent,
)
from ...services import custom_fields, media

VERIFIED_ROLE = {"alumni": "verified_alumni", "student": "student"}
UNVERIFIED_ROLE = "unverified_alumni"
MEMBER_ROLES = {"verified_alumni", "student", UNVERIFIED_ROLE}

# Sections a member can show to all members, to connections only, or keep to themselves.
PRIVACY_SECTIONS = {
    "email": "Email address",
    "phone": "Mobile number",
    "birthday": "Date of birth",
    "location": "City and country",
    "career": "Current position, organisation, industry and experience",
    "education": "Higher education",
    "achievements": "Achievements",
    "links": "Website and LinkedIn",
}
LEVELS = ("members", "connections", "only_me")


def now() -> datetime:
    return datetime.now(UTC)


async def settings(db: AsyncSession) -> AlumniSettings:
    return await settings_store.get_group(db, "alumni")  # type: ignore[return-value]


# ── normalisation and record matching ───────────────────────────────────────
def norm_reg(value: str | None) -> str | None:
    if not value:
        return None
    out = re.sub(r"[^A-Z0-9]", "", value.upper())
    return out or None


def name_tokens(name: str | None) -> set[str]:
    if not name:
        return set()
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode() or name
    return {t for t in re.split(r"[^a-z]+", plain.casefold()) if len(t) > 1}


def names_match(a: str | None, b: str | None) -> bool:
    """Same tokens, or one name contained in the other (e.g. a middle name left out) with ≥2 tokens."""
    ta, tb = name_tokens(a), name_tokens(b)
    if not ta or not tb:
        return False
    small, big = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    return ta == tb or (len(small) >= 2 and small <= big)


def phone_digits(p: str | None) -> str:
    d = re.sub(r"\D", "", p or "")
    return d[-10:]  # compare the national significant part (+92 300… vs 0300…)


async def find_record(db: AsyncSession, profile: AlumniProfile, user: User) -> tuple[StudentRecord | None, str | None]:
    """Best institutional record for an applicant: 'strong' (identity data + contact on record) or 'partial'."""
    if not profile.reg_norm:
        return None, None
    rec = (await db.execute(select(StudentRecord).where(StudentRecord.reg_norm == profile.reg_norm))).scalar_one_or_none()
    if not rec or (rec.matched_user_id and rec.matched_user_id != user.id):
        return None, None
    name_ok = names_match(rec.full_name, user.full_name)
    year_ok = rec.graduation_year is None or profile.graduation_year is None or rec.graduation_year == profile.graduation_year
    dob_ok = rec.date_of_birth is None or profile.date_of_birth is None or rec.date_of_birth == profile.date_of_birth
    if not (name_ok and year_ok and dob_ok):
        return (rec, "partial") if (name_ok or year_ok) else (None, None)
    contact = bool(
        (rec.email and rec.email.lower() == user.email.lower())
        or (rec.phone and user.phone and phone_digits(rec.phone) == phone_digits(user.phone))
    )
    return rec, "strong" if contact else "partial"


def _contact_proven(rec: StudentRecord, user: User) -> bool:
    if rec.email and user.email_verified_at and rec.email.lower() == user.email.lower():
        return True
    return bool(rec.phone and user.phone and user.phone_verified_at and phone_digits(rec.phone) == phone_digits(user.phone))


async def refresh_match(db: AsyncSession, user: User, profile: AlumniProfile) -> None:
    rec, strength = await find_record(db, profile, user)
    profile.matched_record_id, profile.match_strength = (rec.id if rec else None), strength


async def try_auto_verify(db: AsyncSession, user: User) -> bool:
    """Verify from an imported record once the applicant has proven the email/mobile held on that record."""
    profile = await db.get(AlumniProfile, user.id)
    if not profile or profile.verification_status == "verified":
        return False
    cfg = await settings(db)
    await refresh_match(db, user, profile)
    if cfg.record_match_action != "verify" or profile.match_strength != "strong":
        return False
    rec = await db.get(StudentRecord, profile.matched_record_id)
    if not rec or not _contact_proven(rec, user):
        return False
    await approve(
        db,
        user,
        profile,
        method="record_match",
        actor_id=None,
        record=rec,
        note="Matched institutional record and verified contact details.",
    )
    return True


# ── verification state changes ──────────────────────────────────────────────
async def log(db: AsyncSession, user_id, action: str, method: str | None = None, note: str | None = None, actor_id=None):
    db.add(VerificationEvent(user_id=user_id, action=action, method=method, note=(note or None) and note[:500], actor_id=actor_id))


async def _roles_by_key(db: AsyncSession, keys: set[str]) -> dict[str, Role]:
    return {r.key: r for r in (await db.execute(select(Role).where(Role.key.in_(keys)))).scalars()}


async def set_member_role(db: AsyncSession, user: User, kind: str, verified: bool) -> None:
    """Swap the member role (unverified ↔ verified alumni / student); other roles are left alone."""
    want = VERIFIED_ROLE.get(kind, "verified_alumni") if verified else UNVERIFIED_ROLE
    roles = await _roles_by_key(db, MEMBER_ROLES)
    keep = [r for r in user.roles if r.key not in MEMBER_ROLES]
    user.roles = keep + ([roles[want]] if want in roles else [])
    forget_principals(user.id)


async def approve(
    db: AsyncSession,
    user: User,
    profile: AlumniProfile,
    *,
    method: str,
    actor_id,
    record: StudentRecord | None = None,
    note: str | None = None,
    notify: bool = True,
) -> None:
    if profile.reg_norm:
        dup = (
            await db.execute(
                select(User.full_name)
                .join(AlumniProfile, AlumniProfile.user_id == User.id)
                .where(
                    AlumniProfile.reg_norm == profile.reg_norm,
                    AlumniProfile.verification_status == "verified",
                    AlumniProfile.user_id != user.id,
                    User.deleted_at.is_(None),
                )
            )
        ).first()
        if dup:
            raise AppError(
                409,
                "DUPLICATE_REGISTRATION_NO",
                f"Registration number {profile.registration_no} already belongs to verified member {dup[0]}.",
            )
    profile.verification_status, profile.verification_method = "verified", method
    profile.verified_at, profile.verified_by, profile.rejection_reason = now(), actor_id, None
    if record:
        record.matched_user_id = user.id
        profile.matched_record_id = record.id
        if not profile.batch_id and record.batch_id:
            profile.batch_id = record.batch_id
    await set_member_role(db, user, profile.kind, True)
    await log(db, user.id, "approved", method, note, actor_id)
    if notify:
        general = await settings_store.get_group(db, "general")
        from ...services import notifications

        await notifications.notify(
            db,
            user.id,
            "verification",
            "verified",
            "Your profile is verified",
            link="/portal",
            body="Welcome to the alumni community.",
            email=("alumni.verified", {"link": f"{general.app_url}/portal"}),
        )
    await refresh_search(db, user.id)


async def reject(db: AsyncSession, user: User, profile: AlumniProfile, *, reason: str, actor_id, revoke: bool = False):
    profile.verification_status, profile.verification_method = "rejected", None
    profile.verified_at = profile.verified_by = None
    profile.rejection_reason = reason[:500]
    if profile.matched_record_id:
        rec = await db.get(StudentRecord, profile.matched_record_id)
        if rec and rec.matched_user_id == user.id:
            rec.matched_user_id = None
    await set_member_role(db, user, profile.kind, False)
    await log(db, user.id, "revoked" if revoke else "rejected", None, reason, actor_id)
    general = await settings_store.get_group(db, "general")
    from ...services import notifications

    await notifications.notify(
        db,
        user.id,
        "verification",
        "rejected",
        "Your verification needs attention",
        body=reason,
        link="/portal/profile/verification",
        email=("alumni.rejected", {"reason": reason, "link": f"{general.app_url}/portal/profile/verification"}),
    )
    await refresh_search(db, user.id)


# ── privacy ─────────────────────────────────────────────────────────────────
def privacy_of(profile: AlumniProfile) -> dict[str, str]:
    stored = profile.privacy or {}
    defaults = {k: ("only_me" if k in ("email", "phone", "birthday") else "members") for k in PRIVACY_SECTIONS}
    return {k: stored.get(k, defaults[k]) if stored.get(k, defaults[k]) in LEVELS else defaults[k] for k in PRIVACY_SECTIONS}


def default_privacy(cfg: AlumniSettings) -> dict[str, str]:
    contact = cfg.default_contact_visibility
    return {k: (contact if k in ("email", "phone") else "only_me" if k == "birthday" else "members") for k in PRIVACY_SECTIONS}


class Viewer:
    """Who is looking: decides which sections of a profile are shown."""

    def __init__(self, p: Principal, connected: set[uuid.UUID] | None = None):
        self.p = p
        self.staff = p.can("alumni.view")
        self.connected = connected or set()

    def can_see_profile(self, profile: AlumniProfile) -> bool:
        if self.staff or profile.user_id == self.p.id:
            return True
        if profile.visibility == "hidden":
            return False
        return profile.visibility == "members" or profile.user_id in self.connected

    def sees(self, profile: AlumniProfile, section: str) -> bool:
        if self.staff or profile.user_id == self.p.id:
            return True
        level = privacy_of(profile)[section]
        return level == "members" or (level == "connections" and profile.user_id in self.connected)


async def connected_ids(db: AsyncSession, user_id: uuid.UUID, among: list[uuid.UUID] | None = None) -> set[uuid.UUID]:
    stmt = select(AlumniConnection.requester_id, AlumniConnection.addressee_id).where(
        AlumniConnection.status == "accepted", or_(AlumniConnection.requester_id == user_id, AlumniConnection.addressee_id == user_id)
    )
    if among is not None:
        if not among:
            return set()
        stmt = stmt.where(or_(AlumniConnection.requester_id.in_(among), AlumniConnection.addressee_id.in_(among)))
    rows = (await db.execute(stmt)).all()
    return {b if a == user_id else a for a, b in rows}


async def relations(db: AsyncSession, me: uuid.UUID, ids: list[uuid.UUID]) -> dict[uuid.UUID, dict]:
    """Connection state and follow flag of the viewer towards each listed member."""
    out = {i: {"connection": None, "connection_id": None, "following": False} for i in ids}
    if not ids:
        return out
    rows = (
        await db.execute(
            select(AlumniConnection).where(
                or_(
                    (AlumniConnection.requester_id == me) & AlumniConnection.addressee_id.in_(ids),
                    (AlumniConnection.addressee_id == me) & AlumniConnection.requester_id.in_(ids),
                )
            )
        )
    ).scalars()
    for c in rows:
        other = c.addressee_id if c.requester_id == me else c.requester_id
        state = c.status if c.status != "pending" else ("sent" if c.requester_id == me else "received")
        if c.status == "declined":
            state = "sent" if c.requester_id == me else None  # a declined request looks pending to the sender only
        out[other].update(connection=state, connection_id=str(c.id) if state else None)
    for (fid,) in (
        await db.execute(select(AlumniFollow.followee_id).where(AlumniFollow.follower_id == me, AlumniFollow.followee_id.in_(ids)))
    ).all():
        out[fid]["following"] = True
    mutual = await mutual_connections(db, me, ids)
    online = await online_connections(db, me, ids, out)
    faces_ids = {x for v in mutual.values() for x in v[:3]}
    faces = {}
    if faces_ids:
        for u, pr in (
            await db.execute(
                select(User, AlumniProfile).join(AlumniProfile, AlumniProfile.user_id == User.id).where(User.id.in_(faces_ids))
            )
        ).all():
            faces[u.id] = {"id": str(u.id), "full_name": u.full_name, "photo": await photo_out(db, pr.photo_id)}
    from ...services import member_settings

    prefs = await member_settings.get_many(db, ids)
    for i in ids:
        show_mutual = prefs.get(i, member_settings.DEFAULTS)["show_mutual"]
        out[i]["mutual"] = len(mutual.get(i, [])) if show_mutual else 0
        out[i]["mutual_ids"] = [str(x) for x in mutual.get(i, [])[:3]] if show_mutual else []
        out[i]["mutual_people"] = [faces[x] for x in mutual.get(i, [])[:3] if x in faces] if show_mutual else []
        out[i]["online"] = online.get(i, False) and prefs.get(i, member_settings.DEFAULTS)["show_online"]
    return out


async def mutual_connections(db: AsyncSession, me: uuid.UUID, ids: list[uuid.UUID]) -> dict[uuid.UUID, list[uuid.UUID]]:
    """For each member, the viewer's connections they are also connected to."""
    mine = await connected_ids(db, me)
    if not mine or not ids:
        return {}
    C = AlumniConnection
    rows = (
        await db.execute(
            select(C.requester_id, C.addressee_id).where(
                C.status == "accepted",
                or_(and_(C.requester_id.in_(ids), C.addressee_id.in_(mine)), and_(C.addressee_id.in_(ids), C.requester_id.in_(mine))),
            )
        )
    ).all()
    out: dict = {}
    idset = set(ids)
    for a, b in rows:
        person, common = (a, b) if a in idset and b in mine else (b, a)
        if person != me:
            out.setdefault(person, []).append(common)
    return out


async def online_connections(db: AsyncSession, me: uuid.UUID, ids: list[uuid.UUID], rel: dict) -> dict[uuid.UUID, bool]:
    """Presence is shown for connections only (members choose more in Settings)."""
    from ..messaging.service import online_many

    targets = [i for i in ids if rel.get(i, {}).get("connection") == "accepted"]
    if not targets:
        return {}
    try:
        return await online_many(targets)
    except Exception:
        return {}


# ── completion and search ───────────────────────────────────────────────────
COMPLETION = [
    # key, weight, label, profile tab
    ("photo", 15, "Add a profile photo", "personal"),
    ("bio", 10, "Write a short biography", "personal"),
    ("location", 10, "Add your city and country", "personal"),
    ("school", 10, "Add your graduation year and batch", "personal"),
    ("position", 10, "Add your current designation and organisation", "professional"),
    ("industry", 5, "Choose your industry", "professional"),
    ("skills", 10, "List at least three skills", "professional"),
    ("experience", 10, "Add your work experience", "experience"),
    ("education", 10, "Add your higher education", "education"),
    ("links", 5, "Add your LinkedIn or website", "professional"),
    ("phone", 5, "Verify your mobile number", "account"),
]


async def completion(db: AsyncSession, user: User, profile: AlumniProfile) -> tuple[int, list[dict]]:
    uid = user.id
    n_skills = (await db.execute(select(func.count()).select_from(AlumniSkill).where(AlumniSkill.user_id == uid))).scalar_one()
    n_emp = (await db.execute(select(func.count()).select_from(AlumniEmployment).where(AlumniEmployment.user_id == uid))).scalar_one()
    n_edu = (
        await db.execute(
            select(func.count()).select_from(AlumniEducation).where(AlumniEducation.user_id == uid, AlumniEducation.is_sst.is_(False))
        )
    ).scalar_one()
    done = {
        "photo": bool(profile.photo_id),
        "bio": bool(profile.bio and len(profile.bio.strip()) >= 30),
        "location": bool(profile.city and profile.country),
        "school": bool(profile.graduation_year and profile.batch_id),
        "position": bool(profile.designation and profile.organization),
        "industry": bool(profile.industry),
        "skills": n_skills >= 3,
        "experience": n_emp > 0,
        "education": n_edu > 0,
        "links": bool(profile.linkedin or profile.website),
        "phone": bool(user.phone_verified_at),
    }
    score = sum(w for k, w, *_ in COMPLETION if done[k])
    missing = [{"key": k, "label": label, "tab": tab, "weight": w} for k, w, label, tab in COMPLETION if not done[k]]
    return score, missing


async def refresh_search(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Rebuild the directory search document and completion score (only member-visible fields are indexed)."""
    await db.flush()
    profile = await db.get(AlumniProfile, user_id)
    user = await db.get(User, user_id)
    if not profile or not user:
        return
    priv = privacy_of(profile)
    parts = [user.full_name, profile.class_name, str(profile.graduation_year or "")]
    if profile.batch_id and (b := await db.get(Batch, profile.batch_id)):
        parts.append(b.name)
    if priv["career"] == "members":
        parts += [profile.designation, profile.organization, profile.industry]
        parts += (await db.execute(select(AlumniSkill.name).where(AlumniSkill.user_id == user_id))).scalars().all()
    if priv["location"] == "members":
        parts += [profile.city, profile.country]
    doc = " ".join(p for p in parts if p)
    score, _ = await completion(db, user, profile)
    await db.execute(
        update(AlumniProfile).where(AlumniProfile.user_id == user_id).values(search=func.to_tsvector("simple", doc), completion=score)
    )
    await db.refresh(profile, ["search", "completion"])


def tsquery(q: str) -> str | None:
    """Prefix query from free text: 'asad sof' → 'asad:* & sof:*'."""
    terms = [t for t in re.split(r"[^\w]+", q.casefold()) if t][:8]
    return " & ".join(f"{t}:*" for t in terms) or None


# ── serialisation ───────────────────────────────────────────────────────────
async def photo_out(db: AsyncSession, photo_id) -> dict | None:
    if not photo_id:
        return None
    m = await db.get(Media, photo_id)
    if not m or m.deleted_at:
        return None
    pub = await media.to_public(db, m)
    return {"url": pub["url"], "variants": pub["variants"]} if pub else None


async def batch_names(db: AsyncSession, ids: set) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {b.id: b.name for b in (await db.execute(select(Batch).where(Batch.id.in_(ids)))).scalars()}


def card(user: User, profile: AlumniProfile, viewer: Viewer, batch: str | None, photo: dict | None, rel: dict | None) -> dict:
    """Directory card: always name, photo, batch and badge; other fields per privacy."""
    career = viewer.sees(profile, "career")
    location = viewer.sees(profile, "location")
    return {
        "id": str(user.id),
        "full_name": user.full_name,
        "photo": photo,
        "kind": profile.kind,
        "verified": profile.verification_status == "verified",
        "graduation_year": profile.graduation_year,
        "batch": batch,
        "designation": profile.designation if career else None,
        "organization": profile.organization if career else None,
        "industry": profile.industry if career else None,
        "city": profile.city if location else None,
        "country": profile.country if location else None,
        **(rel or {}),
    }


async def detail(db: AsyncSession, user: User, profile: AlumniProfile, viewer: Viewer) -> dict:
    uid = user.id
    names = await batch_names(db, {profile.batch_id})
    photo = await photo_out(db, profile.photo_id)
    rel = (await relations(db, viewer.p.id, [uid]))[uid] if uid != viewer.p.id else None
    out = card(user, profile, viewer, names.get(profile.batch_id), photo, rel)
    sees = {k: viewer.sees(profile, k) for k in PRIVACY_SECTIONS}
    followers = (await db.execute(select(func.count()).select_from(AlumniFollow).where(AlumniFollow.followee_id == uid))).scalar_one()
    connections = len(await connected_ids(db, uid))
    out.update(
        {
            "bio": profile.bio,
            "admission_year": profile.admission_year,
            "class_name": profile.class_name,
            "email": user.email if sees["email"] else None,
            "phone": user.phone if sees["phone"] else None,
            "date_of_birth": profile.date_of_birth.isoformat() if sees["birthday"] and profile.date_of_birth else None,
            "website": profile.website if sees["links"] else None,
            "linkedin": profile.linkedin if sees["links"] else None,
            "verified_at": profile.verified_at,
            "followers": followers,
            "connections": connections,
            "member_since": user.created_at,
            "cover": await photo_out(db, profile.cover_id),
            "following_count": (
                await db.execute(select(func.count()).select_from(AlumniFollow).where(AlumniFollow.follower_id == uid))
            ).scalar_one(),
            "is_self": uid == viewer.p.id,
        }
    )
    skills = (await db.execute(select(AlumniSkill.name).where(AlumniSkill.user_id == uid).order_by(AlumniSkill.position))).scalars().all()
    out["skills"] = list(skills) if sees["career"] else []
    emp = (
        (
            await db.execute(
                select(AlumniEmployment)
                .where(AlumniEmployment.user_id == uid)
                .order_by(AlumniEmployment.is_current.desc(), AlumniEmployment.start_date.desc().nulls_last())
            )
        )
        .scalars()
        .all()
    )
    out["employment"] = [employment_out(e) for e in emp] if sees["career"] else []
    edu = (
        (
            await db.execute(
                select(AlumniEducation)
                .where(AlumniEducation.user_id == uid)
                .order_by(AlumniEducation.is_sst.desc(), AlumniEducation.end_year.desc().nulls_first())
            )
        )
        .scalars()
        .all()
    )
    # SST academic history is part of every visible profile; higher education follows the privacy choice.
    out["education"] = [education_out(e) for e in edu if e.is_sst or sees["education"]]
    ach = (
        (
            await db.execute(
                select(AlumniAchievement).where(AlumniAchievement.user_id == uid).order_by(AlumniAchievement.year.desc().nulls_last())
            )
        )
        .scalars()
        .all()
    )
    out["achievements"] = [achievement_out(a) for a in ach] if sees["achievements"] else []
    level = "owner" if viewer.staff or uid == viewer.p.id else "connection" if uid in viewer.connected else "member"
    out["extra_fields"] = await custom_fields.visible_for(db, "alumni_profile", profile.custom_fields, level)
    return out


def education_out(e: AlumniEducation) -> dict:
    return {
        "id": str(e.id),
        "institution": e.institution,
        "qualification": e.qualification,
        "field_of_study": e.field_of_study,
        "start_year": e.start_year,
        "end_year": e.end_year,
        "is_sst": e.is_sst,
        "description": e.description,
    }


def employment_out(e: AlumniEmployment) -> dict:
    return {
        "id": str(e.id),
        "organization": e.organization,
        "designation": e.designation,
        "industry": e.industry,
        "location": e.location,
        "start_date": e.start_date,
        "end_date": e.end_date,
        "is_current": e.is_current,
        "description": e.description,
    }


def achievement_out(a: AlumniAchievement) -> dict:
    return {
        "id": str(a.id),
        "kind": a.kind,
        "title": a.title,
        "issuer": a.issuer,
        "year": a.year,
        "url": a.url,
        "description": a.description,
    }


async def ensure_profile(db: AsyncSession, user: User) -> AlumniProfile:
    """Profiles exist for registered members; staff accounts get one the first time they open the portal."""
    profile = await db.get(AlumniProfile, user.id)
    if profile:
        return profile
    cfg = await settings(db)
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    # concurrent first requests must not both insert
    await db.execute(
        pg_insert(AlumniProfile)
        .values(
            user_id=user.id,
            kind="alumni",
            visibility=cfg.default_profile_visibility,
            privacy=default_privacy(cfg),
            verification_status="pending",
            evidence_ids=[],
            completion=0,
        )
        .on_conflict_do_nothing(index_elements=["user_id"])
    )
    profile = await db.get(AlumniProfile, user.id, populate_existing=True)
    await refresh_search(db, user.id)
    return profile


async def directory_visible_clause(db: AsyncSession):
    from ...services import member_settings

    cfg = await settings(db)
    # members who hide themselves from the directory also drop out of search and suggestions
    clauses = [User.deleted_at.is_(None), User.status == "active", User.id.not_in(member_settings.opted_out("show_in_directory"))]
    if not cfg.directory_include_unverified:
        clauses.append(AlumniProfile.verification_status == "verified")
    return clauses


def lock_identity_fields(profile: AlumniProfile) -> set[str]:
    """After verification, school identity fields are changed by administrators only."""
    return (
        {"admission_year", "graduation_year", "registration_no", "batch_id", "kind"} if profile.verification_status == "verified" else set()
    )


async def pending_count(db: AsyncSession) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(AlumniProfile)
            .join(User, User.id == AlumniProfile.user_id)
            .where(AlumniProfile.verification_status == "pending", User.deleted_at.is_(None), User.status != "deactivated")
        )
    ).scalar_one()
