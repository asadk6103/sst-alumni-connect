"""Stage 3b — events, careers, mentorship, featured achievements (spec acceptance criteria)."""

from datetime import UTC, datetime, timedelta

from app import worker

from .conftest import auth
from .test_alumni import _approve, _member, _relogin
from .test_community import _verified

PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat()


def _emails(template_fragment: str) -> int:
    return sum(1 for n, p in worker.TEST_OUTBOX if n == "app.tasks.send_email" and template_fragment in p.get("subject", ""))


async def test_events_registration_waitlist_checkin_feedback(client, installed):
    h = auth(installed)
    start = datetime.now(UTC) + timedelta(days=3)
    body = {
        "title": "SST Alumni Reunion 2026",
        "kind": "reunion",
        "summary": "Annual reunion",
        "description": "Dinner and campus tour.",
        "starts_at": _iso(start),
        "ends_at": _iso(start + timedelta(hours=4)),
        "venue": "SST Campus, Rashidabad",
        "capacity": 2,
        "max_guests": 1,
    }
    bad = await client.post("/api/v1/admin/events", headers=h, json={**body, "ends_at": _iso(start - timedelta(hours=1))})
    assert bad.status_code == 422
    ev = (await client.post("/api/v1/admin/events", headers=h, json=body)).json()["data"]
    a_tok, _ = await _verified(client, installed, "ev-a@example.org", "Event Alpha", 2010)
    b_tok, b_id = await _verified(client, installed, "ev-b@example.org", "Event Bravo", 2010)
    c_tok, _ = await _verified(client, installed, "ev-c@example.org", "Event Charlie", 2010)
    assert (await client.get(f"/api/v1/events/{ev['id']}", headers=auth(a_tok))).status_code == 404  # draft
    assert (await client.post(f"/api/v1/admin/events/{ev['id']}/publish", headers=h)).status_code == 200
    listed = (await client.get("/api/v1/events", headers=auth(a_tok))).json()["data"]
    assert any(e["id"] == ev["id"] for e in listed)

    r = await client.post(f"/api/v1/events/{ev['id']}/register", headers=auth(a_tok), json={"guests": 2})
    assert r.status_code == 422  # more guests than allowed
    worker.TEST_OUTBOX.clear()
    ra = (await client.post(f"/api/v1/events/{ev['id']}/register", headers=auth(a_tok), json={"guests": 1})).json()["data"]
    assert ra["my_registration"]["status"] == "registered" and ra["seats_left"] == 0 and ra["my_registration"]["checkin_code"]
    assert _emails("registered") == 1
    rb = (await client.post(f"/api/v1/events/{ev['id']}/register", headers=auth(b_tok), json={})).json()["data"]
    assert rb["my_registration"]["status"] == "waitlisted"
    assert (await client.post(f"/api/v1/events/{ev['id']}/register", headers=auth(b_tok), json={})).status_code == 409
    # A cancels → B is promoted from the waitlist automatically
    await client.post(f"/api/v1/events/{ev['id']}/cancel", headers=auth(a_tok))
    rb = (await client.get(f"/api/v1/events/{ev['id']}", headers=auth(b_tok))).json()["data"]
    assert rb["my_registration"]["status"] == "registered" and rb["seats_left"] == 1
    ra = (await client.post(f"/api/v1/events/{ev['id']}/register", headers=auth(a_tok), json={})).json()["data"]  # A again (seat free)
    assert ra["my_registration"]["status"] == "registered"
    assert (await client.post(f"/api/v1/events/{ev['id']}/register", headers=auth(c_tok), json={})).json()["data"]["my_registration"][
        "status"
    ] == "waitlisted"
    ics = await client.get(f"/api/v1/events/{ev['id']}/calendar.ics", headers=auth(a_tok))
    assert ics.status_code == 200 and "BEGIN:VEVENT" in ics.text

    # attendance: QR code scan + manual; another event's ticket is refused; feedback after the start
    code = rb["my_registration"]["checkin_code"]
    r = await client.post(f"/api/v1/admin/events/{ev['id']}/checkin", headers=h, json={"code": f"sst-ticket:{code}"})
    assert r.status_code == 200 and not r.json()["data"]["already_checked_in"]
    r = await client.post(f"/api/v1/admin/events/{ev['id']}/checkin", headers=h, json={"code": code})
    assert r.json()["data"]["already_checked_in"]
    assert (await client.post(f"/api/v1/admin/events/{ev['id']}/checkin", headers=h, json={"code": "nope"})).status_code == 404
    regs = (await client.get(f"/api/v1/admin/events/{ev['id']}/registrations", headers=h)).json()["data"]
    assert any(x["status"] == "attended" and x["checked_in_at"] for x in regs)
    assert (
        await client.put(f"/api/v1/events/{ev['id']}/feedback", headers=auth(b_tok), json={"rating": 5})
    ).status_code == 409  # not started
    assert (await client.get(f"/api/v1/admin/events/{ev['id']}/registrations/export", headers=h)).status_code == 200

    # reminders: one email per registered attendee, sent once
    from app.core.db import SessionLocal
    from app.models import Event
    from app.modules.events.router import send_reminders

    async with SessionLocal() as db:
        e = await db.get(Event, __import__("uuid").UUID(ev["id"]))
        e.starts_at, e.ends_at = datetime.now(UTC) + timedelta(hours=5), datetime.now(UTC) + timedelta(hours=9)
        await db.commit()
        assert await send_reminders(db) == 1  # A registered; B attended already; C waitlisted
        await db.commit()
        assert await send_reminders(db) == 0
        e = await db.get(Event, e.id)
        e.starts_at, e.ends_at = datetime.now(UTC) - timedelta(hours=2), datetime.now(UTC) + timedelta(hours=2)
        await db.commit()
    r = await client.put(f"/api/v1/events/{ev['id']}/feedback", headers=auth(b_tok), json={"rating": 5, "comment": "Wonderful evening"})
    assert r.status_code == 200 and r.json()["data"]["average"] == 5.0
    assert (
        await client.put(f"/api/v1/events/{ev['id']}/feedback", headers=auth(c_tok), json={"rating": 1})
    ).status_code == 409  # waitlisted
    # cancelling the event notifies everyone still registered or waitlisted
    worker.TEST_OUTBOX.clear()
    await client.post(f"/api/v1/admin/events/{ev['id']}/cancel", headers=h, json={"reason": "Venue unavailable"})
    assert _emails("Cancelled") == 2


