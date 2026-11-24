"""Community for members: feed, posts, reactions, comments, shares, reports and discussion groups."""

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, File, Query, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.deps import Principal, require, require_module
from ...core.errors import AppError, conflict, forbidden, not_found
from ...core.redis import enforce
from ...models import (
    AlumniConnection,
    AlumniFollow,
    Comment,
    ContentReport,
    DiscussionGroup,
    GroupMember,
    Media,
    Post,
    PostMedia,
    Reaction,
)
from ...services import live, media
from . import service as svc

router = APIRouter(prefix="/api/v1/community", tags=["Community"], dependencies=[Depends(require_module("community"))])
reader = require("portal.react", "community.view", any_of=True)


def _text(v):
    return v.strip() if isinstance(v, str) else v


# ── feed ────────────────────────────────────────────────────────────────────
@router.get("/feed", summary="Community feed (cursor pagination, newest first)")
async def feed(
    filter: Literal["all", "following", "announcements", "mine"] = "all",
    group_id: uuid.UUID | None = None,
    cursor: str | None = None,
    limit: int = Query(15, ge=1, le=50),
    q: str | None = Query(None, max_length=100),
    p: Principal = Depends(reader),
    db: AsyncSession = Depends(get_db),
):
    await svc.ensure_batch_group(db, p.id)
    # your own hidden posts stay visible to you under "My posts" (with the moderator's reason)
    stmt = select(Post).where(Post.status.in_(["published", "hidden"]) if filter == "mine" else Post.status == "published")
    if group_id:
        g = await svc.group_or_404(db, group_id)
        from ...services import rooms

        if not await rooms.can_read_group(db, p, g):
            raise not_found("Group")
        stmt = stmt.where(Post.group_id == group_id)
    else:
        stmt = stmt.where(svc.feed_scope(p, await svc.member_group_ids(db, p.id)))
    if filter == "announcements":
        stmt = stmt.where(Post.kind == "announcement")
    elif filter == "mine":
        stmt = stmt.where(Post.author_id == p.id)
    elif filter == "following":
        followed = select(AlumniFollow.followee_id).where(AlumniFollow.follower_id == p.id)
        connected = (
            select(AlumniConnection.addressee_id)
            .where(AlumniConnection.requester_id == p.id, AlumniConnection.status == "accepted")
            .union(
                select(AlumniConnection.requester_id).where(AlumniConnection.addressee_id == p.id, AlumniConnection.status == "accepted")
            )
        )
        stmt = stmt.where(or_(Post.author_id.in_(followed), Post.author_id.in_(connected)))
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(Post.body).like(like), func.lower(Post.title).like(like)))
    pinned = []
    if not cursor and filter == "all" and not q:
        pinned_rows = (await db.execute(stmt.where(Post.is_pinned.is_(True)).order_by(Post.created_at.desc()).limit(3))).scalars().all()
        pinned = await svc.serialize(db, p, list(pinned_rows))
        stmt = stmt.where(Post.is_pinned.is_(False))
    elif filter == "all" and not q:
        stmt = stmt.where(Post.is_pinned.is_(False))
    if c := svc.decode_cursor(cursor):
        stmt = stmt.where(or_(Post.created_at < c[0], and_(Post.created_at == c[0], Post.id < c[1])))
    rows = (await db.execute(stmt.order_by(Post.created_at.desc(), Post.id.desc()).limit(limit + 1))).scalars().all()
    more = len(rows) > limit
    rows = rows[:limit]
    await db.commit()  # batch community membership
    return {
        "data": await svc.serialize(db, p, list(rows)),
        "meta": {"next_cursor": svc.encode_cursor(rows[-1].created_at, rows[-1].id) if more else None, "pinned": pinned},
    }


