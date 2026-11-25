"""Community moderation: reports, posts, comments, groups, moderation log."""

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.audit import record
from ...core.db import get_db
from ...core.deps import Principal, client_ip, require
from ...core.errors import conflict, not_found
from ...core.pagination import PageParams, page_params
from ...models import Comment, ContentReport, DiscussionGroup, GroupMember, ModerationAction, Post, User
from ...services import live
from . import service as svc

router = APIRouter(prefix="/api/v1/admin/community", tags=["Admin: community"])


def _meta(p: PageParams, total: int) -> dict:
    return {"page": p.page, "page_size": p.page_size, "total": total, "pages": max(1, -(-total // p.page_size))}


async def _preview(db: AsyncSession, me: Principal, kind: str, target_id: uuid.UUID) -> dict | None:
    if kind == "post":
        post = await db.get(Post, target_id)
        if not post:
            return None
        return {"post": (await svc.serialize(db, me, [post]))[0]}
    c = await db.get(Comment, target_id)
    if not c:
        return None
    out = (await svc.comments_out(db, me, [c]))[0]
    out["body"] = c.body  # moderators see the text even when hidden
    return {"comment": out}


@router.get("/reports", summary="Reported posts and comments")
async def reports(
    status: Literal["open", "actioned", "dismissed"] = "open",
    p: PageParams = Depends(page_params),
    me: Principal = Depends(require("community.view")),
    db: AsyncSession = Depends(get_db),
):
    # one row per reported item, with every reason
    base = select(ContentReport).where(ContentReport.status == status)
    total = (
        await db.execute(select(func.count(func.distinct(ContentReport.target_id))).where(ContentReport.status == status))
    ).scalar_one()
    targets = (
        await db.execute(
            select(ContentReport.target_type, ContentReport.target_id, func.count(), func.max(ContentReport.created_at).label("last"))
            .where(ContentReport.status == status)
            .group_by(ContentReport.target_type, ContentReport.target_id)
            .order_by(func.count().desc(), func.max(ContentReport.created_at).desc())
            .offset((p.page - 1) * p.page_size)
            .limit(p.page_size)
        )
    ).all()
    data = []
    for kind, tid, n, last in targets:
        rows = (
            (await db.execute(base.where(ContentReport.target_id == tid).order_by(ContentReport.created_at.desc()).limit(20)))
            .scalars()
            .all()
        )
        reporters = await svc.authors(db, {r.reporter_id for r in rows})
        data.append(
            {
                "target_type": kind,
                "target_id": str(tid),
                "count": n,
                "last_reported_at": last,
                "reasons": [
                    {"reason": r.reason, "details": r.details, "reporter": reporters.get(r.reporter_id), "created_at": r.created_at}
                    for r in rows
                ],
                **(await _preview(db, me, kind, tid) or {"missing": True}),
            }
        )
    return {"data": data, "meta": _meta(p, total)}


class Decision(BaseModel):
    action: Literal["hide", "delete", "dismiss"]
    reason: str | None = Field(None, max_length=300)


@router.post("/reports/{target_type}/{target_id}", summary="Decide on a reported post or comment")
async def decide(
    target_type: Literal["post", "comment"],
    target_id: uuid.UUID,
    body: Decision,
    request: Request,
    me: Principal = Depends(require("community.view")),
    db: AsyncSession = Depends(get_db),
):
    need = {"hide": "community.edit", "delete": "community.delete", "dismiss": "community.reject"}[body.action]
    if not me.can(need):
        from ...core.errors import forbidden

        raise forbidden()
    if body.action != "dismiss":
        await _moderate(db, me, target_type, target_id, body.action, body.reason)
    await db.execute(
        update(ContentReport)
        .where(ContentReport.target_id == target_id, ContentReport.status == "open")
        .values(status="dismissed" if body.action == "dismiss" else "actioned", handled_by=me.id, handled_at=func.now())
    )
    await record(
        db,
        actor_id=me.id,
        action=f"moderate_{body.action}",
        entity=target_type,
        entity_id=target_id,
        summary=f"Report on a {target_type}: {body.action}",
        data={"reason": body.reason},
        ip=client_ip(request),
    )
    return {"data": {"ok": True}}


async def _moderate(db: AsyncSession, me: Principal, kind: str, target_id: uuid.UUID, action: str, reason: str | None) -> None:
    if kind == "post":
        post = await db.get(Post, target_id)
        if not post or post.status == "deleted":
            raise not_found("Post")
        if action == "hide":
            post.status, post.moderation_reason = "hidden", reason
            live.emit_to_room(db, svc.room_of(post), "post:deleted", {"id": str(post.id)})
        elif action == "restore":
            post.status, post.moderation_reason = "published", None
            live.emit_to_room(db, svc.room_of(post), "post:updated", {"id": str(post.id)})
        elif action == "delete":
            post.status = "deleted"
            live.emit_to_room(db, svc.room_of(post), "post:deleted", {"id": str(post.id)})
        elif action in ("pin", "unpin"):
            post.is_pinned = action == "pin"
            live.emit_to_room(db, svc.room_of(post), "post:updated", {"id": str(post.id)})
    else:
        c = await db.get(Comment, target_id)
        if not c or c.status == "deleted":
            raise not_found("Comment")
        was = c.status
        c.status = {"hide": "hidden", "restore": "published", "delete": "deleted"}[action]
        delta = (c.status == "published") - (was == "published")
        if delta:
            await db.execute(update(Post).where(Post.id == c.post_id).values(comment_count=func.greatest(Post.comment_count + delta, 0)))
    db.add(ModerationAction(actor_id=me.id, target_type=kind, target_id=str(target_id), action=action, reason=reason))


@router.get("/posts", summary="All posts (search, status, group)")
async def posts(
    q: str | None = Query(None, max_length=100),
    status: Literal["published", "hidden", "deleted"] | None = None,
    group_id: uuid.UUID | None = None,
    kind: Literal["post", "announcement", "share"] | None = None,
    p: PageParams = Depends(page_params),
    me: Principal = Depends(require("community.view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Post)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.join(User, User.id == Post.author_id).where(
            or_(func.lower(Post.body).like(like), func.lower(Post.title).like(like), func.lower(User.full_name).like(like))
        )
    if status:
        stmt = stmt.where(Post.status == status)
    if group_id:
        stmt = stmt.where(Post.group_id == group_id)
    if kind:
        stmt = stmt.where(Post.kind == kind)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(stmt.order_by(Post.created_at.desc()).offset((p.page - 1) * p.page_size).limit(p.page_size))).scalars().all()
    return {"data": await svc.serialize(db, me, list(rows)), "meta": _meta(p, total)}


class ModIn(BaseModel):
    action: Literal["hide", "restore", "delete", "pin", "unpin"]
    reason: str | None = Field(None, max_length=300)


@router.post("/posts/{post_id}/moderate", summary="Hide, restore, delete, pin or unpin a post")
async def moderate_post(
    post_id: uuid.UUID,
    body: ModIn,
    request: Request,
    me: Principal = Depends(require("community.view")),
    db: AsyncSession = Depends(get_db),
):
    need = {
        "hide": "community.edit",
        "restore": "community.edit",
        "delete": "community.delete",
        "pin": "community.publish",
        "unpin": "community.publish",
    }[body.action]
    if not me.can(need):
        from ...core.errors import forbidden

        raise forbidden()
    await _moderate(db, me, "post", post_id, body.action, body.reason)
    await record(
        db,
        actor_id=me.id,
        action=f"moderate_{body.action}",
        entity="post",
        entity_id=post_id,
        summary=f"Post {body.action}",
        data={"reason": body.reason},
        ip=client_ip(request),
    )
    return {"data": {"ok": True}}


@router.post("/comments/{comment_id}/moderate", summary="Hide, restore or delete a comment")
async def moderate_comment(
    comment_id: uuid.UUID,
    body: ModIn,
    request: Request,
    me: Principal = Depends(require("community.edit")),
    db: AsyncSession = Depends(get_db),
):
    if body.action in ("pin", "unpin"):
        raise conflict("NOT_SUPPORTED", "Comments cannot be pinned.")
    await _moderate(db, me, "comment", comment_id, body.action, body.reason)
    await record(
        db,
        actor_id=me.id,
        action=f"moderate_{body.action}",
        entity="comment",
        entity_id=comment_id,
        summary=f"Comment {body.action}",
        ip=client_ip(request),
    )
    return {"data": {"ok": True}}


@router.get("/groups", summary="All groups, including proposals waiting for approval")
async def groups(
    status: Literal["pending", "active", "archived"] | None = None,
    q: str | None = Query(None, max_length=100),
    p: PageParams = Depends(page_params),
    me: Principal = Depends(require("community.view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(DiscussionGroup)
    if status:
        stmt = stmt.where(DiscussionGroup.status == status)
    if q:
        stmt = stmt.where(func.lower(DiscussionGroup.name).like(f"%{q.strip().lower()}%"))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        (
            await db.execute(
                stmt.order_by(DiscussionGroup.status.desc(), DiscussionGroup.name).offset((p.page - 1) * p.page_size).limit(p.page_size)
            )
        )
        .scalars()
        .all()
    )
    creators = await svc.authors(db, {g.created_by for g in rows})
    data = []
    for g in rows:
        out = await svc.group_out(db, me, g)
        out["created_by"] = creators.get(g.created_by)
        data.append(out)
    counts = dict((await db.execute(select(DiscussionGroup.status, func.count()).group_by(DiscussionGroup.status))).all())
    return {"data": data, "meta": {**_meta(p, total), "counts": counts}}


class StaffGroupIn(BaseModel):
    name: str = Field(..., min_length=3, max_length=120)
    description: str = Field("", max_length=1000)
    kind: Literal["interest", "forum"] = "interest"
    join_policy: Literal["open", "approval"] = "open"


@router.post("/groups", status_code=201, summary="Create a group (staff)")
async def create_group(
    body: StaffGroupIn, request: Request, me: Principal = Depends(require("community.approve")), db: AsyncSession = Depends(get_db)
):
    dup = (
        await db.execute(
            select(DiscussionGroup.id).where(
                func.lower(DiscussionGroup.name) == body.name.strip().lower(), DiscussionGroup.status != "archived"
            )
        )
    ).first()
    if dup:
        raise conflict("GROUP_EXISTS", "A group with this name already exists.")
    g = DiscussionGroup(
        name=body.name.strip(),
        description=body.description.strip(),
        kind=body.kind,
        join_policy=body.join_policy,
        status="active",
        created_by=me.id,
        member_count=1,
    )
    db.add(g)
    await db.flush()
    db.add(GroupMember(group_id=g.id, user_id=me.id, role="owner", status="active"))
    await record(
        db, actor_id=me.id, action="create", entity="group", entity_id=g.id, summary=f"Created group {g.name}", ip=client_ip(request)
    )
    await db.flush()
    await db.refresh(g)
    return {"data": await svc.group_out(db, me, g)}


class GroupDecision(BaseModel):
    action: Literal["approve", "reject", "archive", "restore"]
    reason: str | None = Field(None, max_length=300)


@router.post("/groups/{group_id}/decide", summary="Approve, reject, archive or restore a group")
async def decide_group(
    group_id: uuid.UUID,
    body: GroupDecision,
    request: Request,
    me: Principal = Depends(require("community.approve")),
    db: AsyncSession = Depends(get_db),
):
    g = await svc.group_or_404(db, group_id)
    if body.action in ("approve", "reject") and g.status != "pending":
        raise conflict("NOT_PENDING", "This group is not waiting for approval.")
    if g.kind == "batch" and body.action == "archive":
        raise conflict("BATCH_GROUP", "Batch communities follow their batch.")
    g.status = {"approve": "active", "reject": "archived", "archive": "archived", "restore": "active"}[body.action]
    db.add(ModerationAction(actor_id=me.id, target_type="group", target_id=str(g.id), action=body.action, reason=body.reason))
    if g.created_by and body.action in ("approve", "reject"):
        from ...services import notifications

        approved = body.action == "approve"
        await notifications.notify(
            db,
            g.created_by,
            "community",
            "group_decision",
            f"Your group “{g.name}” was {'approved' if approved else 'not approved'}",
            body=body.reason or "",
            link=f"/portal/community/groups/{g.id}" if approved else "/portal/community/groups",
        )
        live.emit_to_user(db, g.created_by, "group:decision", {"id": str(g.id), "name": g.name, "approved": approved})
    await record(
        db,
        actor_id=me.id,
        action=body.action,
        entity="group",
        entity_id=g.id,
        summary=f"Group {g.name}: {body.action}",
        data={"reason": body.reason},
        ip=client_ip(request),
    )
    return {"data": await svc.group_out(db, me, g)}


@router.get("/moderation-log", summary="Moderation history")
async def moderation_log(
    p: PageParams = Depends(page_params), me: Principal = Depends(require("community.view")), db: AsyncSession = Depends(get_db)
):
    total = (await db.execute(select(func.count()).select_from(ModerationAction))).scalar_one()
    rows = (
        (
            await db.execute(
                select(ModerationAction).order_by(ModerationAction.created_at.desc()).offset((p.page - 1) * p.page_size).limit(p.page_size)
            )
        )
        .scalars()
        .all()
    )
    people = await svc.authors(db, {r.actor_id for r in rows})
    return {
        "data": [
            {
                "id": r.id,
                "actor": people.get(r.actor_id),
                "target_type": r.target_type,
                "target_id": r.target_id,
                "action": r.action,
                "reason": r.reason,
                "created_at": r.created_at,
            }
            for r in rows
        ],
        "meta": _meta(p, total),
    }