async def test_jobs_post_approve_apply_track(client, installed):
    h = auth(installed)
    poster_tok, poster_id = await _verified(client, installed, "job-poster@example.org", "Javed Poster", 2005)
    seeker_tok, seeker_id = await _verified(client, installed, "job-seeker@example.org", "Saima Seeker", 2018)
    other_tok, _ = await _verified(client, installed, "job-other@example.org", "Omer Other", 2018)
    cats = (await client.get("/api/v1/jobs/categories", headers=auth(seeker_tok))).json()["data"]
    assert any(c["name"] == "Information Technology" for c in cats)  # seeded
    job = {
        "title": "Backend Engineer",
        "organization": "Arbisoft",
        "employment_type": "full_time",
        "location": "Lahore",
        "category_id": cats[0]["id"],
        "experience": "2-4 years",
        "skills": ["Python", "SQL", "python "],
        "is_referral": True,
        "description": "Build reliable APIs for millions of users. Python and PostgreSQL experience required.",
        "deadline": (datetime.now(UTC).date() + timedelta(days=20)).isoformat(),
        "salary_min": 300000,
        "salary_max": 200000,
    }
    assert (await client.post("/api/v1/jobs", headers=auth(poster_tok), json=job)).status_code == 422  # max < min
    job["salary_max"] = 450000
    j = (await client.post("/api/v1/jobs", headers=auth(poster_tok), json=job)).json()["data"]
    assert j["status"] == "pending" and j["skills"] == ["Python", "SQL", "python"]
    assert all(x["id"] != j["id"] for x in (await client.get("/api/v1/jobs", headers=auth(seeker_tok))).json()["data"])
    assert (await client.get(f"/api/v1/jobs/{j['id']}", headers=auth(seeker_tok))).status_code == 404
    r = await client.post(f"/api/v1/admin/jobs/{j['id']}/reject", headers=h, json={})
    assert r.status_code == 422  # reason required
    await client.post(f"/api/v1/admin/jobs/{j['id']}/approve", headers=h)
    listed = (await client.get("/api/v1/jobs?q=python", headers=auth(seeker_tok))).json()["data"]
    assert any(x["id"] == j["id"] and x["is_new"] for x in listed)

    # save, CV upload (private), apply once, poster reviews, applicant sees status
    await client.put(f"/api/v1/jobs/{j['id']}/save", headers=auth(seeker_tok))
    assert (await client.get("/api/v1/jobs?saved=true", headers=auth(seeker_tok))).json()["meta"]["total"] == 1
    cv = (
        await client.post(
            "/api/v1/jobs/resumes", headers=auth(seeker_tok), files={"file": ("cv.pdf", PDF, "application/pdf")}, data={"title": "CV 2026"}
        )
    ).json()["data"]
    assert cv["is_default"]
    bad = await client.post("/api/v1/jobs/resumes", headers=auth(seeker_tok), files={"file": ("x.txt", b"plain text cv", "text/plain")})
    assert bad.status_code == 415
    worker.TEST_OUTBOX.clear()
    app_ = await client.post(
        f"/api/v1/jobs/{j['id']}/apply", headers=auth(seeker_tok), json={"resume_id": cv["id"], "cover_letter": "Keen!"}
    )
    assert app_.status_code == 201 and _emails("New application") == 1
    assert (await client.post(f"/api/v1/jobs/{j['id']}/apply", headers=auth(seeker_tok), json={})).status_code == 409
    assert (await client.post(f"/api/v1/jobs/{j['id']}/apply", headers=auth(poster_tok), json={})).status_code == 409  # own job
    apps = (await client.get(f"/api/v1/jobs/{j['id']}/applications", headers=auth(poster_tok))).json()["data"]
    assert apps[0]["applicant"]["full_name"] == "Saima Seeker"
    assert (await client.get(f"/api/v1/jobs/{j['id']}/applications", headers=auth(other_tok))).status_code == 404
    aid = apps[0]["id"]
    assert (await client.get(f"/api/v1/jobs/applications/{aid}/resume", headers=auth(poster_tok))).status_code == 200
    assert (await client.get(f"/api/v1/jobs/applications/{aid}/resume", headers=auth(other_tok))).status_code == 404
    r = await client.patch(
        f"/api/v1/jobs/applications/{aid}", headers=auth(poster_tok), json={"status": "shortlisted", "poster_note": "Strong"}
    )
    assert r.json()["data"]["status"] == "shortlisted"
    mine = (await client.get("/api/v1/jobs/applications/mine", headers=auth(seeker_tok))).json()["data"]
    assert mine[0]["status"] == "shortlisted" and "poster_note" not in mine[0]
    assert (await client.delete(f"/api/v1/jobs/resumes/{cv['id']}", headers=auth(seeker_tok))).status_code == 409  # in use

    # employer registration → approval grants the employer role
    emp = (await client.post("/api/v1/jobs/employers", headers=auth(poster_tok), json={"name": "Arbisoft", "industry": "IT"})).json()[
        "data"
    ]
    assert emp["status"] == "pending"
    await client.post(f"/api/v1/admin/jobs/employers/{emp['id']}/decide", headers=h, json={"approve": True})
    poster_tok = await _relogin(client, "job-poster@example.org")
    me = (await client.get("/api/v1/auth/me", headers=auth(poster_tok))).json()["data"]
    assert "employer" in [r["key"] for r in me["roles"]]
    assert (await client.get("/api/v1/admin/jobs/export", headers=h)).status_code == 200