# ── posts ───────────────────────────────────────────────────────────────────
class PostIn(BaseModel):
    body: str = Field("", max_length=5000)
    title: str | None = Field(None, max_length=200)
    group_id: uuid.UUID | None = None
    media_ids: list[uuid.UUID] = Field(default_factory=list, max_length=6)
    shared_post_id: uuid.UUID | None = None
    announcement: bool = False
    client_key: str | None = Field(None, max_length=64, pattern=r"^[A-Za-z0-9_\-]+$")

    _t = field_validator("body", "title", mode="before")(_text)


class PostEdit(BaseModel):
    body: str = Field(..., max_length=5000)
    title: str | None = Field(None, max_length=200)

    _t = field_validator("body", "title", mode="before")(_text)


@router.post("/posts", status_code=201, summary="Create a post (text, images, share, announcement or forum topic)")
async def create_post(
    body: PostIn, p: Principal = Depends(require("portal.post", "community.publish", any_of=True)), db: AsyncSession = Depends(get_db)
):
    if body.client_key:  # same composer submission twice → same post
        existing = (await db.execute(select(Post).where(Post.author_id == p.id, Post.client_key == body.client_key))).scalar_one_or_none()
        if existing:
            return {"data": (await svc.serialize(db, p, [existing]))[0]}
    await enforce(f"post:{p.id}", 20, 3600, "You are posting very often. Please wait a little.")
    if body.announcement and not p.can("community.publish"):
        raise forbidden("Only community administrators can publish announcements.")
    if not body.body and not body.media_ids and not body.shared_post_id:
        raise AppError(422, "EMPTY_POST", "Write something or add a photo.", [{"field": "body", "message": "Required."}])
    group = None
    if body.group_id:
        group = await svc.group_or_404(db, body.group_id)
        if group.status != "active":
            raise conflict("GROUP_INACTIVE", "This group is not active.")
        await svc.ensure_batch_group(db, p.id)
        if not await svc.membership(db, group.id, p.id) and not p.can("community.publish"):
            raise forbidden("Join the group to post in it.")
        if group.kind == "forum" and not body.title:
            raise AppError(422, "TITLE_REQUIRED", "Forum topics need a title.", [{"field": "title", "message": "Required."}])
    shared = None
    if body.shared_post_id:
        shared = await svc.readable_post(db, p, await db.get(Post, body.shared_post_id))
        if shared.status != "published":
            raise not_found("Post")
        if shared.kind == "share" and shared.shared_post_id:  # share the original, not a share of a share
            shared = await svc.readable_post(db, p, await db.get(Post, shared.shared_post_id))
        if shared.group_id and shared.group_id != body.group_id:
            g = await db.get(DiscussionGroup, shared.group_id)
            if g and g.join_policy != "open":
                raise forbidden("Posts from private groups cannot be shared outside the group.")
    files = []
    for mid in dict.fromkeys(body.media_ids):
        m = await db.get(Media, mid)
        if not m or m.deleted_at or m.uploaded_by != p.id or m.folder != "posts" or not m.mime.startswith("image/"):
            raise AppError(422, "INVALID_MEDIA", "One of the photos is not available. Upload it again.")
        files.append(m)
    post = Post(
        author_id=p.id,
        group_id=body.group_id,
        kind="announcement" if body.announcement else "share" if shared else "post",
        title=body.title or None,
        body=body.body,
        shared_post_id=shared.id if shared else None,
        client_key=body.client_key,
        status="published",
    )
    db.add(post)
    await db.flush()
    for i, m in enumerate(files):
        db.add(PostMedia(post_id=post.id, media_id=m.id, position=i))
    if shared:
        await db.execute(update(Post).where(Post.id == shared.id).values(share_count=Post.share_count + 1))
    if group:
        await db.execute(
            update(DiscussionGroup)
            .where(DiscussionGroup.id == group.id)
            .values(post_count=DiscussionGroup.post_count + 1, last_post_at=func.now())
        )
    await db.flush()
    await db.refresh(post)
    live.emit_to_room(
        db,
        svc.room_of(post),
        "post:new",
        {"id": str(post.id), "group_id": str(post.group_id) if post.group_id else None, "author_id": str(p.id), "kind": post.kind},
    )
    return {"data": (await svc.serialize(db, p, [post]))[0]}


