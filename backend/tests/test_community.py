"""Stage 3a — community feed, groups, moderation; messaging, presence and gateway room authorisation."""

import io
import uuid

from PIL import Image

from app.services import live

from .conftest import auth
from .test_alumni import PW, _approve, _member, _relogin


async def _batch(client, admin, name, year):
    r = await client.post("/api/v1/admin/batches", headers=auth(admin), json={"name": name, "graduation_year": year})
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


async def _verified(client, admin, email, name, year, batch_id=None):
    _, uid = await _member(
        client, email, name, graduation_year=year, admission_year=year - 10, **({"batch_id": batch_id} if batch_id else {})
    )
    await _approve(client, admin, uid)
    return await _relogin(client, email), uid


async def test_feed_posts_comments_reactions_and_moderation(client, installed):
    b = await _batch(client, installed, "Class of 2009", 2009)
    a_tok, a_id = await _verified(client, installed, "feed-a@example.org", "Aamir Feed", 2009, b)
    b_tok, b_id = await _verified(client, installed, "feed-b@example.org", "Bushra Feed", 2009, b)
    pending_tok, _ = await _member(client, "feed-pending@example.org", "Pending Feed")
    assert (await client.get("/api/v1/community/feed", headers=auth(pending_tok))).status_code == 403

    live.SENT.clear()
    body = {"body": "Reunion photos coming soon!", "client_key": "k-123"}
    r1 = await client.post("/api/v1/community/posts", headers=auth(a_tok), json=body)
    r2 = await client.post("/api/v1/community/posts", headers=auth(a_tok), json=body)
    assert r1.status_code == 201 and r1.json()["data"]["id"] == r2.json()["data"]["id"]  # idempotent composer
    post_id = r1.json()["data"]["id"]
    assert any(room == "feed:all" and ev == "post:new" for room, ev, _ in live.SENT)
    assert (await client.post("/api/v1/community/posts", headers=auth(a_tok), json={"body": "   "})).status_code == 422

    feed = (await client.get("/api/v1/community/feed", headers=auth(b_tok))).json()
    assert any(p["id"] == post_id for p in feed["data"])
    r = await client.put(f"/api/v1/community/posts/{post_id}/reaction", headers=auth(b_tok), json={"kind": "celebrate"})
    assert r.json()["data"]["reaction_count"] == 1 and r.json()["data"]["reactions"] == {"celebrate": 1}
    r = await client.put(f"/api/v1/community/posts/{post_id}/reaction", headers=auth(b_tok), json={"kind": "love"})
    assert r.json()["data"]["reaction_count"] == 1  # changing a reaction does not add one
    c = (await client.post(f"/api/v1/community/posts/{post_id}/comments", headers=auth(b_tok), json={"body": "Can't wait"})).json()["data"]
    reply = await client.post(
        f"/api/v1/community/posts/{post_id}/comments", headers=auth(a_tok), json={"body": "Soon!", "parent_id": c["id"]}
    )
    assert reply.status_code == 201
    comments = (await client.get(f"/api/v1/community/posts/{post_id}/comments", headers=auth(b_tok))).json()["data"]
    assert comments[0]["replies"][0]["body"] == "Soon!"
    post = (await client.get(f"/api/v1/community/posts/{post_id}", headers=auth(a_tok))).json()["data"]
    assert post["comment_count"] == 2 and post["my_reaction"] is None
    assert (await client.patch(f"/api/v1/community/posts/{post_id}", headers=auth(b_tok), json={"body": "hijack"})).status_code == 403
    assert (await client.patch(f"/api/v1/community/posts/{post_id}", headers=auth(a_tok), json={"body": "Photos are up!"})).json()["data"][
        "edited_at"
    ]

    # photo post, share
    buf = io.BytesIO()
    Image.new("RGB", (800, 500), (16, 35, 68)).save(buf, format="JPEG")
    up = (
        await client.post("/api/v1/community/uploads", headers=auth(a_tok), files={"file": ("p.jpg", buf.getvalue(), "image/jpeg")})
    ).json()["data"]
    r = await client.post("/api/v1/community/posts", headers=auth(b_tok), json={"body": "x", "media_ids": [up["id"]]})
    assert r.status_code == 422  # someone else's upload
    r = await client.post("/api/v1/community/posts", headers=auth(a_tok), json={"body": "", "media_ids": [up["id"]]})
    assert r.status_code == 201 and len(r.json()["data"]["media"]) == 1
    share = await client.post("/api/v1/community/posts", headers=auth(b_tok), json={"body": "Look!", "shared_post_id": post_id})
    assert share.json()["data"]["kind"] == "share" and share.json()["data"]["shared_post"]["id"] == post_id
    assert (await client.get(f"/api/v1/community/posts/{post_id}", headers=auth(a_tok))).json()["data"]["share_count"] == 1

    # announcements are staff-only and pinned ones lead the feed
    assert (await client.post("/api/v1/community/posts", headers=auth(a_tok), json={"body": "x", "announcement": True})).status_code == 403
    ann = (
        await client.post(
            "/api/v1/community/posts", headers=auth(installed), json={"body": "Annual reunion on 20 Dec", "announcement": True}
        )
    ).json()["data"]
    r = await client.post(f"/api/v1/admin/community/posts/{ann['id']}/moderate", headers=auth(installed), json={"action": "pin"})
    assert r.status_code == 200
    feed = (await client.get("/api/v1/community/feed", headers=auth(b_tok))).json()
    assert feed["meta"]["pinned"][0]["id"] == ann["id"] and all(p["id"] != ann["id"] for p in feed["data"])

    # report → moderator hides → author sees it hidden, others cannot open it
    r = await client.post(
        "/api/v1/community/reports", headers=auth(b_tok), json={"target_type": "post", "target_id": post_id, "reason": "spam"}
    )
    assert r.status_code == 201
    assert (
        await client.post(
            "/api/v1/community/reports", headers=auth(b_tok), json={"target_type": "post", "target_id": post_id, "reason": "spam"}
        )
    ).status_code == 409
    reports = (await client.get("/api/v1/admin/community/reports", headers=auth(installed))).json()["data"]
    assert reports[0]["target_id"] == post_id and reports[0]["post"]["id"] == post_id
    r = await client.post(
        f"/api/v1/admin/community/reports/post/{post_id}", headers=auth(installed), json={"action": "hide", "reason": "Off-topic"}
    )
    assert r.status_code == 200
    assert (await client.get(f"/api/v1/community/posts/{post_id}", headers=auth(b_tok))).status_code == 404
    mine = (await client.get(f"/api/v1/community/posts/{post_id}", headers=auth(a_tok))).json()["data"]
    assert mine["status"] == "hidden" and mine["moderation_reason"] == "Off-topic"
    log = (await client.get("/api/v1/admin/community/moderation-log", headers=auth(installed))).json()["data"]
    assert any(x["action"] == "hide" for x in log)
    # comment delete adjusts the count
    # the commenter can no longer reach the hidden post; its author can still remove comments on it
    assert (await client.delete(f"/api/v1/community/comments/{c['id']}", headers=auth(b_tok))).status_code == 404
    assert (await client.delete(f"/api/v1/community/comments/{c['id']}", headers=auth(a_tok))).status_code == 200


