"""Community domain logic: groups (incl. automatic batch communities), visibility, serialisation, cursors."""

import base64
import uuid
from datetime import datetime

from sqlalchemy import func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.deps import Principal
from ...core.errors import AppError, forbidden, not_found
from ...models import AlumniProfile, Batch, Comment, DiscussionGroup, GroupMember, Media, Post, PostMedia, Reaction, User
from ...services import media, rooms
from ..alumni import service as alumni

REACTIONS = ("like", "love", "celebrate", "support", "insightful")


# ── cursors ─────────────────────────────────────────────────────────────────
def encode_cursor(ts: datetime, ident: uuid.UUID) -> str:
    return base64.urlsafe_b64encode(f"{ts.isoformat()}|{ident}".encode()).decode().rstrip("=")


def decode_cursor(cursor: str | None) -> tuple[datetime, uuid.UUID] | None:
    if not cursor:
        return None
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        ts, ident = raw.split("|")
        return datetime.fromisoformat(ts), uuid.UUID(ident)
    except Exception as e:
        raise AppError(400, "INVALID_CURSOR", "The page cursor is not valid.") from e


# ── groups ──────────────────────────────────────────────────────────────────
async def ensure_batch_group(db: AsyncSession, user_id: uuid.UUID) -> DiscussionGroup | None:
    """Verified members belong to their batch's community automatically."""
    prof = await db.get(AlumniProfile, user_id)
    if not prof or not prof.batch_id or prof.verification_status != "verified":
        return None
    # Idempotent under concurrency (several requests of a member can arrive at once): INSERT … ON CONFLICT.
    g = (await db.execute(select(DiscussionGroup).where(DiscussionGroup.batch_id == prof.batch_id))).scalar_one_or_none()
    if not g:
        b = await db.get(Batch, prof.batch_id)
        await db.execute(
            pg_insert(DiscussionGroup)
            .values(id=uuid.uuid4(), name=f"{b.name} community", description=f"Private community of {b.name}.", kind="batch",
                    batch_id=b.id, join_policy="approval", status="active", member_count=0, post_count=0)
            .on_conflict_do_nothing(index_elements=["batch_id"])
        )
        g = (await db.execute(select(DiscussionGroup).where(DiscussionGroup.batch_id == prof.batch_id))).scalar_one()
    added = await db.execute(
        pg_insert(GroupMember)
        .values(group_id=g.id, user_id=user_id, role="member", status="active")
        .on_conflict_do_nothing(index_elements=["group_id", "user_id"])
    )
    if added.rowcount:
        await db.execute(update(DiscussionGroup).where(DiscussionGroup.id == g.id).values(member_count=DiscussionGroup.member_count + 1))
    else:
        await db.execute(update(GroupMember).where(GroupMember.group_id == g.id, GroupMember.user_id == user_id,
                                                   GroupMember.status == "pending").values(status="active"))
    return g


async def member_group_ids(db: AsyncSession, user_id: uuid.UUID) -> list[uuid.UUID]:
    return list(
        (
            await db.execute(
                select(GroupMember.group_id)
                .join(DiscussionGroup, DiscussionGroup.id == GroupMember.group_id)
                .where(GroupMember.user_id == user_id, GroupMember.status == "active", DiscussionGroup.status == "active")
            )
        ).scalars()
    )


async def membership(db: AsyncSession, group_id: uuid.UUID, user_id: uuid.UUID) -> GroupMember | None:
    m = await db.get(GroupMember, (group_id, user_id))
    return m if m and m.status == "active" else None


async def group_or_404(db: AsyncSession, group_id: uuid.UUID) -> DiscussionGroup:
    g = await db.get(DiscussionGroup, group_id)
    if not g:
        raise not_found("Group")
    return g


async def can_manage_group(db: AsyncSession, p: Principal, g: DiscussionGroup) -> bool:
    if p.can("community.edit"):
        return True
    m = await membership(db, g.id, p.id)
    return bool(m and m.role in ("owner", "moderator"))


# ── posts ───────────────────────────────────────────────────────────────────
async def readable_post(db: AsyncSession, p: Principal, post: Post | None) -> Post:
    if not post or post.status == "deleted":
        raise not_found("Post")
    staff = p.can("community.view")
    if post.status == "hidden" and not (staff or post.author_id == p.id):
        raise not_found("Post")
    if post.group_id:
        g = await db.get(DiscussionGroup, post.group_id)
        if not g or not await rooms.can_read_group(db, p, g):
            raise not_found("Post")
    elif not (staff or p.can("portal.react")):
        raise forbidden()
    return post


def room_of(post: Post) -> str:
    return f"group:{post.group_id}" if post.group_id else "feed:all"


async def authors(db: AsyncSession, ids: set) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = (
        await db.execute(select(User, AlumniProfile).outerjoin(AlumniProfile, AlumniProfile.user_id == User.id).where(User.id.in_(ids)))
    ).all()
    names = await alumni.batch_names(db, {pr.batch_id for _, pr in rows if pr})
    out = {}
    for u, pr in rows:
        staff = any(r.is_staff for r in u.roles)
        out[u.id] = {
            "id": str(u.id),
            "full_name": u.full_name if not u.deleted_at else "Former member",
            "photo": await alumni.photo_out(db, pr.photo_id) if pr else None,
            "verified": bool(pr and pr.verification_status == "verified"),
            # career details only when the member shows them to all members
            "headline": pr.designation if pr and alumni.privacy_of(pr)["career"] == "members" else None,
            "batch": names.get(pr.batch_id) if pr else None,
            "staff": staff,
        }
    return out