@router.get("/posts/{post_id}", summary="One post")
async def get_post(post_id: uuid.UUID, p: Principal = Depends(reader), db: AsyncSession = Depends(get_db)):
    post = await svc.readable_post(db, p, await db.get(Post, post_id))
    return {"data": (await svc.serialize(db, p, [post]))[0]}


@router.patch("/posts/{post_id}", summary="Edit your post")
async def edit_post(
    post_id: uuid.UUID,
    body: PostEdit,
    p: Principal = Depends(require("portal.post", "community.publish", any_of=True)),
    db: AsyncSession = Depends(get_db),
):
    post = await svc.readable_post(db, p, await db.get(Post, post_id))
    if post.author_id != p.id:
        raise forbidden("You can only edit your own posts.")
    if not body.body and post.kind != "share" and not (await db.execute(select(PostMedia).where(PostMedia.post_id == post.id))).first():
        raise AppError(422, "EMPTY_POST", "A post cannot be empty.", [{"field": "body", "message": "Required."}])
    post.body, post.edited_at = body.body, func.now()
    if post.group_id and body.title is not None:
        post.title = body.title or post.title
    await db.flush()
    await db.refresh(post)
    live.emit_to_room(db, svc.room_of(post), "post:updated", {"id": str(post.id)})
    return {"data": (await svc.serialize(db, p, [post]))[0]}


@router.delete("/posts/{post_id}", summary="Delete a post (yours, or any as a moderator)")
async def delete_post(post_id: uuid.UUID, p: Principal = Depends(reader), db: AsyncSession = Depends(get_db)):
    post = await svc.readable_post(db, p, await db.get(Post, post_id))
    group_mod = False
    if post.group_id and post.author_id != p.id:
        g = await db.get(DiscussionGroup, post.group_id)
        group_mod = bool(g) and await svc.can_manage_group(db, p, g)
    if post.author_id != p.id and not p.can("community.delete") and not group_mod:
        raise forbidden()
    post.status = "deleted"
    if post.author_id != p.id:
        from ...models import ModerationAction

        db.add(ModerationAction(actor_id=p.id, target_type="post", target_id=str(post.id), action="delete"))
    live.emit_to_room(db, svc.room_of(post), "post:deleted", {"id": str(post.id)})
    return {"data": {"ok": True}}


class ReactionIn(BaseModel):
    kind: Literal["like", "love", "celebrate", "support", "insightful"] = "like"


async def _reaction_payload(db: AsyncSession, post: Post) -> dict:
    counts = dict((await db.execute(select(Reaction.kind, func.count()).where(Reaction.post_id == post.id).group_by(Reaction.kind))).all())
    return {"id": str(post.id), "reaction_count": sum(counts.values()), "reactions": counts}


@router.put("/posts/{post_id}/reaction", summary="React to a post (replaces your previous reaction)")
async def react(post_id: uuid.UUID, body: ReactionIn, p: Principal = Depends(require("portal.react")), db: AsyncSession = Depends(get_db)):
    post = await svc.readable_post(db, p, await db.get(Post, post_id))
    await enforce(f"react:{p.id}", 300, 3600)
    r = await db.get(Reaction, (post.id, p.id))
    if r:
        r.kind = body.kind
    else:
        db.add(Reaction(post_id=post.id, user_id=p.id, kind=body.kind))
        await db.execute(update(Post).where(Post.id == post.id).values(reaction_count=Post.reaction_count + 1))
    await db.flush()
    payload = await _reaction_payload(db, post)
    live.emit_to_room(db, svc.room_of(post), "post:reactions", payload)
    return {"data": {**payload, "my_reaction": body.kind}}