async def test_groups_batch_communities_and_forums(client, installed):
    b1 = await _batch(client, installed, "Class of 2011", 2011)
    b2 = await _batch(client, installed, "Class of 2013", 2013)
    a_tok, _ = await _verified(client, installed, "grp-a@example.org", "Asma Group", 2011, b1)
    c_tok, _ = await _verified(client, installed, "grp-c@example.org", "Cyrus Group", 2013, b2)
    mine = (await client.get("/api/v1/community/groups", headers=auth(a_tok))).json()["data"]
    batch_group = next(g for g in mine if g["kind"] == "batch")
    assert batch_group["name"] == "Class of 2011 community" and batch_group["membership"]["status"] == "active"
    p = (
        await client.post("/api/v1/community/posts", headers=auth(a_tok), json={"body": "Batch only", "group_id": batch_group["id"]})
    ).json()["data"]
    assert (await client.get(f"/api/v1/community/posts/{p['id']}", headers=auth(c_tok))).status_code == 404  # private batch group
    assert all(x["id"] != p["id"] for x in (await client.get("/api/v1/community/feed", headers=auth(c_tok))).json()["data"])
    assert (await client.post(f"/api/v1/community/groups/{batch_group['id']}/join", headers=auth(c_tok))).status_code == 409

    # member-proposed forum waits for approval; topics need titles
    g = (await client.post("/api/v1/community/groups", headers=auth(a_tok), json={"name": "Medicine careers", "kind": "forum"})).json()[
        "data"
    ]
    assert g["status"] == "pending"
    assert (await client.post(f"/api/v1/community/groups/{g['id']}/join", headers=auth(c_tok))).status_code == 409
    pending = (await client.get("/api/v1/admin/community/groups?status=pending", headers=auth(installed))).json()["data"]
    assert any(x["id"] == g["id"] for x in pending)
    await client.post(f"/api/v1/admin/community/groups/{g['id']}/decide", headers=auth(installed), json={"action": "approve"})
    assert (await client.post(f"/api/v1/community/groups/{g['id']}/join", headers=auth(c_tok))).json()["data"]["membership"][
        "status"
    ] == "active"
    assert (await client.post("/api/v1/community/posts", headers=auth(c_tok), json={"body": "Q", "group_id": g["id"]})).status_code == 422
    t = await client.post(
        "/api/v1/community/posts", headers=auth(c_tok), json={"title": "MCAT prep?", "body": "Tips?", "group_id": g["id"]}
    )
    assert t.status_code == 201
    assert (await client.get(f"/api/v1/community/feed?group_id={g['id']}", headers=auth(a_tok))).json()["data"][0]["title"] == "MCAT prep?"
    # the owner can make a member moderator; the last owner cannot leave
    assert (await client.post(f"/api/v1/community/groups/{g['id']}/leave", headers=auth(a_tok))).status_code == 409
    members = (await client.get(f"/api/v1/community/groups/{g['id']}/members", headers=auth(a_tok))).json()["data"]
    cyrus = next(m for m in members if m["user"]["full_name"] == "Cyrus Group")
    r = await client.post(
        f"/api/v1/community/groups/{g['id']}/members/{cyrus['user']['id']}", headers=auth(a_tok), json={"action": "make_moderator"}
    )
    assert r.status_code == 200
    assert (await client.post(f"/api/v1/community/groups/{g['id']}/leave", headers=auth(a_tok))).status_code == 200


