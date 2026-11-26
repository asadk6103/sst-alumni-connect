"""Redesign phase 5 — messages: starred conversations and the All / Unread / Starred filter."""

from .conftest import auth
from .test_community import _verified
from .test_feed import _connect


async def test_starred_and_unread_filters(client, installed):
    a_tok, a_id = await _verified(client, installed, "msgr-a@example.org", "Anum Messages", 2015)
    b_tok, b_id = await _verified(client, installed, "msgr-b@example.org", "Burhan Messages", 2015)
    c_tok, c_id = await _verified(client, installed, "msgr-c@example.org", "Cheena Messages", 2015)
    await _connect(client, a_tok, b_tok, b_id)
    await _connect(client, a_tok, c_tok, c_id)
    ab = (await client.post("/api/v1/messages/conversations/direct", headers=auth(a_tok), json={"user_id": b_id})).json()["data"]
    ac = (await client.post("/api/v1/messages/conversations/direct", headers=auth(a_tok), json={"user_id": c_id})).json()["data"]
    await client.post(f"/api/v1/messages/conversations/{ab['id']}/messages", headers=auth(b_tok), json={"body": "Hi Anum"})
    await client.post(f"/api/v1/messages/conversations/{ac['id']}/messages", headers=auth(a_tok), json={"body": "Hi Cheena"})
    unread = (await client.get("/api/v1/messages/conversations?filter=unread", headers=auth(a_tok))).json()["data"]
    assert [c["id"] for c in unread] == [ab["id"]]
    r = await client.put(f"/api/v1/messages/conversations/{ac['id']}/settings", headers=auth(a_tok), json={"starred": True})
    assert r.json()["data"]["starred"] is True
    starred = (await client.get("/api/v1/messages/conversations?filter=starred", headers=auth(a_tok))).json()["data"]
    assert [c["id"] for c in starred] == [ac["id"]] and starred[0]["starred"] is True
    everything = (await client.get("/api/v1/messages/conversations", headers=auth(a_tok))).json()["data"]
    assert {c["id"] for c in everything} >= {ab["id"], ac["id"]}