@router.delete("/posts/{post_id}/reaction", summary="Remove your reaction")
async def unreact(post_id: uuid.UUID, p: Principal = Depends(require("portal.react")), db: AsyncSession = Depends(get_db)):
    post = await svc.readable_post(db, p, await db.get(Post, post_id))
    res = await db.execute(delete(Reaction).where(Reaction.post_id == post.id, Reaction.user_id == p.id))
    if res.rowcount:
        await db.execute(update(Post).where(Post.id == post.id).values(reaction_count=func.greatest(Post.reaction_count - 1, 0)))
    await db.flush()
    payload = await _reaction_payload(db, post)
    live.emit_to_room(db, svc.room_of(post), "post:reactions", payload)
    return {"data": {**payload, "my_reaction": None}}


@router.get("/posts/{post_id}/reactions", summary="Who reacted")
async def reactors(post_id: uuid.UUID, p: Principal = Depends(reader), db: AsyncSession = Depends(get_db)):
    post = await svc.readable_post(db, p, await db.get(Post, post_id))
    rows = (
        (await db.execute(select(Reaction).where(Reaction.post_id == post.id).order_by(Reaction.created_at.desc()).limit(200)))
        .scalars()
        .all()
    )
    people = await svc.authors(db, {r.user_id for r in rows})
    return {"data": [{"kind": r.kind, "user": people.get(r.user_id)} for r in rows]}


@router.post("/uploads", status_code=201, summary="Upload a photo for a post")
async def upload(
    file: UploadFile = File(...),
    p: Principal = Depends(require("portal.post", "community.publish", any_of=True)),
    db: AsyncSession = Depends(get_db),
):
    await enforce(f"post-upload:{p.id}", 60, 3600)
    m = await media.upload(db, data=await file.read(), filename=file.filename or "photo", folder="posts", images_only=True, actor=p.id)
    pub = await media.to_public(db, m)
    return {"data": {"id": str(m.id), "url": pub["url"], "variants": pub["variants"], "width": m.width, "height": m.height}}


# ── comments ────────────────────────────────────────────────────────────────
class CommentIn(BaseModel):
    body: str = Field(..., min_length=1, max_length=2000)
    parent_id: uuid.UUID | None = None

    _t = field_validator("body", mode="before")(_text)


@router.get("/posts/{post_id}/comments", summary="Comments of a post (oldest first, replies included)")
async def list_comments(
    post_id: uuid.UUID,
    cursor: str | None = None,
    limit: int = Query(30, ge=1, le=100),
    p: Principal = Depends(reader),
    db: AsyncSession = Depends(get_db),
):
    post = await svc.readable_post(db, p, await db.get(Post, post_id))
    staff = p.can("community.view")
    visible = Comment.status != "deleted" if staff else or_(Comment.status == "published", Comment.author_id == p.id)
    stmt = select(Comment).where(Comment.post_id == post.id, Comment.parent_id.is_(None), visible)
    if c := svc.decode_cursor(cursor):
        stmt = stmt.where(or_(Comment.created_at > c[0], and_(Comment.created_at == c[0], Comment.id > c[1])))
    top = (await db.execute(stmt.order_by(Comment.created_at, Comment.id).limit(limit + 1))).scalars().all()
    more = len(top) > limit
    top = top[:limit]
    replies = (
        (
            await db.execute(
                select(Comment)
                .where(Comment.parent_id.in_([c.id for c in top] or [uuid.UUID(int=0)]), visible)
                .order_by(Comment.created_at)
            )
        )
        .scalars()
        .all()
        if top
        else []
    )
    items = await svc.comments_out(db, p, list(top) + list(replies))
    by_parent: dict = {}
    for it in items:
        if it["parent_id"]:
            by_parent.setdefault(it["parent_id"], []).append(it)
    data = [{**it, "replies": by_parent.get(it["id"], [])} for it in items if not it["parent_id"]]
    return {"data": data, "meta": {"next_cursor": svc.encode_cursor(top[-1].created_at, top[-1].id) if more else None}}


