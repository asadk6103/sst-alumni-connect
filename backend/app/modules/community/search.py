"""Global search (top bar): alumni, posts, communities and events the member is allowed to see."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.db import get_db
from ...core.deps import Principal, require
from ...models import AlumniProfile, DiscussionGroup, Event, Post, User
from ..alumni import service as alumni
from ..events.service import image
from . import service as svc

router = APIRouter(prefix="/api/v1/search", tags=["Search"])


@router.get("", summary="Search alumni, posts, communities and events")
async def search(
    q: str = Query(..., min_length=2, max_length=100),
    limit: int = Query(5, ge=1, le=20),
    me: Principal = Depends(require("portal.access")),
    db: AsyncSession = Depends(get_db),
):
    mods = await settings_store.modules(db)
    like = f"%{q.strip().lower()}%"
    out: dict = {"alumni": [], "posts": [], "communities": [], "events": []}

    # alumni — same visibility rules as the directory (search document holds only member-visible fields)
    if me.can("portal.directory") and mods.get("directory", True) and (tq := alumni.tsquery(q)):
        connected = await alumni.connected_ids(db, me.id)
        stmt = (
            select(User, AlumniProfile)
            .join(AlumniProfile, AlumniProfile.user_id == User.id)
            .where(
                *await alumni.directory_visible_clause(db),
                AlumniProfile.user_id != me.id,
                AlumniProfile.search.op("@@")(func.to_tsquery("simple", tq)),
            )
        )
        if not me.can("alumni.view"):
            stmt = stmt.where(
                or_(
                    AlumniProfile.visibility == "members",
                    and_(AlumniProfile.visibility == "connections", AlumniProfile.user_id.in_(connected or [uuid.UUID(int=0)])),
                )
            )
        rows = (
            await db.execute(stmt.order_by(func.ts_rank(AlumniProfile.search, func.to_tsquery("simple", tq)).desc()).limit(limit))
        ).all()
        viewer = alumni.Viewer(me, connected)
        names = await alumni.batch_names(db, {pr.batch_id for _, pr in rows})
        out["alumni"] = [
            alumni.card(u, pr, viewer, names.get(pr.batch_id), await alumni.photo_out(db, pr.photo_id), None) for u, pr in rows
        ]

    # posts in the member's feed scope
    if me.can("portal.react") and mods.get("community", True):
        stmt = (
            select(Post)
            .where(
                Post.status == "published",
                svc.feed_scope(me, await svc.member_group_ids(db, me.id)),
                or_(func.lower(Post.body).like(like), func.lower(Post.title).like(like)),
            )
            .order_by(Post.created_at.desc())
            .limit(limit)
        )
        posts = list((await db.execute(stmt)).scalars())
        people = await svc.authors(db, {x.author_id for x in posts})
        out["posts"] = [
            {
                "id": str(x.id),
                "kind": x.kind,
                "title": x.title,
                "excerpt": (x.body or "")[:160],
                "author": people.get(x.author_id),
                "created_at": x.created_at,
            }
            for x in posts
        ]

        groups = (
            (
                await db.execute(
                    select(DiscussionGroup)
                    .where(DiscussionGroup.status == "active", func.lower(DiscussionGroup.name).like(like))
                    .order_by(DiscussionGroup.member_count.desc())
                    .limit(limit)
                )
            )
            .scalars()
            .all()
        )
        out["communities"] = [{"id": str(g.id), "name": g.name, "kind": g.kind, "member_count": g.member_count} for g in groups]

    # published events (batch-only events only for that batch)
    if mods.get("events", True):
        prof = await db.get(AlumniProfile, me.id)
        stmt = (
            select(Event)
            .where(
                Event.status == "published",
                func.lower(Event.title).like(like),
                or_(Event.batch_id.is_(None), Event.batch_id == (prof.batch_id if prof else None)),
            )
            .order_by(Event.starts_at.desc())
            .limit(limit)
        )
        out["events"] = [
            {
                "id": str(e.id),
                "title": e.title,
                "starts_at": e.starts_at,
                "venue": e.venue,
                "is_online": e.is_online,
                "banner": await image(db, e.banner_id),
            }
            for e in (await db.execute(stmt)).scalars()
        ]
    return {"data": out}
