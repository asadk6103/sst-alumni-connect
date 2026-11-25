"""Community: discussion groups (batch, interest, forum), posts, comments, reactions, reports, moderation."""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, Timestamps, UUIDPk


class DiscussionGroup(UUIDPk, Timestamps, Base):
    __tablename__ = "discussion_groups"
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(String(1000), default="")
    # batch (one per batch, membership follows the profile) | interest | forum (posts are titled topics)
    kind: Mapped[str] = mapped_column(String(20), default="interest", index=True)
    batch_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("alumni_batches.id", ondelete="CASCADE"), unique=True)
    join_policy: Mapped[str] = mapped_column(String(20), default="open")  # open | approval
    # pending (member-proposed, awaiting moderators) | active | archived
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)
    cover_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("media_library.id", ondelete="SET NULL"))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    member_count: Mapped[int] = mapped_column(Integer, default=0)
    post_count: Mapped[int] = mapped_column(Integer, default=0)
    last_post_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class GroupMember(Base):
    __tablename__ = "group_members"
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("discussion_groups.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    role: Mapped[str] = mapped_column(String(20), default="member")  # member | moderator | owner
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | pending | banned
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Post(UUIDPk, Base):
    __tablename__ = "posts"
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("discussion_groups.id", ondelete="CASCADE"))
    # post | announcement | share | achievement | article | poll | event | job
    kind: Mapped[str] = mapped_column(String(20), default="post")
    # community (everyone who can read the feed / group) | connections (author's connections only)
    audience: Mapped[str] = mapped_column(String(20), default="community", server_default="community")
    location: Mapped[str | None] = mapped_column(String(150))
    feeling: Mapped[str | None] = mapped_column(String(60))
    topics: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    mentions: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))  # user ids
    event_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("events.id", ondelete="SET NULL"))  # shared event
    job_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("job_posts.id", ondelete="SET NULL"))  # shared job
    title: Mapped[str | None] = mapped_column(String(200))  # forum topics
    body: Mapped[str] = mapped_column(Text, default="")
    shared_post_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("posts.id", ondelete="SET NULL"))
    # published | hidden (by a moderator) | deleted
    status: Mapped[str] = mapped_column(String(20), default="published")
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    comment_count: Mapped[int] = mapped_column(Integer, default=0)
    reaction_count: Mapped[int] = mapped_column(Integer, default=0)
    share_count: Mapped[int] = mapped_column(Integer, default=0)
    client_key: Mapped[str | None] = mapped_column(String(64))  # idempotency key from the composer
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    moderation_reason: Mapped[str | None] = mapped_column(String(300))

    __table_args__ = (
        Index("ix_posts_feed", "created_at", "id", postgresql_where=text("status = 'published'")),
        Index("ix_posts_group_feed", "group_id", "created_at", postgresql_where=text("status = 'published'")),
        Index("uq_posts_author_client_key", "author_id", "client_key", unique=True, postgresql_where=text("client_key IS NOT NULL")),
    )


class PostMedia(Base):
    __tablename__ = "post_media"
    post_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True)
    media_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("media_library.id", ondelete="CASCADE"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer, default=0)


class Comment(UUIDPk, Base):
    __tablename__ = "comments"
    post_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("comments.id", ondelete="CASCADE"))
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="published")  # published | hidden | deleted
    mentions: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    reaction_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Reaction(Base):
    __tablename__ = "reactions"
    post_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    kind: Mapped[str] = mapped_column(String(20))  # like | love | celebrate | support | insightful
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ContentReport(UUIDPk, Base):
    __tablename__ = "reports"
    reporter_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    target_type: Mapped[str] = mapped_column(String(20))  # post | comment
    target_id: Mapped[uuid.UUID] = mapped_column(index=True)
    reason: Mapped[str] = mapped_column(String(30))
    details: Mapped[str | None] = mapped_column(String(1000))
    status: Mapped[str] = mapped_column(String(15), default="open", index=True)  # open | actioned | dismissed
    handled_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    handled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ModerationAction(Base):
    __tablename__ = "moderation_actions"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    target_type: Mapped[str] = mapped_column(String(20))  # post | comment | group | member
    target_id: Mapped[str] = mapped_column(String(100), index=True)
    action: Mapped[str] = mapped_column(String(20))  # hide | restore | delete | pin | unpin | approve | reject | archive | ban
    reason: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CommentReaction(Base):
    __tablename__ = "comment_reactions"
    comment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("comments.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    kind: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PostTag(Base):
    """People tagged in a post (they are notified and the post shows their names)."""

    __tablename__ = "post_tags"
    post_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)


class SavedPost(Base):
    __tablename__ = "saved_posts"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    post_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class HiddenPost(Base):
    """'Not interested': the post no longer appears in this member's feed."""

    __tablename__ = "hidden_posts"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    post_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PollOption(UUIDPk, Base):
    __tablename__ = "poll_options"
    post_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(150))
    position: Mapped[int] = mapped_column(Integer, default=0)
    vote_count: Mapped[int] = mapped_column(Integer, default=0)


class Poll(Base):
    __tablename__ = "polls"
    post_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True)
    question: Mapped[str] = mapped_column(String(300))
    multiple: Mapped[bool] = mapped_column(Boolean, default=False)
    closes_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    vote_count: Mapped[int] = mapped_column(Integer, default=0)  # people who voted


class PollVote(Base):
    __tablename__ = "poll_votes"
    option_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("poll_options.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    post_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Invitation(UUIDPk, Base):
    """An email invitation to join the alumni network, sent by a member."""

    __tablename__ = "invitations"
    __table_args__ = (UniqueConstraint("inviter_id", "email"),)
    inviter_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    name: Mapped[str | None] = mapped_column(String(150))
    token: Mapped[str] = mapped_column(String(64), unique=True)
    status: Mapped[str] = mapped_column(String(20), default="sent")  # sent | joined
    joined_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