@router.post("/posts/{post_id}/comments", status_code=201, summary="Comment on a post or reply to a comment")
async def add_comment(
    post_id: uuid.UUID,
    body: CommentIn,
    p: Principal = Depends(require("portal.post", "community.publish", any_of=True)),
    db: AsyncSession = Depends(get_db),
):
    post = await svc.readable_post(db, p, await db.get(Post, post_id))
    if post.status != "published":
        raise conflict("POST_UNAVAILABLE", "Comments are closed on this post.")
    if post.group_id and not p.can("community.publish") and not await svc.membership(db, post.group_id, p.id):
        raise forbidden("Join the group to comment.")
    await enforce(f"comment:{p.id}", 60, 3600, "You are commenting very often. Please wait a little.")
    parent = None
    if body.parent_id:
        parent = await db.get(Comment, body.parent_id)
        if not parent or parent.post_id != post.id or parent.status == "deleted":
            raise not_found("Comment")
        if parent.parent_id:  # replies stay one level deep
            parent = await db.get(Comment, parent.parent_id)
    c = Comment(post_id=post.id, author_id=p.id, parent_id=parent.id if parent else None, body=body.body)
    db.add(c)
    await db.execute(update(Post).where(Post.id == post.id).values(comment_count=Post.comment_count + 1))
    await db.flush()
    await db.refresh(c)
    live.emit_to_room(db, svc.room_of(post), "comment:new", {"post_id": str(post.id), "id": str(c.id)})
    return {"data": (await svc.comments_out(db, p, [c]))[0]}


class CommentEdit(BaseModel):
    body: str = Field(..., min_length=1, max_length=2000)

    _t = field_validator("body", mode="before")(_text)


@router.patch("/comments/{comment_id}", summary="Edit your comment")
async def edit_comment(
    comment_id: uuid.UUID,
    body: CommentEdit,
    p: Principal = Depends(require("portal.post", "community.publish", any_of=True)),
    db: AsyncSession = Depends(get_db),
):
    c = await db.get(Comment, comment_id)
    if not c or c.status == "deleted":
        raise not_found("Comment")
    await svc.readable_post(db, p, await db.get(Post, c.post_id))
    if c.author_id != p.id or c.status != "published":
        raise forbidden("You can only edit your own comments.")
    c.body, c.edited_at = body.body, func.now()
    await db.flush()
    await db.refresh(c)
    return {"data": (await svc.comments_out(db, p, [c]))[0]}


@router.delete("/comments/{comment_id}", summary="Delete a comment (yours, or any as a moderator)")
async def delete_comment(comment_id: uuid.UUID, p: Principal = Depends(reader), db: AsyncSession = Depends(get_db)):
    c = await db.get(Comment, comment_id)
    if not c or c.status == "deleted":
        raise not_found("Comment")
    post = await svc.readable_post(db, p, await db.get(Post, c.post_id))
    if c.author_id != p.id and not p.can("community.delete") and post.author_id != p.id:
        raise forbidden()
    c.status = "deleted"
    await db.execute(update(Post).where(Post.id == post.id).values(comment_count=func.greatest(Post.comment_count - 1, 0)))
    if c.author_id != p.id:
        from ...models import ModerationAction

        db.add(ModerationAction(actor_id=p.id, target_type="comment", target_id=str(c.id), action="delete"))
    live.emit_to_room(db, svc.room_of(post), "comment:deleted", {"post_id": str(post.id), "id": str(c.id)})
    return {"data": {"ok": True}}


# ── reports ─────────────────────────────────────────────────────────────────
class ReportIn(BaseModel):
    target_type: Literal["post", "comment"]
    target_id: uuid.UUID
    reason: Literal["spam", "harassment", "hate", "misinformation", "inappropriate", "other"]
    details: str | None = Field(None, max_length=1000)


