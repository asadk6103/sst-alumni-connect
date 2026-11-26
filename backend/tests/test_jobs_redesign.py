"""Redesign phase 4b — jobs: structured details, employer profile, alerts, activity, similar jobs, referrals."""

from .conftest import auth
from .test_community import _verified


def _job(**extra):
    return {
        "title": "Backend Engineer",
        "organization": "Acme Analytics",
        "employment_type": "full_time",
        "location": "Lahore, Pakistan",
        "experience": "3+ years",
        "description": "Build and run the data platform for our clients across the region.",
        "responsibilities": ["Design APIs", " ", "Own on-call"],
        "requirements": ["Python", "SQL"],
        "benefits": ["Health Insurance", "Flexible Work"],
        **extra,
    }


async def test_alerts_structured_details_similar(client, installed):
    a_tok, _ = await _verified(client, installed, "jobr-a@example.org", "Ayesha Jobs", 2014)
    b_tok, _ = await _verified(client, installed, "jobr-b@example.org", "Bilal Jobs", 2014)
    # B wants remote-friendly Python roles; a non-matching alert too
    assert (await client.post("/api/v1/jobs/alerts", headers=auth(b_tok), json={})).status_code == 422
    r = await client.post("/api/v1/jobs/alerts", headers=auth(b_tok), json={"q": "engineer", "employment_type": "full_time"})
    assert r.status_code == 201
    await client.post("/api/v1/jobs/alerts", headers=auth(b_tok), json={"employment_type": "internship"})
    before = (await client.get("/api/v1/notifications/unread-count", headers=auth(b_tok))).json()["data"]["unread"]
    j = (await client.post("/api/v1/jobs", headers=auth(a_tok), json=_job())).json()["data"]
    assert j["status"] == "pending"
    await client.post(f"/api/v1/admin/jobs/{j['id']}/approve", headers=auth(installed))
    after = (await client.get("/api/v1/notifications/unread-count", headers=auth(b_tok))).json()["data"]["unread"]
    assert after == before + 1  # one notification, not one per matching alert
    d = (await client.get(f"/api/v1/jobs/{j['id']}", headers=auth(b_tok))).json()["data"]
    assert d["responsibilities"] == ["Design APIs", "Own on-call"] and d["benefits"] == ["Health Insurance", "Flexible Work"]
    j2 = (await client.post("/api/v1/jobs", headers=auth(installed), json=_job(title="Data Engineer"))).json()["data"]
    sim = (await client.get(f"/api/v1/jobs/{j['id']}/similar", headers=auth(b_tok))).json()["data"]
    assert j2["id"] in [x["id"] for x in sim] and j["id"] not in [x["id"] for x in sim]
    await client.put(f"/api/v1/jobs/{j['id']}/save", headers=auth(b_tok))
    act = (await client.get("/api/v1/jobs/activity", headers=auth(b_tok))).json()["data"]
    assert act["saved"] == 1 and act["alerts"] == 2 and act["applications"] == 0
    alerts = (await client.get("/api/v1/jobs/alerts", headers=auth(b_tok))).json()["data"]
    assert (await client.delete(f"/api/v1/jobs/alerts/{alerts[0]['id']}", headers=auth(b_tok))).status_code == 200


async def test_referrals_and_employer_profile(client, installed):
    a_tok, _ = await _verified(client, installed, "jobr2-a@example.org", "Asim Refer", 2013)
    b_tok, b_id = await _verified(client, installed, "jobr2-b@example.org", "Bina Refer", 2013)
    c_tok, c_id = await _verified(client, installed, "jobr2-c@example.org", "Chaman Refer", 2013)
    emp = (
        await client.post(
            "/api/v1/jobs/employers",
            headers=auth(a_tok),
            json={"name": "Refer Co", "industry": "Software", "employees": "250+", "headquarters": "Karachi"},
        )
    ).json()["data"]
    assert emp["employees"] == "250+"
    await client.post(f"/api/v1/admin/jobs/employers/{emp['id']}/decide", headers=auth(installed), json={"approve": True})
    j = (await client.post("/api/v1/jobs", headers=auth(a_tok), json=_job(employer_id=emp["id"], organization="Refer Co"))).json()["data"]
    await client.post(f"/api/v1/admin/jobs/{j['id']}/approve", headers=auth(installed))
    d = (await client.get(f"/api/v1/jobs/{j['id']}", headers=auth(b_tok))).json()["data"]
    assert d["employer"]["headquarters"] == "Karachi" and d["employer"]["industry"] == "Software"
    # B refers C (a member) and an outside candidate
    assert (await client.post(f"/api/v1/jobs/{j['id']}/referrals", headers=auth(b_tok), json={"note": "x"})).status_code == 422
    r = await client.post(
        f"/api/v1/jobs/{j['id']}/referrals", headers=auth(b_tok), json={"candidate_user_id": c_id, "note": "Strong Python skills"}
    )
    assert r.status_code == 201 and r.json()["data"]["candidate"]["id"] == c_id
    dup = await client.post(f"/api/v1/jobs/{j['id']}/referrals", headers=auth(b_tok), json={"candidate_user_id": c_id})
    assert dup.status_code == 409
    ext = {"candidate_name": "Outside Person", "candidate_email": "outside@example.org"}
    assert (await client.post(f"/api/v1/jobs/{j['id']}/referrals", headers=auth(b_tok), json=ext)).status_code == 201
    # only the poster (or career office) sees them
    assert (await client.get(f"/api/v1/jobs/{j['id']}/referrals", headers=auth(c_tok))).status_code == 403
    refs = (await client.get(f"/api/v1/jobs/{j['id']}/referrals", headers=auth(a_tok))).json()["data"]
    assert {x["candidate_name"] for x in refs} == {"Chaman Refer", "Outside Person"} and refs[0]["referrer"]["id"] == b_id
    mine = (await client.get("/api/v1/jobs/referrals/mine", headers=auth(b_tok))).json()["data"]
    assert len(mine) == 2 and mine[0]["job"]["id"] == j["id"]