async def test_mentorship_student_requests_and_sessions(client, installed):
    h = auth(installed)
    mentor_tok, mentor_id = await _verified(client, installed, "mentor@example.org", "Dr. Imran Sheikh", 2004)
    year = datetime.now(UTC).year + 1
    _, student_id = await _member(
        client, "student@example.org", "Zara Student", kind="student", graduation_year=year, admission_year=year - 10
    )
    await _approve(client, installed, student_id)
    student_tok = await _relogin(client, "student@example.org")

    profile = {
        "industry": "Research",
        "expertise": ["Career planning", "Research methods"],
        "skills": ["Statistics"],
        "experience_years": 15,
        "hours_per_month": 4,
        "formats": ["video", "chat"],
        "max_mentees": 1,
        "introduction": "I lead research at NUST and enjoy helping students choose their path.",
    }
    assert (await client.put("/api/v1/mentorship/me", headers=auth(student_tok), json=profile)).status_code == 403  # students cannot mentor
    m = (await client.put("/api/v1/mentorship/me", headers=auth(mentor_tok), json=profile)).json()["data"]
    assert m["status"] == "pending"
    assert not (await client.get("/api/v1/mentorship/mentors", headers=auth(student_tok))).json()["data"]
    await client.post(f"/api/v1/admin/mentorship/mentors/{mentor_id}/decide", headers=h, json={"approve": True})
    found = (await client.get("/api/v1/mentorship/mentors?q=research", headers=auth(student_tok))).json()
    assert found["data"][0]["user"]["id"] == mentor_id and "Research" in found["meta"]["industries"]

    req = {
        "mentor_id": mentor_id,
        "topic": "Choosing a university",
        "goals": "Understand research careers and university options.",
        "preferred_format": "video",
    }
    r = (await client.post("/api/v1/mentorship/requests", headers=auth(student_tok), json=req)).json()["data"]
    assert r["status"] == "pending" and r["role"] == "mentee"
    assert (await client.post("/api/v1/mentorship/requests", headers=auth(student_tok), json=req)).status_code == 409
    assert (
        await client.post(f"/api/v1/mentorship/requests/{r['id']}/respond", headers=auth(student_tok), json={"accept": True})
    ).status_code == 403
    acc = (
        await client.post(
            f"/api/v1/mentorship/requests/{r['id']}/respond", headers=auth(mentor_tok), json={"accept": True, "note": "Happy to help"}
        )
    ).json()["data"]
    assert acc["status"] == "accepted"
    # capacity of 1 reached: the mentor is no longer listed as available
    assert not (await client.get("/api/v1/mentorship/mentors?available=true", headers=auth(student_tok))).json()["data"]
    s = (
        await client.post(
            f"/api/v1/mentorship/requests/{r['id']}/sessions",
            headers=auth(student_tok),
            json={"scheduled_at": _iso(datetime.now(UTC) + timedelta(days=2)), "format": "video", "location": "https://meet.example.org/x"},
        )
    ).json()["data"]
    assert (
        await client.patch(f"/api/v1/mentorship/sessions/{s['id']}", headers=auth(student_tok), json={"outcome": "x"})
    ).status_code == 403
    done = (
        await client.patch(
            f"/api/v1/mentorship/sessions/{s['id']}", headers=auth(mentor_tok), json={"outcome": "Shortlisted 3 universities."}
        )
    ).json()["data"]
    assert done["status"] == "completed"
    fb = await client.put(
        f"/api/v1/mentorship/requests/{r['id']}/feedback", headers=auth(student_tok), json={"rating": 5, "comment": "Very helpful"}
    )
    assert fb.status_code == 200
    await client.post(f"/api/v1/mentorship/requests/{r['id']}/complete", headers=auth(mentor_tok))
    prof = (await client.get(f"/api/v1/mentorship/mentors/{mentor_id}", headers=auth(student_tok))).json()["data"]
    assert prof["rating"] == 5.0 and prof["testimonials"][0]["comment"] == "Very helpful"
    stats = (await client.get("/api/v1/admin/mentorship/requests", headers=h)).json()["meta"]
    assert stats["counts"].get("completed", 0) >= 1 and stats["average_rating"]