@router.post("/reports", status_code=201, summary="Report a post or comment to the moderators")
async def report(body: ReportIn, p: Principal = Depends(reader), db: AsyncSession = Depends(get_db)):
    await enforce(f"content-report:{p.id}", 20, 86400, "You have sent many reports today.")
    if body.target_type == "post":
        target = await svc.readable_post(db, p, await db.get(Post, body.target_id))
    else:
        target = await db.get(Comment, body.target_id)
        if not target or target.status == "deleted":
            raise not_found("Comment")
        await svc.readable_post(db, p, await db.get(Post, target.post_id))
    if target.author_id == p.id:
        raise conflict("SELF", "You cannot report your own content.")
    dup = (
        await db.execute(
            select(ContentReport.id).where(
                ContentReport.reporter_id == p.id, ContentReport.target_id == body.target_id, ContentReport.status == "open"
            )
        )
    ).first()
    if dup:
        raise conflict("ALREADY_REPORTED", "You have already reported this. The moderators will review it.")
    db.add(
        ContentReport(reporter_id=p.id, target_type=body.target_type, target_id=body.target_id, reason=body.reason, details=body.details)
    )
    live.emit_to_room(db, "admin:alumni_admin", "moderation:report", {"target_type": body.target_type})
    return {"data": {"message": "Thank you. The moderators will review it."}}


# ── groups ──────────────────────────────────────────────────────────────────
@router.get("/groups", summary="Your groups, or groups to discover")
async def list_groups(
    scope: Literal["mine", "discover"] = "mine",
    q: str | None = Query(None, max_length=100),
    kind: Literal["batch", "interest", "forum"] | None = None,
    p: Principal = Depends(reader),
    db: AsyncSession = Depends(get_db),
):
    await svc.ensure_batch_group(db, p.id)
    await db.commit()
    mine = set(await svc.member_group_ids(db, p.id))
    stmt = select(DiscussionGroup).where(DiscussionGroup.status == "active")
    if scope == "mine":
        stmt = stmt.where(DiscussionGroup.id.in_(mine or [uuid.UUID(int=0)]))
        # also the member's own proposals waiting for approval
        stmt = select(DiscussionGroup).where(
            or_(
                DiscussionGroup.id.in_(mine or [uuid.UUID(int=0)]),
                and_(DiscussionGroup.created_by == p.id, DiscussionGroup.status == "pending"),
            )
        )
    else:
        stmt = stmt.where(DiscussionGroup.kind != "batch", DiscussionGroup.id.not_in(mine or [uuid.UUID(int=0)]))
    if kind:
        stmt = stmt.where(DiscussionGroup.kind == kind)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(DiscussionGroup.name).like(like), func.lower(DiscussionGroup.description).like(like)))
    rows = (
        (await db.execute(stmt.order_by(DiscussionGroup.last_post_at.desc().nulls_last(), DiscussionGroup.name).limit(100))).scalars().all()
    )
    return {"data": [await svc.group_out(db, p, g) for g in rows]}


class GroupIn(BaseModel):
    name: str = Field(..., min_length=3, max_length=120)
    description: str = Field("", max_length=1000)
    kind: Literal["interest", "forum"] = "interest"
    join_policy: Literal["open", "approval"] = "open"
    cover_id: uuid.UUID | None = None

    _t = field_validator("name", "description", mode="before")(_text)


