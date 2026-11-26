"""Redesign phase 3 — communities: categories, notification level, announcements, files, trending, events, invites."""

from datetime import UTC, datetime, timedelta

from .conftest import auth
from .test_community import _verified
from .test_feed import _connect

PDF = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"


async def _group(client, admin, tok, name, **extra):
    g = (await client.post("/api/v1/community/groups", headers=auth(tok), json={"name": name, **extra})).json()["data"]
    await client.post(f"/api/v1/admin/community/groups/{g['id']}/decide", headers=auth(admin), json={"action": "approve"})
    return g


async def test_categories_notify_announcements_files_trending(client, installed):
    a_tok, _ = await _verified(client, installed, "comm-a@example.org", "Asma Community", 2018)
    b_tok, _ = await _verified(client, installed, "comm-b@example.org", "Basit Community", 2018)
    g = await _group(client, installed, a_tok, "Software engineers circle", category="professional")
    rows = (await client.get("/api/v1/community/groups?scope=all&category=professional", headers=auth(b_tok))).json()["data"]
    assert [x["id"] for x in rows if x["id"] == g["id"]] and all(x["category"] == "professional" for x in rows)
    joined = (await client.post(f"/api/v1/community/groups/{g['id']}/join", headers=auth(b_tok))).json()["data"]
    assert joined["membership"]["notify"] == "all"
    # B only wants highlights: an ordinary post does not notify, an announcement does
    r = await client.post(f"/api/v1/community/groups/{g['id']}/notify", headers=auth(b_tok), json={"level": "highlights"})
    assert r.json()["data"]["notify"] == "highlights"
    before = (await client.get("/api/v1/notifications/unread-count", headers=auth(b_tok))).json()["data"]["unread"]
    await client.post("/api/v1/community/posts", headers=auth(a_tok), json={"body": "Weekly thread", "group_id": g["id"]})
    ann = {"body": "Meetup on Friday", "group_id": g["id"], "announcement": True}
    assert (await client.post("/api/v1/community/posts", headers=auth(a_tok), json=ann)).status_code == 201
    after = (await client.get("/api/v1/notifications/unread-count", headers=auth(b_tok))).json()["data"]["unread"]
    assert after == before + 1
    # members cannot announce
    assert (await client.post("/api/v1/community/posts", headers=auth(b_tok), json={**ann, "body": "x"})).status_code == 403
    # documents: allowed in communities, not on the main feed
    up = await client.post("/api/v1/community/uploads", headers=auth(b_tok), files={"file": ("notes.pdf", PDF, "application/pdf")})
    assert up.status_code == 201, up.text
    doc = up.json()["data"]
    assert doc["mime"] == "application/pdf"
    assert (
        await client.post("/api/v1/community/posts", headers=auth(b_tok), json={"body": "x", "media_ids": [doc["id"]]})
    ).status_code == 422
    post = (
        await client.post(
            "/api/v1/community/posts", headers=auth(b_tok), json={"body": "Notes", "group_id": g["id"], "media_ids": [doc["id"]]}
        )
    ).json()["data"]
    assert post["media"][0]["filename"] == "notes.pdf"
    files = (await client.get(f"/api/v1/community/groups/{g['id']}/files", headers=auth(a_tok))).json()["data"]
    assert [f["filename"] for f in files] == ["notes.pdf"]
    await client.post(f"/api/v1/community/posts/{post['id']}/comments", headers=auth(a_tok), json={"body": "Thanks!"})
    trending = (await client.get("/api/v1/community/trending", headers=auth(a_tok))).json()["data"]
    assert trending[0]["post_id"] == post["id"] and trending[0]["comment_count"] == 1


async def test_private_events_overview_and_invites(client, installed):
    a_tok, a_id = await _verified(client, installed, "inv-a@example.org", "Ali Invite", 2019)
    b_tok, b_id = await _verified(client, installed, "inv-b@example.org", "Bano Invite", 2019)
    c_tok, _ = await _verified(client, installed, "inv-c@example.org", "Chaudhry Invite", 2019)
    g = await _group(client, installed, a_tok, "Reunion organisers", join_policy="approval", category="events")
    start = datetime.now(UTC) + timedelta(days=10)
    ev = {
        "title": "Organisers dinner",
        "kind": "reunion",
        "starts_at": start.isoformat(),
        "ends_at": (start + timedelta(hours=3)).isoformat(),
        "venue": "Campus hall",
    }
    assert (await client.post(f"/api/v1/community/groups/{g['id']}/events", headers=auth(c_tok), json=ev)).status_code == 403
    r = await client.post(f"/api/v1/community/groups/{g['id']}/events", headers=auth(a_tok), json=ev)
    assert r.status_code == 201, r.text
    event = r.json()["data"]
    assert event["group"]["id"] == g["id"] and event["status"] == "published"
    # private community: its events are hidden from non-members
    listed = (await client.get("/api/v1/events?scope=upcoming", headers=auth(c_tok))).json()["data"]
    assert event["id"] not in [e["id"] for e in listed]
    assert (await client.get(f"/api/v1/events/{event['id']}", headers=auth(c_tok))).status_code == 404
    ov = (await client.get(f"/api/v1/community/groups/{g['id']}/overview", headers=auth(a_tok))).json()["data"]
    assert ov["events"] == 1 and ov["admins"] == 1 and ov["upcoming_events"][0]["id"] == event["id"] and ov["member_faces"]
    # invites: only connections can be invited; accepting skips the join approval
    await _connect(client, a_tok, b_tok, b_id)
    cands = (await client.get(f"/api/v1/community/groups/{g['id']}/invitable", headers=auth(a_tok))).json()["data"]
    assert [x["id"] for x in cands] == [b_id]
    sent = (await client.post(f"/api/v1/community/groups/{g['id']}/invites", headers=auth(a_tok), json={"user_ids": [b_id]})).json()
    assert sent["data"]["sent"] == 1
    assert (
        await client.post(f"/api/v1/community/groups/{g['id']}/invites", headers=auth(c_tok), json={"user_ids": [a_id]})
    ).status_code == 403
    invites = (await client.get("/api/v1/community/group-invites", headers=auth(b_tok))).json()["data"]
    assert invites[0]["group"]["id"] == g["id"] and invites[0]["inviter"]["id"] == a_id
    joined = (await client.post(f"/api/v1/community/group-invites/{invites[0]['id']}/accept", headers=auth(b_tok))).json()["data"]
    assert joined["membership"]["status"] == "active" and joined["member_count"] == 2
    listed = (await client.get("/api/v1/events?scope=upcoming", headers=auth(b_tok))).json()["data"]
    assert event["id"] in [e["id"] for e in listed]