async def media_for(db: AsyncSession, post_ids: list[uuid.UUID]) -> dict:
    if not post_ids:
        return {}
    rows = (
        await db.execute(
            select(PostMedia.post_id, Media)
            .join(Media, Media.id == PostMedia.media_id)
            .where(PostMedia.post_id.in_(post_ids), Media.deleted_at.is_(None))
            .order_by(PostMedia.position)
        )
    ).all()
    out: dict = {}
    for pid, m in rows:
        pub = await media.to_public(db, m)
        out.setdefault(pid, []).append(
            {"id": str(m.id), "url": pub["url"], "variants": pub["variants"], "width": m.width, "height": m.height, "alt": m.alt}
        )
    return out


async def reaction_summary(db: AsyncSession, post_ids: list[uuid.UUID], me: uuid.UUID) -> tuple[dict, dict]:
    if not post_ids:
        return {}, {}
    counts: dict = {}
    for pid, kind, n in (
        await db.execute(
            select(Reaction.post_id, Reaction.kind, func.count())
            .where(Reaction.post_id.in_(post_ids))
            .group_by(Reaction.post_id, Reaction.kind)
        )
    ).all():
        counts.setdefault(pid, {})[kind] = n
    mine = dict(
        (await db.execute(select(Reaction.post_id, Reaction.kind).where(Reaction.post_id.in_(post_ids), Reaction.user_id == me))).all()
    )
    return counts, mine


async def serialize(db: AsyncSession, p: Principal, posts: list[Post], with_shared: bool = True) -> list[dict]:
    if not posts:
        return []
    ids = [x.id for x in posts]
    shared_ids = {x.shared_post_id for x in posts if x.shared_post_id}
    shared = {}
    if with_shared and shared_ids:
        rows = (await db.execute(select(Post).where(Post.id.in_(shared_ids)))).scalars().all()
        visible = []
        for s in rows:
            try:
                visible.append(await readable_post(db, p, s))
            except AppError:
                pass
        shared = {d["id"]: d for d in await serialize(db, p, [s for s in visible if s.status == "published"], with_shared=False)}
    people = await authors(db, {x.author_id for x in posts})
    files = await media_for(db, ids)
    counts, mine = await reaction_summary(db, ids, p.id)
    groups = {}
    if gids := {x.group_id for x in posts if x.group_id}:
        groups = {
            g.id: {"id": str(g.id), "name": g.name, "kind": g.kind}
            for g in (await db.execute(select(DiscussionGroup).where(DiscussionGroup.id.in_(gids)))).scalars()
        }
    moderator = p.can("community.edit")
    out = []
    for x in posts:
        out.append(
            {
                "id": str(x.id),
                "kind": x.kind,
                "title": x.title,
                "body": x.body,
                "status": x.status,
                "moderation_reason": x.moderation_reason if (x.author_id == p.id or moderator) else None,
                "author": people.get(x.author_id),
                "group": groups.get(x.group_id),
                "media": files.get(x.id, []),
                "shared_post": shared.get(str(x.shared_post_id)) if x.shared_post_id else None,
                "shared_unavailable": bool(x.shared_post_id and str(x.shared_post_id) not in shared and with_shared),
                "is_pinned": x.is_pinned,
                "comment_count": x.comment_count,
                "reaction_count": x.reaction_count,
                "share_count": x.share_count,
                "reactions": counts.get(x.id, {}),
                "my_reaction": mine.get(x.id),
                "created_at": x.created_at,
                "edited_at": x.edited_at,
                "can_edit": x.author_id == p.id,
                "can_delete": x.author_id == p.id or moderator,
            }
        )
    return out


async def comments_out(db: AsyncSession, p: Principal, rows: list[Comment]) -> list[dict]:
    people = await authors(db, {c.author_id for c in rows})
    moderator = p.can("community.edit")
    return [
        {
            "id": str(c.id),
            "post_id": str(c.post_id),
            "parent_id": str(c.parent_id) if c.parent_id else None,
            "body": c.body if c.status == "published" else "",
            "status": c.status,
            "author": people.get(c.author_id),
            "created_at": c.created_at,
            "edited_at": c.edited_at,
            "can_edit": c.author_id == p.id and c.status == "published",
            "can_delete": (c.author_id == p.id or moderator) and c.status != "deleted",
        }
        for c in rows
    ]


async def group_out(db: AsyncSession, p: Principal, g: DiscussionGroup, my: GroupMember | None | bool = False) -> dict:
    if my is False:
        my = await db.get(GroupMember, (g.id, p.id))
    cover = None
    if g.cover_id and (m := await db.get(Media, g.cover_id)) and not m.deleted_at:
        pub = await media.to_public(db, m)
        cover = {"url": pub["url"], "variants": pub["variants"]}
    return {
        "id": str(g.id),
        "name": g.name,
        "description": g.description,
        "kind": g.kind,
        "join_policy": g.join_policy,
        "status": g.status,
        "member_count": g.member_count,
        "post_count": g.post_count,
        "last_post_at": g.last_post_at,
        "cover": cover,
        "batch_id": str(g.batch_id) if g.batch_id else None,
        "membership": {"role": my.role, "status": my.status} if my else None,
        "can_manage": await can_manage_group(db, p, g),
        "created_at": g.created_at,
    }


def feed_scope(p: Principal, group_ids: list[uuid.UUID]):
    """Main feed = posts outside groups + posts in the member's groups."""
    return or_(Post.group_id.is_(None), Post.group_id.in_(group_ids or [uuid.UUID(int=0)]))