@router.post("/groups", status_code=201, summary="Propose a group (moderators approve it)")
async def create_group(
    body: GroupIn, p: Principal = Depends(require("portal.groups", "community.approve", any_of=True)), db: AsyncSession = Depends(get_db)
):
    await enforce(f"group-create:{p.id}", 5, 86400, "You can propose up to 5 groups a day.")
    dup = (
        await db.execute(
            select(DiscussionGroup.id).where(func.lower(DiscussionGroup.name) == body.name.lower(), DiscussionGroup.status != "archived")
        )
    ).first()
    if dup:
        raise conflict("GROUP_EXISTS", "A group with this name already exists.")
    if body.cover_id:
        m = await db.get(Media, body.cover_id)
        if not m or m.uploaded_by != p.id or not m.mime.startswith("image/"):
            raise AppError(422, "INVALID_MEDIA", "Upload the cover image again.")
    auto = p.can("community.approve")
    g = DiscussionGroup(
        name=body.name,
        description=body.description,
        kind=body.kind,
        join_policy=body.join_policy,
        cover_id=body.cover_id,
        created_by=p.id,
        status="active" if auto else "pending",
        member_count=1,
    )
    db.add(g)
    await db.flush()
    db.add(GroupMember(group_id=g.id, user_id=p.id, role="owner", status="active"))
    if not auto:
        live.emit_to_room(db, "admin:alumni_admin", "moderation:group", {"id": str(g.id)})
    await db.flush()
    await db.refresh(g)
    return {"data": await svc.group_out(db, p, g)}


@router.get("/groups/{group_id}", summary="A group")
async def get_group(group_id: uuid.UUID, p: Principal = Depends(reader), db: AsyncSession = Depends(get_db)):
    g = await svc.group_or_404(db, group_id)
    from ...services import rooms

    if g.status != "active" and not (g.created_by == p.id or p.can("community.view")):
        raise not_found("Group")
    out = await svc.group_out(db, p, g)
    out["readable"] = g.status == "active" and await rooms.can_read_group(db, p, g)
    return {"data": out}


class GroupEdit(BaseModel):
    name: str | None = Field(None, min_length=3, max_length=120)
    description: str | None = Field(None, max_length=1000)
    join_policy: Literal["open", "approval"] | None = None
    cover_id: uuid.UUID | None = None

    _t = field_validator("name", "description", mode="before")(_text)


@router.patch("/groups/{group_id}", summary="Edit a group (owners and moderators)")
async def edit_group(group_id: uuid.UUID, body: GroupEdit, p: Principal = Depends(reader), db: AsyncSession = Depends(get_db)):
    g = await svc.group_or_404(db, group_id)
    if not await svc.can_manage_group(db, p, g):
        raise forbidden()
    for f in body.model_fields_set:
        if f == "join_policy" and g.kind == "batch":
            continue
        setattr(g, f, getattr(body, f))
    await db.flush()
    return {"data": await svc.group_out(db, p, g)}


@router.post("/groups/{group_id}/join", summary="Join a group (or ask to join)")
async def join_group(group_id: uuid.UUID, p: Principal = Depends(require("portal.groups")), db: AsyncSession = Depends(get_db)):
    g = await svc.group_or_404(db, group_id)
    if g.status != "active" or g.kind == "batch":
        raise conflict("NOT_JOINABLE", "Batch communities are joined automatically after verification.")
    m = await db.get(GroupMember, (g.id, p.id))
    if m and m.status == "banned":
        raise forbidden("You cannot join this group.")
    if m and m.status == "active":
        return {"data": await svc.group_out(db, p, g, m)}
    status = "active" if g.join_policy == "open" else "pending"
    if m:
        m.status = status
    else:
        m = GroupMember(group_id=g.id, user_id=p.id, role="member", status=status)
        db.add(m)
    if status == "active":
        await db.execute(update(DiscussionGroup).where(DiscussionGroup.id == g.id).values(member_count=DiscussionGroup.member_count + 1))
    await db.flush()
    await db.refresh(g)
    return {"data": await svc.group_out(db, p, g, m)}