async def test_messaging_rules_idempotency_receipts_blocks(client, installed):
    b = await _batch(client, installed, "Class of 2016", 2016)
    a_tok, a_id = await _verified(client, installed, "msg-a@example.org", "Adeel Chat", 2016, b)
    b_tok, b_id = await _verified(client, installed, "msg-b@example.org", "Bina Chat", 2016, b)
    c_tok, c_id = await _verified(client, installed, "msg-c@example.org", "Chand Chat", 2001)
    # strangers (no connection, different batch) cannot open a chat
    assert (await client.post("/api/v1/messages/conversations/direct", headers=auth(c_tok), json={"user_id": a_id})).status_code == 403
    conv = (await client.post("/api/v1/messages/conversations/direct", headers=auth(a_tok), json={"user_id": b_id})).json()["data"]
    again = (await client.post("/api/v1/messages/conversations/direct", headers=auth(b_tok), json={"user_id": a_id})).json()["data"]
    assert conv["id"] == again["id"]  # one conversation per pair
    cid = conv["id"]

    live.SENT.clear()
    body = {"body": "Salam! Coming to the reunion?", "client_id": "dev1-0001"}
    m1 = await client.post(f"/api/v1/messages/conversations/{cid}/messages", headers=auth(a_tok), json=body)
    m2 = await client.post(f"/api/v1/messages/conversations/{cid}/messages", headers=auth(a_tok), json=body)
    assert m1.status_code == m2.status_code == 201 and m1.json()["data"]["id"] == m2.json()["data"]["id"]
    assert m1.json()["data"]["status"] == "sent"
    assert sum(1 for room, ev, _ in live.SENT if ev == "message:new" and room == f"user:{b_id}") == 1
    assert (await client.get("/api/v1/messages/unread", headers=auth(b_tok))).json()["data"]["total"] == 1
    # outsider cannot read the conversation
    assert (await client.get(f"/api/v1/messages/conversations/{cid}/messages", headers=auth(c_tok))).status_code == 404
    msgs = (await client.get(f"/api/v1/messages/conversations/{cid}/messages", headers=auth(b_tok))).json()["data"]
    assert len(msgs) == 1
    await client.post(f"/api/v1/messages/conversations/{cid}/delivered", headers=auth(b_tok), json={})
    mine = (await client.get(f"/api/v1/messages/conversations/{cid}/messages", headers=auth(a_tok))).json()["data"]
    assert mine[0]["status"] == "delivered"
    await client.post(f"/api/v1/messages/conversations/{cid}/read", headers=auth(b_tok), json={})
    mine = (await client.get(f"/api/v1/messages/conversations/{cid}/messages", headers=auth(a_tok))).json()["data"]
    assert mine[0]["status"] == "read"
    assert (await client.get("/api/v1/messages/unread", headers=auth(b_tok))).json()["data"]["total"] == 0
    # reply, edit, delete, reaction
    reply = (
        await client.post(
            f"/api/v1/messages/conversations/{cid}/messages", headers=auth(b_tok), json={"body": "Yes!", "reply_to_id": mine[0]["id"]}
        )
    ).json()["data"]
    assert reply["reply_to"]["id"] == mine[0]["id"]
    r = await client.patch(f"/api/v1/messages/{reply['id']}", headers=auth(a_tok), json={"body": "x"})
    assert r.status_code == 403, r.text
    r = await client.patch(f"/api/v1/messages/{reply['id']}", headers=auth(b_tok), json={"body": "Yes, inshallah!"})
    assert r.status_code == 200 and r.json()["data"]["edited_at"], r.text
    r = await client.put(f"/api/v1/messages/{reply['id']}/reactions/%F0%9F%91%8D", headers=auth(a_tok))
    assert r.json()["data"]["reactions"][0]["count"] == 1
    assert (await client.delete(f"/api/v1/messages/{reply['id']}", headers=auth(b_tok))).json()["data"]["deleted"]

    # private attachment: only members can download
    pdf = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
    att = (
        await client.post("/api/v1/messages/uploads", headers=auth(a_tok), files={"file": ("agenda.pdf", pdf, "application/pdf")})
    ).json()["data"]
    sent = (
        await client.post(f"/api/v1/messages/conversations/{cid}/messages", headers=auth(a_tok), json={"attachment_ids": [att["id"]]})
    ).json()["data"]
    assert sent["attachments"], sent
    url = sent["attachments"][0]["url"]
    assert (await client.get(url, headers=auth(b_tok))).status_code == 200
    assert (await client.get(url, headers=auth(c_tok))).status_code == 404

    # group chat; blocking stops direct messages both ways
    g = (
        await client.post("/api/v1/messages/conversations/group", headers=auth(a_tok), json={"title": "Reunion team", "member_ids": [b_id]})
    ).json()["data"]
    assert g["kind"] == "group" and len(g["members"]) == 2 and g["is_admin"]
    assert (
        await client.post(f"/api/v1/messages/conversations/{g['id']}/members", headers=auth(b_tok), json={"user_ids": [c_id]})
    ).status_code == 403
    convs = (await client.get("/api/v1/messages/conversations?q=reunion", headers=auth(b_tok))).json()["data"]
    assert any(x["id"] == g["id"] for x in convs)
    await client.put(f"/api/v1/messages/blocks/{a_id}", headers=auth(b_tok))
    r = await client.post(f"/api/v1/messages/conversations/{cid}/messages", headers=auth(a_tok), json={"body": "hello?"})
    assert r.status_code == 403
    await client.delete(f"/api/v1/messages/blocks/{a_id}", headers=auth(b_tok))
    assert (
        await client.post(f"/api/v1/messages/conversations/{cid}/messages", headers=auth(a_tok), json={"body": "hello?"})
    ).status_code == 201


