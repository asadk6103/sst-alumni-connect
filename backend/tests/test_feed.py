"""Redesign phase 1 — rich posts (polls, audience, drafts, saved, hidden, tags, mentions), feed tabs, search, invitations."""

from app import worker

from .conftest import auth
from .test_alumni import PW
from .test_community import _batch, _verified


async def _connect(client, a_tok, b_tok, b_id):
    await client.post("/api/v1/alumni/connections", headers=auth(a_tok), json={"user_id": b_id})
    req = (await client.get("/api/v1/alumni/connections?type=received", headers=auth(b_tok))).json()["data"][0]["request_id"]
    await client.post(f"/api/v1/alumni/connections/{req}/accept", headers=auth(b_tok))


async def test_polls_audience_drafts_saved_hidden(client, installed):
    b = await _batch(client, installed, "Feed batch 2017", 2017)
    a_tok, a_id = await _verified(client, installed, "feed2-a@example.org", "Areeba Feed", 2017, b)
    b_tok, b_id = await _verified(client, installed, "feed2-b@example.org", "Basil Feed", 2017, b)
    c_tok, _ = await _verified(client, installed, "feed2-c@example.org", "Cyra Feed", 2003)
    await _connect(client, a_tok, b_tok, b_id)

    # poll
    bad = await client.post("/api/v1/community/posts", headers=auth(a_tok), json={"kind": "poll", "body": "?"})
    assert bad.status_code == 422
    poll = (
        await client.post(
            "/api/v1/community/posts",
            headers=auth(a_tok),
            json={
                "kind": "poll",
                "body": "Reunion venue?",
                "poll": {"question": "Where should we meet?", "options": ["Campus", "Hotel", "Online"]},
            },
        )
    ).json()["data"]
    opts = poll["poll"]["options"]
    assert len(opts) == 3 and poll["poll"]["voters"] == 0
    r = (await client.put(f"/api/v1/community/posts/{poll['id']}/vote", headers=auth(b_tok), json={"option_ids": [opts[0]["id"]]})).json()[
        "data"
    ]
    assert r["options"][0]["votes"] == 1 and r["my_votes"] == [opts[0]["id"]] and r["voters"] == 1
    r = (await client.put(f"/api/v1/community/posts/{poll['id']}/vote", headers=auth(b_tok), json={"option_ids": [opts[1]["id"]]})).json()[
        "data"
    ]
    assert r["options"][0]["votes"] == 0 and r["options"][1]["votes"] == 1 and r["voters"] == 1  # vote changed, not added
    assert (
        await client.put(
            f"/api/v1/community/posts/{poll['id']}/vote", headers=auth(b_tok), json={"option_ids": [opts[0]["id"], opts[1]["id"]]}
        )
    ).status_code == 422  # single choice

    # connections-only post: visible to B (connection), not to C
    private = (
        await client.post(
            "/api/v1/community/posts",
            headers=auth(a_tok),
            json={
                "body": "Just for my connections",
                "audience": "connections",
                "location": "Lahore, PK",
                "feeling": "grateful",
                "topics": ["#Reunion", "Campus"],
            },
        )
    ).json()["data"]
    assert private["audience"] == "connections" and private["topics"] == ["Reunion", "Campus"]
    feed_b = [x["id"] for x in (await client.get("/api/v1/community/feed", headers=auth(b_tok))).json()["data"]]
    feed_c = [x["id"] for x in (await client.get("/api/v1/community/feed", headers=auth(c_tok))).json()["data"]]
    assert private["id"] in feed_b and private["id"] not in feed_c
    assert (await client.get(f"/api/v1/community/posts/{private['id']}", headers=auth(c_tok))).status_code == 404

    # batch tab: C (other batch) is not in A's batch feed
    batch_b = [x["id"] for x in (await client.get("/api/v1/community/feed?filter=batch", headers=auth(b_tok))).json()["data"]]
    assert poll["id"] in batch_b
    assert (await client.get("/api/v1/community/feed?sort=relevant", headers=auth(b_tok))).status_code == 200

    # drafts are private until published
    d = (await client.post("/api/v1/community/posts", headers=auth(a_tok), json={"body": "Draft text", "draft": True})).json()["data"]
    assert d["status"] == "draft" and d["id"] not in [
        x["id"] for x in (await client.get("/api/v1/community/feed", headers=auth(b_tok))).json()["data"]
    ]
    assert [x["id"] for x in (await client.get("/api/v1/community/drafts", headers=auth(a_tok))).json()["data"]] == [d["id"]]
    assert (await client.get(f"/api/v1/community/posts/{d['id']}", headers=auth(b_tok))).status_code == 404
    assert (await client.post(f"/api/v1/community/posts/{d['id']}/publish", headers=auth(a_tok))).json()["data"]["status"] == "published"

    # save / unsave, hide / unhide
    await client.put(f"/api/v1/community/posts/{poll['id']}/save", headers=auth(b_tok))
    saved = (await client.get("/api/v1/community/saved", headers=auth(b_tok))).json()["data"]
    assert [x["id"] for x in saved] == [poll["id"]] and saved[0]["saved"] is True
    await client.delete(f"/api/v1/community/posts/{poll['id']}/save", headers=auth(b_tok))
    assert (await client.get("/api/v1/community/saved", headers=auth(b_tok))).json()["data"] == []
    await client.put(f"/api/v1/community/posts/{poll['id']}/hide", headers=auth(b_tok))
    assert poll["id"] not in [x["id"] for x in (await client.get("/api/v1/community/feed", headers=auth(b_tok))).json()["data"]]
    await client.delete(f"/api/v1/community/posts/{poll['id']}/hide", headers=auth(b_tok))
    assert poll["id"] in [x["id"] for x in (await client.get("/api/v1/community/feed", headers=auth(b_tok))).json()["data"]]


