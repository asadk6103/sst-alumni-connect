"""Redesign phase 4a — events: member proposals, featured, summary, interested, discussion, attendees, files, invites."""

from datetime import UTC, datetime, timedelta

from .conftest import auth
from .test_communities import PDF
from .test_community import _verified
from .test_feed import _connect


def _ev(**extra):
    start = datetime.now(UTC) + timedelta(days=5)
    return {
        "title": "Alumni cricket match",
        "kind": "sports",
        "starts_at": start.isoformat(),
        "ends_at": (start + timedelta(hours=4)).isoformat(),
        "venue": "School ground",
        "highlights": ["Lunch", "Trophies"],
        "agenda": [{"time": "10:00", "title": "Toss"}],
        **extra,
    }


async def test_member_proposal_featured_interest_summary(client, installed):
    a_tok, _ = await _verified(client, installed, "evr-a@example.org", "Asif Event", 2016)
    b_tok, _ = await _verified(client, installed, "evr-b@example.org", "Beena Event", 2016)
    r = await client.post("/api/v1/events", headers=auth(a_tok), json=_ev())
    assert r.status_code == 201, r.text
    ev = r.json()["data"]
    assert ev["status"] == "pending" and ev["organizer"]["type"] == "member" and ev["can_manage"]
    assert ev["highlights"] == ["Lunch", "Trophies"] and ev["agenda"][0]["title"] == "Toss"
    # hidden from others until the office publishes it
    assert (await client.get(f"/api/v1/events/{ev['id']}", headers=auth(b_tok))).status_code == 404
    pending = (await client.get("/api/v1/admin/events?status=pending", headers=auth(installed))).json()["data"]
    assert ev["id"] in [x["id"] for x in pending]
    await client.post(f"/api/v1/admin/events/{ev['id']}/publish", headers=auth(installed))
    full = (await client.get(f"/api/v1/admin/events/{ev['id']}", headers=auth(installed))).json()["data"]
    body = {
        k: full[k] for k in ("title", "kind", "summary", "starts_at", "ends_at", "venue", "is_online", "max_guests", "highlights", "agenda")
    }
    assert (
        await client.put(f"/api/v1/admin/events/{ev['id']}", headers=auth(installed), json={**body, "is_featured": True})
    ).status_code == 200
    feat = (await client.get("/api/v1/events/featured", headers=auth(b_tok))).json()["data"]
    assert ev["id"] in [x["id"] for x in feat]
    # interested + summary + filters
    r = await client.post(f"/api/v1/events/{ev['id']}/interest", headers=auth(b_tok))
    assert r.json()["data"]["interested"] and r.json()["data"]["interested_count"] == 1
    s = (await client.get("/api/v1/events/summary", headers=auth(b_tok))).json()["data"]
    assert s["interested"] == 1 and s["upcoming"] >= 1
    mine = (await client.get("/api/v1/events?scope=interested", headers=auth(b_tok))).json()["data"]
    assert [x["id"] for x in mine] == [ev["id"]]
    kinds = (await client.get("/api/v1/events?kind=sports,webinar", headers=auth(b_tok))).json()["data"]
    assert ev["id"] in [x["id"] for x in kinds]
    await client.delete(f"/api/v1/events/{ev['id']}/interest", headers=auth(b_tok))
    assert (await client.get("/api/v1/events/summary", headers=auth(b_tok))).json()["data"]["interested"] == 0


async def test_discussion_attendees_files_invites(client, installed):
    a_tok, a_id = await _verified(client, installed, "evr2-a@example.org", "Adnan Event", 2016)
    b_tok, b_id = await _verified(client, installed, "evr2-b@example.org", "Bilqis Event", 2016)
    c_tok, _ = await _verified(client, installed, "evr2-c@example.org", "Chanda Event", 2016)
    ev = (await client.post("/api/v1/admin/events", headers=auth(installed), json=_ev(title="Career fair"))).json()["data"]
    await client.post(f"/api/v1/admin/events/{ev['id']}/publish", headers=auth(installed))
    assert (await client.post(f"/api/v1/events/{ev['id']}/register", headers=auth(a_tok), json={})).status_code == 200
    people = (await client.get(f"/api/v1/events/{ev['id']}/attendees", headers=auth(b_tok))).json()["data"]
    assert [p["id"] for p in people] == [a_id]
    c = (await client.post(f"/api/v1/events/{ev['id']}/comments", headers=auth(b_tok), json={"body": "Who else is going?"})).json()["data"]
    listed = (await client.get(f"/api/v1/events/{ev['id']}/comments", headers=auth(a_tok))).json()["data"]
    assert listed[0]["id"] == c["id"] and not listed[0]["can_delete"]
    assert (await client.delete(f"/api/v1/events/{ev['id']}/comments/{c['id']}", headers=auth(a_tok))).status_code == 403
    assert (await client.delete(f"/api/v1/events/{ev['id']}/comments/{c['id']}", headers=auth(b_tok))).status_code == 200
    detail = (await client.get(f"/api/v1/events/{ev['id']}", headers=auth(b_tok))).json()["data"]
    assert detail["comment_count"] == 0 and detail["attending_count"] == 1 and detail["organizer"]["type"] == "office"
    # files: organisers only
    up = {"file": ("agenda.pdf", PDF, "application/pdf")}
    assert (await client.post(f"/api/v1/events/{ev['id']}/files", headers=auth(b_tok), files=up)).status_code == 403
    assert (await client.post(f"/api/v1/events/{ev['id']}/files", headers=auth(installed), files=up)).status_code == 201
    files = (await client.get(f"/api/v1/events/{ev['id']}/files", headers=auth(b_tok))).json()["data"]
    assert [f["filename"] for f in files] == ["agenda.pdf"]
    # invites: connections only
    await _connect(client, a_tok, b_tok, b_id)
    cands = (await client.get(f"/api/v1/events/{ev['id']}/invitable", headers=auth(b_tok))).json()["data"]
    assert cands == []  # A is already going
    await _connect(client, c_tok, b_tok, b_id)
    cands = (await client.get(f"/api/v1/events/{ev['id']}/invitable", headers=auth(b_tok))).json()["data"]
    sent = (
        await client.post(f"/api/v1/events/{ev['id']}/invite", headers=auth(b_tok), json={"user_ids": [x["id"] for x in cands] + [a_id]})
    ).json()
    assert sent["data"]["sent"] == 1
    assert (await client.get(f"/api/v1/events/{ev['id']}", headers=auth(b_tok))).json()["data"]["invited_count"] == 1
