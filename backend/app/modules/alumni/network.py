"""Network screens: summary and tab counts, people you may know, profile cover, profile overview and activity."""

import uuid

from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.deps import Principal, require
from ...core.redis import enforce
from ...models import AlumniConnection, AlumniFollow, AlumniProfile, Comment, DiscussionGroup, GroupMember, Media, Post, PostMedia, User
from ...services import media
from . import service as svc
from .dashboard import suggestions as suggest
from .portal import _me, _target, directory

router = APIRouter(prefix="/api/v1/alumni", tags=["Alumni portal"])


def _visible_members(stmt):
    return stmt.where(AlumniProfile.visibility != "hidden")


@router.get(
    "/network/summary", summary="Your network at a glance (tabs, insights, batches, common groups)", dependencies=[Depends(directory)]
)
async def summary(me: Principal = Depends(require("portal.directory")), db: AsyncSession = Depends(get_db)):
    mine = await db.get(AlumniProfile, me.id)
    connected = await svc.connected_ids(db, me.id)
    base = (
        select(func.count())
        .select_from(AlumniProfile)
        .join(User, User.id == AlumniProfile.user_id)
        .where(*await svc.directory_visible_clause(db), AlumniProfile.visibility != "hidden", AlumniProfile.user_id != me.id)
    )
    loc_pub = func.coalesce(AlumniProfile.privacy["location"].astext, "members") == "members"
    car_pub = func.coalesce(AlumniProfile.privacy["career"].astext, "members") == "members"
    tabs = {"all": (await db.execute(base)).scalar_one()}
    tabs["same_batch"] = (
        (await db.execute(base.where(AlumniProfile.graduation_year == mine.graduation_year))).scalar_one()
        if mine and mine.graduation_year
        else 0
    )
    tabs["same_city"] = (
        (await db.execute(base.where(func.lower(AlumniProfile.city) == (mine.city or "").lower(), loc_pub))).scalar_one()
        if mine and mine.city
        else 0
    )
    tabs["same_industry"] = (
        (await db.execute(base.where(AlumniProfile.industry == mine.industry, car_pub))).scalar_one() if mine and mine.industry else 0
    )
    sugg = await suggest(db, me, mine, limit=50) if mine else []
    tabs["suggestions"] = len(sugg)
    C = AlumniConnection
    received = (await db.execute(select(func.count()).select_from(C).where(C.addressee_id == me.id, C.status == "pending"))).scalar_one()
    sent = (await db.execute(select(func.count()).select_from(C).where(C.requester_id == me.id, C.status == "pending"))).scalar_one()
    # connections who share at least one other connection with you
    mutual = await svc.mutual_connections(db, me.id, list(connected))
    batches = (
        await db.execute(
            select(func.count(func.distinct(AlumniProfile.batch_id))).where(AlumniProfile.user_id.in_(connected or [uuid.UUID(int=0)]))
        )
    ).scalar_one()
    my_groups = select(GroupMember.group_id).where(GroupMember.user_id == me.id, GroupMember.status == "active")
    groups_common = (
        await db.execute(
            select(func.count(func.distinct(GroupMember.group_id))).where(
                GroupMember.group_id.in_(my_groups),
                GroupMember.user_id.in_(connected or [uuid.UUID(int=0)]),
                GroupMember.status == "active",
            )
        )
    ).scalar_one()
    followers = (await db.execute(select(func.count()).select_from(AlumniFollow).where(AlumniFollow.followee_id == me.id))).scalar_one()
    following = (await db.execute(select(func.count()).select_from(AlumniFollow).where(AlumniFollow.follower_id == me.id))).scalar_one()
    by_batch = (
        await db.execute(
            select(AlumniProfile.graduation_year, func.count())
            .join(User, User.id == AlumniProfile.user_id)
            .where(
                *await svc.directory_visible_clause(db), AlumniProfile.visibility != "hidden", AlumniProfile.graduation_year.is_not(None)
            )
            .group_by(AlumniProfile.graduation_year)
            .order_by(AlumniProfile.graduation_year.desc())
            .limit(8)
        )
    ).all()
    # groups your connections are in that you have not joined
    common = (
        (
            await db.execute(
                select(DiscussionGroup)
                .join(GroupMember, GroupMember.group_id == DiscussionGroup.id)
                .where(
                    GroupMember.user_id.in_(connected or [uuid.UUID(int=0)]),
                    GroupMember.status == "active",
                    DiscussionGroup.status == "active",
                    DiscussionGroup.id.not_in(my_groups),
                )
                .group_by(DiscussionGroup.id)
                .order_by(func.count().desc(), DiscussionGroup.member_count.desc())
                .limit(4)
            )
        )
        .scalars()
        .all()
    )
    if len(common) < 4:
        extra = (
            (
                await db.execute(
                    select(DiscussionGroup)
                    .where(
                        DiscussionGroup.status == "active",
                        DiscussionGroup.id.not_in(my_groups),
                        DiscussionGroup.id.not_in([g.id for g in common] or [uuid.UUID(int=0)]),
                    )
                    .order_by(DiscussionGroup.member_count.desc())
                    .limit(4 - len(common))
                )
            )
            .scalars()
            .all()
        )
        common = [*common, *extra]
    from ..community.service import group_out

    return {
        "data": {
            "me": {
                "graduation_year": mine.graduation_year if mine else None,
                "city": mine.city if mine else None,
                "industry": mine.industry if mine else None,
            },
            "tabs": tabs,
            "network": {
                "connections": len(connected),
                "mutual": sum(1 for v in mutual.values() if v),
                "batches": batches,
                "groups": groups_common,
                "followers": followers,
                "following": following,
                "received": received,
                "sent": sent,
                "suggestions": len(sugg),
            },
            "by_batch": [{"year": y, "count": n} for y, n in by_batch],
            "common_groups": [await group_out(db, me, g, None) for g in common],
        }
    }