@router.post("/groups/{group_id}/leave", summary="Leave a group")
async def leave_group(group_id: uuid.UUID, p: Principal = Depends(reader), db: AsyncSession = Depends(get_db)):
    g = await svc.group_or_404(db, group_id)
    if g.kind == "batch":
        raise conflict("NOT_LEAVABLE", "You stay a member of your batch community.")
    m = await db.get(GroupMember, (g.id, p.id))
    if not m or m.status == "banned":
        raise not_found("Membership")
    if m.role == "owner":
        others = (
            await db.execute(
                select(func.count())
                .select_from(GroupMember)
                .where(
                    GroupMember.group_id == g.id,
                    GroupMember.role.in_(["owner", "moderator"]),
                    GroupMember.user_id != p.id,
                    GroupMember.status == "active",
                )
            )
        ).scalar_one()
        if not others:
            raise conflict("LAST_OWNER", "Make another member a moderator before leaving.")
    was_active = m.status == "active"
    await db.delete(m)
    if was_active:
        await db.execute(
            update(DiscussionGroup)
            .where(DiscussionGroup.id == g.id)
            .values(member_count=func.greatest(DiscussionGroup.member_count - 1, 0))
        )
    return {"data": {"ok": True}}


@router.get("/groups/{group_id}/members", summary="Group members (and join requests for its managers)")
async def group_members(
    group_id: uuid.UUID,
    status: Literal["active", "pending"] = "active",
    q: str | None = Query(None, max_length=100),
    p: Principal = Depends(reader),
    db: AsyncSession = Depends(get_db),
):
    from ...models import User
    from ...services import rooms

    g = await svc.group_or_404(db, group_id)
    if not await rooms.can_read_group(db, p, g):
        raise not_found("Group")
    if status == "pending" and not await svc.can_manage_group(db, p, g):
        raise forbidden()
    stmt = (
        select(GroupMember)
        .join(User, User.id == GroupMember.user_id)
        .where(GroupMember.group_id == g.id, GroupMember.status == status, User.deleted_at.is_(None))
    )
    if q:
        stmt = stmt.where(func.lower(User.full_name).like(f"%{q.strip().lower()}%"))
    rows = (await db.execute(stmt.order_by(GroupMember.role.desc(), GroupMember.joined_at).limit(200))).scalars().all()
    people = await svc.authors(db, {m.user_id for m in rows})
    return {"data": [{"user": people.get(m.user_id), "role": m.role, "status": m.status, "joined_at": m.joined_at} for m in rows]}


class MemberAction(BaseModel):
    action: Literal["approve", "remove", "ban", "make_moderator", "make_member"]


@router.post("/groups/{group_id}/members/{user_id}", summary="Manage a member (owners and moderators)")
async def manage_member(
    group_id: uuid.UUID, user_id: uuid.UUID, body: MemberAction, p: Principal = Depends(reader), db: AsyncSession = Depends(get_db)
):
    from ...models import ModerationAction

    g = await svc.group_or_404(db, group_id)
    if not await svc.can_manage_group(db, p, g):
        raise forbidden()
    m = await db.get(GroupMember, (g.id, user_id))
    if not m:
        raise not_found("Member")
    if m.role == "owner" and not p.can("community.edit"):
        raise forbidden("The owner cannot be changed by moderators.")
    was_active = m.status == "active"
    if body.action == "approve":
        m.status = "active"
    elif body.action == "remove":
        if g.kind == "batch":
            raise conflict("NOT_REMOVABLE", "Batch membership follows the member's verified batch.")
        await db.delete(m)
    elif body.action == "ban":
        m.status, m.role = "banned", "member"
    elif body.action in ("make_moderator", "make_member"):
        if m.status != "active":
            raise conflict("NOT_ACTIVE", "Only active members can be moderators.")
        m.role = "moderator" if body.action == "make_moderator" else "member"
    now_active = body.action not in ("remove", "ban") and m.status == "active"
    delta = int(now_active) - int(was_active)
    if delta:
        await db.execute(
            update(DiscussionGroup)
            .where(DiscussionGroup.id == g.id)
            .values(member_count=func.greatest(DiscussionGroup.member_count + delta, 0))
        )
    db.add(ModerationAction(actor_id=p.id, target_type="member", target_id=f"{g.id}:{user_id}", action=body.action))
    return {"data": {"ok": True}}