async def test_tags_mentions_comment_reactions(client, installed):
    a_tok, a_id = await _verified(client, installed, "tag-a@example.org", "Adil Tag", 2018)
    b_tok, b_id = await _verified(client, installed, "tag-b@example.org", "Bina Tag", 2018)
    post = (
        await client.post(
            "/api/v1/community/posts",
            headers=auth(a_tok),
            json={"kind": "achievement", "title": "Promoted!", "body": "Started as Project Director", "tagged_ids": [b_id]},
        )
    ).json()["data"]
    assert post["kind"] == "achievement" and post["tagged"][0]["id"] == b_id
    kinds = [n["kind"] for n in (await client.get("/api/v1/notifications?category=mentions", headers=auth(b_tok))).json()["data"]]
    assert "post_tag" in kinds
    c = (
        await client.post(
            f"/api/v1/community/posts/{post['id']}/comments",
            headers=auth(b_tok),
            json={"body": "Congrats @Adil Tag!", "mention_ids": [a_id]},
        )
    ).json()["data"]
    assert c["mentions"][0]["id"] == a_id
    kinds = [n["kind"] for n in (await client.get("/api/v1/notifications?category=mentions", headers=auth(a_tok))).json()["data"]]
    assert "comment_mention" in kinds  # mention wins over the plain "commented on your post"
    r = (await client.put(f"/api/v1/community/comments/{c['id']}/reaction", headers=auth(a_tok), json={"kind": "haha"})).json()["data"]
    assert r["reactions"] == {"haha": 1} and r["my_reaction"] == "haha"
    r = (await client.delete(f"/api/v1/community/comments/{c['id']}/reaction", headers=auth(a_tok))).json()["data"]
    assert r["reaction_count"] == 0
    assert (
        await client.put(f"/api/v1/community/posts/{post['id']}/reaction", headers=auth(b_tok), json={"kind": "haha"})
    ).status_code == 200


async def test_global_search_and_invitations(client, installed):
    a_tok, _ = await _verified(client, installed, "search-a@example.org", "Saima Searcher", 2019)
    await _verified(client, installed, "search-b@example.org", "Zubair Findable", 2019)
    await client.post("/api/v1/community/posts", headers=auth(a_tok), json={"body": "Cricket match this Friday"})
    res = (await client.get("/api/v1/search?q=Zubair", headers=auth(a_tok))).json()["data"]
    assert any(x["full_name"] == "Zubair Findable" for x in res["alumni"])
    res = (await client.get("/api/v1/search?q=cricket", headers=auth(a_tok))).json()["data"]
    assert res["posts"] and res["posts"][0]["excerpt"].startswith("Cricket")

    worker.TEST_OUTBOX.clear()
    r = await client.post(
        "/api/v1/invitations",
        headers=auth(a_tok),
        json={"emails": ["new-friend@example.org", "search-b@example.org"], "message": "Join us!"},
    )
    assert r.status_code == 201 and r.json()["meta"]["queued"] == 1  # existing members are skipped silently
    mails = [p for n, p in worker.TEST_OUTBOX if n == "app.tasks.send_email" and "invited you" in p.get("subject", "")]
    assert len(mails) == 1 and mails[0]["to"] == "new-friend@example.org"
    token = mails[0]["html"].split("invite=")[1].split("&")[0]
    await client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "New Friend",
            "email": "new-friend@example.org",
            "phone": "+92 300 1112233",
            "password": PW,
            "accept_terms": True,
            "graduation_year": 2019,
            "admission_year": 2009,
            "city": "Lahore",
            "country": "Pakistan",
            "invite": token,
        },
    )
    inv = (await client.get("/api/v1/invitations", headers=auth(a_tok))).json()["data"]
    assert inv[0]["status"] == "joined"
    assert any(n["kind"] == "invite_joined" for n in (await client.get("/api/v1/notifications", headers=auth(a_tok))).json()["data"])