@router.get("/suggestions", summary="People you may know", dependencies=[Depends(directory)])
async def people_you_may_know(
    limit: int = Query(24, ge=1, le=50), me: Principal = Depends(require("portal.directory")), db: AsyncSession = Depends(get_db)
):
    mine = await db.get(AlumniProfile, me.id)
    return {"data": await suggest(db, me, mine, limit=limit) if mine else []}


@router.post("/me/cover", summary="Upload your profile cover photo")
async def upload_cover(file: UploadFile = File(...), p: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    await enforce(f"cover:{p.id}", 20, 3600)
    user, profile = await _me(db, p)
    m = await media.upload(
        db,
        data=await file.read(),
        filename=file.filename or "cover",
        folder="covers",
        alt=f"{user.full_name} cover",
        images_only=True,
        actor=user.id,
    )
    if profile.cover_id and (old := await db.get(Media, profile.cover_id)):
        old.deleted_at = svc.now()
    profile.cover_id = m.id
    return {"data": await svc.photo_out(db, m.id)}


@router.delete("/me/cover", summary="Remove your cover photo")
async def delete_cover(p: Principal = Depends(require("portal.access")), db: AsyncSession = Depends(get_db)):
    _, profile = await _me(db, p)
    if profile.cover_id and (old := await db.get(Media, profile.cover_id)):
        old.deleted_at = svc.now()
    profile.cover_id = None
    return {"data": {"ok": True}}


def _post_scope(viewer: Principal, viewer_groups: list[uuid.UUID]):
    from ..community.service import feed_scope

    return and_(Post.status == "published", feed_scope(viewer, viewer_groups))


@router.get(
    "/profiles/{user_id}/overview", summary="Communities, photos and network preview of a profile", dependencies=[Depends(directory)]
)
async def overview(user_id: uuid.UUID, me: Principal = Depends(require("portal.directory")), db: AsyncSession = Depends(get_db)):
    user, profile, viewer = await _target(db, me, user_id)
    from ..community.service import member_group_ids

    my_groups = await member_group_ids(db, me.id)
    # communities: open groups, and private ones the viewer also belongs to
    rows = (
        (
            await db.execute(
                select(DiscussionGroup)
                .join(GroupMember, GroupMember.group_id == DiscussionGroup.id)
                .where(
                    GroupMember.user_id == user.id,
                    GroupMember.status == "active",
                    DiscussionGroup.status == "active",
                    or_(DiscussionGroup.join_policy == "open", DiscussionGroup.id.in_(my_groups or [uuid.UUID(int=0)])),
                )
                .order_by(DiscussionGroup.member_count.desc())
            )
        )
        .scalars()
        .all()
    )
    communities = [
        {"id": str(g.id), "name": g.name, "member_count": g.member_count, "cover": await svc.photo_out(db, g.cover_id)} for g in rows
    ]
    # photos & memories: images from their posts that the viewer can see
    photo_q = (
        select(PostMedia.media_id)
        .join(Post, Post.id == PostMedia.post_id)
        .join(Media, Media.id == PostMedia.media_id)
        .where(Post.author_id == user.id, _post_scope(me, my_groups), Media.mime.like("image/%"), Media.deleted_at.is_(None))
    )
    total_photos = (await db.execute(select(func.count()).select_from(photo_q.subquery()))).scalar_one()
    photo_ids = (await db.execute(photo_q.order_by(Post.created_at.desc()).limit(8))).scalars().all()
    photos = [x for x in [await svc.photo_out(db, i) for i in photo_ids] if x]
    # network preview (members see a person's connections only through the count + a few faces)
    conn = list(await svc.connected_ids(db, user.id))
    faces = (
        await db.execute(
            select(User, AlumniProfile)
            .join(AlumniProfile, AlumniProfile.user_id == User.id)
            .where(User.id.in_(conn[:50] or [uuid.UUID(int=0)]), User.deleted_at.is_(None), AlumniProfile.visibility != "hidden")
            .limit(6)
        )
    ).all()
    people = [{"id": str(u.id), "full_name": u.full_name, "photo": await svc.photo_out(db, pr.photo_id)} for u, pr in faces]
    posts = (
        await db.execute(select(func.count()).select_from(Post).where(Post.author_id == user.id, _post_scope(me, my_groups)))
    ).scalar_one()
    return {
        "data": {
            "communities": communities,
            "photos": photos,
            "photo_count": total_photos,
            "connections": people,
            "connection_count": len(conn),
            "post_count": posts,
        }
    }


@router.get("/profiles/{user_id}/activity", summary="Recent posts and comments of a member", dependencies=[Depends(directory)])
async def activity(
    user_id: uuid.UUID,
    limit: int = Query(20, ge=1, le=50),
    me: Principal = Depends(require("portal.directory")),
    db: AsyncSession = Depends(get_db),
):
    user, profile, viewer = await _target(db, me, user_id)
    from ..community.service import member_group_ids

    groups = await member_group_ids(db, me.id)
    posts = (
        (
            await db.execute(
                select(Post).where(Post.author_id == user.id, _post_scope(me, groups)).order_by(Post.created_at.desc()).limit(limit)
            )
        )
        .scalars()
        .all()
    )
    comments = (
        await db.execute(
            select(Comment, Post)
            .join(Post, Post.id == Comment.post_id)
            .where(Comment.author_id == user.id, Comment.status == "published", _post_scope(me, groups))
            .order_by(Comment.created_at.desc())
            .limit(limit)
        )
    ).all()
    items = [
        {"type": "post", "at": x.created_at, "post_id": str(x.id), "kind": x.kind, "text": (x.title or x.body or "")[:200]} for x in posts
    ]
    items += [
        {"type": "comment", "at": c.created_at, "post_id": str(po.id), "text": c.body[:200], "on": (po.title or po.body or "")[:80]}
        for c, po in comments
    ]
    items.sort(key=lambda x: x["at"], reverse=True)
    return {"data": items[:limit]}