async def test_achievements_nomination_publication_consent(client, installed):
    h = auth(installed)
    a_tok, a_id = await _verified(client, installed, "ach-a@example.org", "Ayesha Noor", 2012)
    b_tok, _ = await _verified(client, installed, "ach-b@example.org", "Bilal Nominator", 2012)
    n = await client.post(
        "/api/v1/achievements/nominations",
        headers=auth(b_tok),
        json={
            "user_id": a_id,
            "kind": "success_story",
            "title": "From SST to Deputy Director at HBL",
            "reason": "Ayesha mentors young bankers and led a major digital banking launch.",
        },
    )
    assert n.status_code == 201
    aid = n.json()["data"]["id"]
    assert not (await client.get("/api/v1/achievements", headers=auth(b_tok))).json()["data"]
    r = await client.post(f"/api/v1/admin/achievements/{aid}/review", headers=h, json={"action": "publish"})
    assert r.status_code == 409  # needs a story first
    item = (await client.get("/api/v1/admin/achievements?status=nominated", headers=h)).json()["data"][0]
    await client.put(
        f"/api/v1/admin/achievements/{aid}",
        headers=h,
        json={
            "user_id": item["user_id"],
            "kind": "success_story",
            "title": item["title"],
            "summary": "Leading digital banking at HBL.",
            "story": "Ayesha graduated in 2012 …",
            "featured": True,
        },
    )
    await client.post(f"/api/v1/admin/achievements/{aid}/review", headers=h, json={"action": "publish"})
    assert (await client.get("/api/v1/achievements", headers=auth(b_tok))).json()["data"][0]["id"] == aid
    assert not (await client.get("/api/v1/public/achievements")).json()["data"]  # not without consent
    assert (await client.post(f"/api/v1/achievements/{aid}/consent", headers=auth(b_tok), json={"public": True})).status_code == 404
    await client.post(f"/api/v1/achievements/{aid}/consent", headers=auth(a_tok), json={"public": True})
    pub = (await client.get("/api/v1/public/achievements")).json()["data"]
    assert pub[0]["id"] == aid and set(pub[0]["person"]) == {"full_name", "photo", "batch"} and "status" not in pub[0]

    # dashboard shows the new engagement widgets
    d = (await client.get("/api/v1/alumni/dashboard", headers=auth(a_tok))).json()["data"]
    keys = [w["key"] for w in d["widgets"]]
    assert {"upcoming_events", "latest_jobs", "achievements", "community_posts", "mentors"} <= set(keys)
    assert d["achievements"][0]["id"] == aid and "active_mentors" in d["stats"]
