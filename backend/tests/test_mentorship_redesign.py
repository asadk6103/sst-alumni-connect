"""Redesign phase 4c — mentorship: categories, summary, sessions list, mentee profiles and mentor offers."""

from datetime import UTC, datetime, timedelta

from .conftest import auth
from .test_community import _verified

PROFILE = {
    "industry": "Technology",
    "expertise": ["Backend", "Career planning"],
    "formats": ["video"],
    "max_mentees": 2,
    "introduction": "I run engineering at a fintech and enjoy helping alumni grow their careers.",
    "categories": ["career", "technology"],
}


async def test_categories_mentee_profiles_offers_summary(client, installed):
    m_tok, m_id = await _verified(client, installed, "mentr-m@example.org", "Mahnoor Mentor", 2005)
    a_tok, a_id = await _verified(client, installed, "mentr-a@example.org", "Arham Mentee", 2018)
    b_tok, _ = await _verified(client, installed, "mentr-b@example.org", "Bisma Mentee", 2018)
    assert (await client.put("/api/v1/mentorship/me", headers=auth(m_tok), json=PROFILE)).status_code == 200
    await client.post(f"/api/v1/admin/mentorship/mentors/{m_id}/decide", headers=auth(installed), json={"approve": True})
    found = (await client.get("/api/v1/mentorship/mentors?category=technology", headers=auth(a_tok))).json()["data"]
    row = next(x for x in found if x["user"]["id"] == m_id)
    assert row["categories"] == ["career", "technology"] and row["mentee_count"] == 0
    assert m_id not in [
        x["user"]["id"] for x in (await client.get("/api/v1/mentorship/mentors?category=leadership", headers=auth(a_tok))).json()["data"]
    ]
    # A is looking for a mentor; B is not
    r = await client.put(
        "/api/v1/mentorship/mentee/me", headers=auth(a_tok), json={"areas": ["career"], "goals": "Move into backend engineering"}
    )
    assert r.json()["data"]["looking"] is True
    await client.put("/api/v1/mentorship/mentee/me", headers=auth(b_tok), json={"looking": False})
    assert (await client.get("/api/v1/mentorship/mentees", headers=auth(b_tok))).status_code == 403  # not a mentor
    seen = (await client.get("/api/v1/mentorship/mentees?category=career", headers=auth(m_tok))).json()["data"]
    assert [x["user"]["id"] for x in seen] == [a_id]
    # mentor offers; only the mentee may answer
    o = (await client.post(f"/api/v1/mentorship/mentees/{a_id}/offer", headers=auth(m_tok), json={"topic": "Backend career"})).json()[
        "data"
    ]
    assert o["initiated_by"] == "mentor" and o["status"] == "pending"
    dup = await client.post(f"/api/v1/mentorship/mentees/{a_id}/offer", headers=auth(m_tok), json={"topic": "Again"})
    assert dup.status_code == 409
    assert (
        await client.post(f"/api/v1/mentorship/requests/{o['id']}/respond", headers=auth(m_tok), json={"accept": True})
    ).status_code == 403
    mine = (await client.get("/api/v1/mentorship/requests", headers=auth(a_tok))).json()["data"]
    assert mine[0]["awaiting_me"] is True
    assert (await client.get("/api/v1/mentorship/summary", headers=auth(a_tok))).json()["data"]["awaiting"] == 1
    ok = await client.post(f"/api/v1/mentorship/requests/{o['id']}/respond", headers=auth(a_tok), json={"accept": True})
    assert ok.json()["data"]["status"] == "accepted"
    # sessions + summary
    when = (datetime.now(UTC) + timedelta(days=3)).isoformat()
    s = await client.post(
        f"/api/v1/mentorship/requests/{o['id']}/sessions",
        headers=auth(m_tok),
        json={"scheduled_at": when, "format": "video", "location": "https://meet.example.org/x"},
    )
    assert s.status_code == 201, s.text
    up = (await client.get("/api/v1/mentorship/sessions", headers=auth(a_tok))).json()["data"]
    assert up[0]["topic"] == "Backend career" and up[0]["with"]["id"] == m_id and up[0]["role"] == "mentee"
    sm = (await client.get("/api/v1/mentorship/summary", headers=auth(m_tok))).json()["data"]
    assert sm == {"sessions": 1, "as_mentee": 0, "as_mentor": 1, "awaiting": 0}