async def test_presence_multi_device():
    from app.modules.messaging import service as msg

    uid = uuid.uuid4()
    assert await msg.presence_connect(uid, "sid-phone", 60) is True  # first device: comes online
    assert await msg.presence_connect(uid, "sid-laptop", 60) is False
    assert await msg.presence_disconnect(uid, "sid-phone") is False  # laptop still connected
    assert await msg.is_online(uid)
    assert await msg.presence_disconnect(uid, "sid-laptop") is True  # last device: offline
    assert not await msg.is_online(uid) and await msg.last_seen(uid)
    # an expired connection (crashed gateway) does not keep a member online
    from app.core.redis import redis

    await msg.presence_connect(uid, "sid-ghost", 60)
    await redis().delete("presence:conn:sid-ghost")
    assert not await msg.is_online(uid)


async def test_gateway_room_authorisation(client, installed, monkeypatch):
    from app import realtime
    from app.core.db import SessionLocal
    from app.models import Session as DbSession

    b = await _batch(client, installed, "Class of 2017", 2017)
    tok, uid = await _verified(client, installed, "gw-a@example.org", "Gul Gateway", 2017, b)
    other_tok, other_id = await _verified(client, installed, "gw-b@example.org", "Hamid Gateway", 2002)
    async with SessionLocal() as db:
        from sqlalchemy import select

        sess = (
            (
                await db.execute(
                    select(DbSession)
                    .where(DbSession.user_id == uuid.UUID(uid), DbSession.revoked_at.is_(None))
                    .order_by(DbSession.created_at.desc())
                )
            )
            .scalars()
            .first()
        )
    joined: list[str] = []

    async def get_session(sid):
        return {"user_id": uid, "session_id": str(sess.id)}

    async def enter_room(sid, room):
        joined.append(room)

    monkeypatch.setattr(realtime.sio, "get_session", get_session)
    monkeypatch.setattr(realtime.sio, "enter_room", enter_room)
    monkeypatch.setattr(realtime.sio, "rooms", lambda sid: [sid, f"user:{uid}", *joined])
    assert (await realtime.subscribe("s1", {"room": "feed:all"}))["ok"]
    assert (await realtime.subscribe("s1", {"room": f"batch:{b}"}))["ok"]
    assert not (await realtime.subscribe("s1", {"room": f"user:{other_id}"}))["ok"]  # someone else's private room
    assert not (await realtime.subscribe("s1", {"room": "admin:super_admin"}))["ok"]
    assert not (await realtime.subscribe("s1", {"room": f"conversation:{uuid.uuid4()}"}))["ok"]
    assert not (await realtime.subscribe("s1", {"room": "nonsense"}))["ok"]
    # message:send over the socket persists, then acknowledges; a revoked session is refused
    conv = (await client.post("/api/v1/messages/conversations/direct", headers=auth(installed), json={"user_id": uid})).json()["data"]
    assert (await realtime.subscribe("s1", {"room": f"conversation:{conv['id']}"}))["ok"]
    ack = await realtime.message_send("s1", {"conversation_id": conv["id"], "body": "via socket", "client_id": "sock-1"})
    assert ack["ok"] and ack["message"]["body"] == "via socket"
    ack2 = await realtime.message_send("s1", {"conversation_id": conv["id"], "body": "via socket", "client_id": "sock-1"})
    assert ack2["message"]["id"] == ack["message"]["id"]
    await client.post("/api/v1/auth/logout-all", headers=auth(tok))
    from app.core import deps

    deps.forget_principals()
    assert (await realtime.message_send("s1", {"conversation_id": conv["id"], "body": "x"}))["error"] == "unauthenticated"
    _ = (other_tok, PW)
