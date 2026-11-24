"""Stage 2 — registration, verification, profiles, privacy, directory, connections, batches, records, dashboard."""

import io

from PIL import Image

from app import worker
from app.services import live

from .conftest import auth, last_email_link

PW = "Str0ngPassword!"


async def _register(client, email, name, **extra):
    body = {"full_name": name, "email": email, "phone": "+92 300 1112233", "password": PW, "accept_terms": True,
            "graduation_year": 2012, "admission_year": 2002, "city": "Lahore", "country": "Pakistan", **extra}
    r = await client.post("/api/v1/auth/register", json=body)
    assert r.status_code == 201, r.text
    return r


async def _member(client, email, name, **extra):
    """Register, confirm the email, sign in; returns (token, user_id)."""
    await _register(client, email, name, **extra)
    token = last_email_link("/verify-email")
    assert (await client.post("/api/v1/auth/email/verify", json={"token": token})).status_code == 200
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": PW})
    assert r.status_code == 200, r.text
    return r.json()["data"]["access_token"], r.json()["data"]["user"]["id"]


async def _approve(client, admin, uid):
    r = await client.post(f"/api/v1/admin/verification/{uid}/approve", headers=auth(admin), json={})
    assert r.status_code == 200, r.text


async def _relogin(client, email):
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": PW})
    return r.json()["data"]["access_token"]


async def test_registration_validation_and_no_account_discovery(client, installed):
    base = {"full_name": "Val Idation", "email": "val@example.org", "phone": "+923001234567", "password": PW,
            "graduation_year": 2010, "city": "Multan", "country": "Pakistan"}
    r = await client.post("/api/v1/auth/register", json=base)
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "accept_terms"
    r = await client.post("/api/v1/auth/register", json={**base, "accept_terms": True, "graduation_year": 2099})
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "graduation_year"
    r = await client.post("/api/v1/auth/register", json={**base, "accept_terms": True, "admission_year": 2012})
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "admission_year"
    r = await client.post("/api/v1/auth/register", json={**base, "accept_terms": True, "password": "weak"})
    assert r.status_code == 422
    # Registering with an address that already has an account gives the same answer; the owner is emailed.
    r1 = await client.post("/api/v1/auth/register", json={**base, "accept_terms": True})
    worker.TEST_OUTBOX.clear()
    r2 = await client.post("/api/v1/auth/register", json={**base, "accept_terms": True, "full_name": "Someone Else"})
    assert r1.status_code == r2.status_code == 201 and r1.json() == r2.json()
    assert any(p.get("template") == "auth.account_exists" or "already exists" in p.get("html", "")
               for n, p in worker.TEST_OUTBOX if n == "app.tasks.send_email")
    # not verified, cannot sign in before confirming the email
    r = await client.post("/api/v1/auth/login", json={"email": "val@example.org", "password": PW})
    assert r.json()["error"]["code"] == "EMAIL_NOT_VERIFIED"


async def test_unverified_member_is_limited_until_admin_approves(client, installed):
    token, uid = await _member(client, "pending1@example.org", "Pending Person")
    me = (await client.get("/api/v1/alumni/me", headers=auth(token))).json()["data"]
    assert me["verification"]["status"] == "pending" and not me["verified"]
    assert (await client.get("/api/v1/alumni/directory", headers=auth(token))).status_code == 403
    assert (await client.get("/api/v1/admin/alumni", headers=auth(token))).status_code == 403
    # appears in the verification queue
    q = (await client.get("/api/v1/admin/verification?q=pending1", headers=auth(installed))).json()
    assert q["data"][0]["id"] == uid and q["meta"]["counts"]["pending"] >= 1
    # reject with a reason → member sees it and can resubmit
    r = await client.post(f"/api/v1/admin/verification/{uid}/reject", headers=auth(installed), json={"reason": "Please add your batch."})
    assert r.status_code == 200
    me = (await client.get("/api/v1/alumni/me", headers=auth(token))).json()["data"]
    assert me["verification"]["status"] == "rejected" and me["verification"]["rejection_reason"] == "Please add your batch."
    r = await client.post("/api/v1/alumni/me/verification", headers=auth(token), json={"note": "Added details"})
    assert r.json()["data"]["verification"]["status"] == "pending"
    await _approve(client, installed, uid)
    token = await _relogin(client, "pending1@example.org")
    me = (await client.get("/api/v1/auth/me", headers=auth(token))).json()["data"]
    assert "verified_alumni" in [r["key"] for r in me["roles"]] and "unverified_alumni" not in [r["key"] for r in me["roles"]]
    assert (await client.get("/api/v1/alumni/directory", headers=auth(token))).status_code == 200
    # verified identity fields are locked for the member
    r = await client.put("/api/v1/alumni/me", headers=auth(token), json={"graduation_year": 2011})
    assert r.status_code == 422 and r.json()["error"]["code"] == "FIELD_LOCKED"
    # revoke returns the member to the unverified role
    r = await client.post(f"/api/v1/admin/verification/{uid}/revoke", headers=auth(installed), json={"reason": "Duplicate account"})
    assert r.status_code == 200
    token = await _relogin(client, "pending1@example.org")
    assert (await client.get("/api/v1/alumni/directory", headers=auth(token))).status_code == 403


async def test_record_match_needs_proven_contact(client, installed):
    csv_data = ("registration_no,full_name,graduation_year,batch,email\n"
                "SST-1001,Hamza Ali Raza,2015,Class of 2015,hamza@example.org\n"
                "SST-1002,Sana Iqbal,2015,Class of 2015,\n"
                "SST-1003,,2015,,\n")
    files = {"file": ("records.csv", csv_data, "text/csv")}
    r = await client.post("/api/v1/admin/student-records/import", headers=auth(installed), files=files, data={"dry_run": "true"})
    d = r.json()["data"]
    assert d["created"] == 2 and d["error_count"] == 1 and d["errors"][0]["row"] == 4 and d["new_batches"] == ["Class of 2015"]
    assert (await client.get("/api/v1/admin/student-records", headers=auth(installed))).json()["meta"]["summary"]["records"] == 0
    r = await client.post("/api/v1/admin/student-records/import", headers=auth(installed), files=files, data={"dry_run": "false"})
    assert r.json()["data"]["created"] == 2

    # Same registration number + name + year, and the email on record is proven → verified automatically.
    token, uid = await _member(client, "hamza@example.org", "Hamza Raza", graduation_year=2015, admission_year=2005,
                               registration_no="sst 1001")
    me = (await client.get("/api/v1/alumni/me", headers=auth(token))).json()["data"]
    assert me["verification"]["status"] == "verified" and me["verification"]["method"] == "record_match"
    assert me["batch"] == "Class of 2015"
    # Someone else claiming a record without its contact details is only flagged for review.
    token2, uid2 = await _member(client, "not-sana@example.org", "Sana Iqbal", graduation_year=2015, admission_year=2005,
                                 registration_no="SST1002")
    me2 = (await client.get("/api/v1/alumni/me", headers=auth(token2))).json()["data"]
    assert me2["verification"]["status"] == "pending"
    q = (await client.get("/api/v1/admin/verification?match=any", headers=auth(installed))).json()["data"]
    assert any(x["id"] == uid2 and x["match_strength"] == "partial" for x in q)
    # A second claim on an already matched record does not match at all.
    _, uid3 = await _member(client, "hamza2@example.org", "Hamza Ali Raza", graduation_year=2015, registration_no="SST-1001")
    detail = (await client.get(f"/api/v1/admin/alumni/{uid3}", headers=auth(installed))).json()["data"]
    assert detail["record"] is None and detail["match_strength"] is None
    r = await client.post(f"/api/v1/admin/verification/{uid3}/approve", headers=auth(installed), json={})
    assert r.status_code == 409 and r.json()["error"]["code"] == "DUPLICATE_REGISTRATION_NO"


async def test_invite_from_records_and_verification_codes(client, installed):
    csv_data = "Reg No,Student Name,Passing Year,Email\nSST-2001,Bilal Ahmed,2016,bilal@example.org\n"
    r = await client.post("/api/v1/admin/student-records/import", headers=auth(installed),
                          files={"file": ("r.csv", csv_data, "text/csv")}, data={"dry_run": "false"})
    assert r.json()["data"]["created"] == 1
    rec = (await client.get("/api/v1/admin/student-records?q=SST-2001", headers=auth(installed))).json()["data"][0]
    r = await client.post("/api/v1/admin/student-records/invite", headers=auth(installed), json={"ids": [rec["id"]]})
    assert r.json()["data"]["invited"] == 1
    token = last_email_link("/reset-password")
    assert (await client.post("/api/v1/auth/password/reset", json={"token": token, "password": PW})).status_code == 200
    t = await _relogin(client, "bilal@example.org")
    me = (await client.get("/api/v1/alumni/me", headers=auth(t))).json()["data"]
    assert me["verification"]["status"] == "verified" and me["verification"]["method"] == "import"

    # institutional code: shown once, single use, can be revoked
    r = await client.post("/api/v1/admin/verification-codes", headers=auth(installed),
                          json={"label": "Reunion 2026 desk", "count": 2})
    codes = r.json()["data"]["codes"]
    assert len(codes) == 2
    token_a, _ = await _member(client, "coder@example.org", "Code Redeemer")
    r = await client.post("/api/v1/alumni/me/verification/code", headers=auth(token_a), json={"code": codes[0].lower()})
    assert r.status_code == 200 and r.json()["data"]["verification"]["method"] == "institutional_code"
    token_b, _ = await _member(client, "coder2@example.org", "Second Redeemer")
    r = await client.post("/api/v1/alumni/me/verification/code", headers=auth(token_b), json={"code": codes[0]})
    assert r.status_code == 400
    listing = (await client.get("/api/v1/admin/verification-codes", headers=auth(installed))).json()["data"]
    unused = next(c for c in listing if c["state"] == "active")
    await client.post(f"/api/v1/admin/verification-codes/{unused['id']}/revoke", headers=auth(installed))
    r = await client.post("/api/v1/alumni/me/verification/code", headers=auth(token_b), json={"code": codes[1]})
    assert r.status_code == 400


async def test_profile_sections_completion_and_private_documents(client, installed):
    token, uid = await _member(client, "profile@example.org", "Profile Builder")
    h = auth(token)
    start = (await client.get("/api/v1/alumni/me", headers=h)).json()["data"]["completion"]
    r = await client.put("/api/v1/alumni/me", headers=h, json={
        "bio": "Software engineer who loves mentoring young people from SST.", "industry": "Information Technology",
        "linkedin": "linkedin.com/in/someone", "designation": "Engineer", "organization": "Acme"})
    assert r.status_code == 200 and r.json()["data"]["linkedin"] == "https://linkedin.com/in/someone"
    assert (await client.put("/api/v1/alumni/me", headers=h, json={"website": "not a url"})).status_code == 422
    r = await client.put("/api/v1/alumni/me/skills", headers=h, json={"skills": ["Python", "python", "Leadership", "SQL"]})
    assert r.json()["data"] == ["Python", "Leadership", "SQL"]
    r = await client.post("/api/v1/alumni/me/employment", headers=h, json={
        "organization": "Globex", "designation": "Lead Engineer", "start_date": "2020-01-01", "is_current": True})
    assert r.status_code == 201
    emp_id = r.json()["data"]["id"]
    bad = await client.post("/api/v1/alumni/me/education", headers=h, json={
        "institution": "LUMS", "qualification": "BSc", "start_year": 2015, "end_year": 2013})
    assert bad.status_code == 422
    assert (await client.post("/api/v1/alumni/me/education", headers=h, json={
        "institution": "LUMS", "qualification": "BSc Computer Science", "start_year": 2012, "end_year": 2016})).status_code == 201
    assert (await client.post("/api/v1/alumni/me/achievements", headers=h, json={
        "kind": "award", "title": "Best Paper", "year": 2021})).status_code == 201
    me = (await client.get("/api/v1/alumni/me", headers=h)).json()["data"]
    assert me["designation"] == "Lead Engineer" and me["organization"] == "Globex"  # follows the current position
    assert me["completion"] > start
    # someone else's entry cannot be edited
    other, _ = await _member(client, "other-profile@example.org", "Other Person")
    assert (await client.delete(f"/api/v1/alumni/me/employment/{emp_id}", headers=auth(other))).status_code == 404

    # photo upload (image only) and private supporting document
    buf = io.BytesIO()
    Image.new("RGB", (600, 600), (113, 56, 219)).save(buf, format="PNG")
    r = await client.post("/api/v1/alumni/me/photo", headers=h, files={"file": ("me.png", buf.getvalue(), "image/png")})
    assert r.status_code == 200 and r.json()["data"]["url"]
    pdf = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
    r = await client.post("/api/v1/alumni/me/verification/documents", headers=h, files={"file": ("cert.pdf", pdf, "application/pdf")})
    assert r.status_code == 201, r.text
    doc_id = r.json()["data"]["id"]
    from app.core.db import SessionLocal
    from app.models import Media

    async with SessionLocal() as db:
        m = await db.get(Media, __import__("uuid").UUID(doc_id))
        assert m.private
        key = m.key
    assert (await client.get(f"/media/{key}")).status_code == 404  # never public
    assert (await client.get(f"/api/v1/alumni/me/verification/documents/{doc_id}", headers=h)).status_code == 200
    assert (await client.get(f"/api/v1/admin/verification/{uid}/documents/{doc_id}", headers=auth(installed))).status_code == 200
    assert (await client.get(f"/api/v1/admin/verification/{uid}/documents/{doc_id}", headers=auth(other))).status_code == 403
    media_list = (await client.get("/api/v1/admin/media?page_size=100", headers=auth(installed))).json()["data"]
    assert all(x["id"] != doc_id for x in media_list)


async def test_directory_search_filters_and_privacy(client, installed):
    a_tok, a_id = await _member(client, "dir-a@example.org", "Zainab Directory", graduation_year=2018, admission_year=2008,
                                city="Karachi", country="Pakistan", organization="Hidden Corp", designation="Analyst")
    b_tok, b_id = await _member(client, "dir-b@example.org", "Yusuf Directory", graduation_year=2018, admission_year=2008,
                                city="Dubai", country="United Arab Emirates", organization="Open Ltd", designation="Doctor")
    c_tok, c_id = await _member(client, "dir-c@example.org", "Xenia Hidden", graduation_year=2018)
    for uid in (a_id, b_id, c_id):
        await _approve(client, installed, uid)
    a_tok, b_tok, c_tok = [await _relogin(client, e) for e in ("dir-a@example.org", "dir-b@example.org", "dir-c@example.org")]
    # A keeps career to connections; C hides the whole profile; contact details are private by default
    r = await client.put("/api/v1/alumni/me/privacy", headers=auth(a_tok),
                         json={"visibility": "members", "sections": {"career": "connections"}})
    assert r.status_code == 200
    await client.put("/api/v1/alumni/me/privacy", headers=auth(c_tok), json={"visibility": "hidden", "sections": {}})

    def names(r):
        return {x["full_name"] for x in r.json()["data"]}

    h = auth(b_tok)
    assert names(await client.get("/api/v1/alumni/directory?q=directory", headers=h)) == {"Zainab Directory"}
    assert "Xenia Hidden" not in names(await client.get("/api/v1/alumni/directory?year=2018", headers=h))
    assert (await client.get(f"/api/v1/alumni/profiles/{c_id}", headers=h)).status_code == 404
    # filtering by A's hidden organisation must not reveal her; search text must not index it either
    assert names(await client.get("/api/v1/alumni/directory?organization=hidden", headers=h)) == set()
    assert names(await client.get("/api/v1/alumni/directory?q=hidden%20corp", headers=h)) == set()
    assert names(await client.get("/api/v1/alumni/directory?country=Pakistan&year=2018", headers=h)) == {"Zainab Directory"}
    card = (await client.get("/api/v1/alumni/directory?q=zainab", headers=h)).json()["data"][0]
    assert card["organization"] is None and card["city"] == "Karachi" and card["verified"]
    prof = (await client.get(f"/api/v1/alumni/profiles/{a_id}", headers=h)).json()["data"]
    assert prof["email"] is None and prof["phone"] is None and prof["employment"] == []
    # administrators see everything
    staff = (await client.get(f"/api/v1/admin/alumni/{a_id}", headers=auth(installed))).json()["data"]
    assert staff["organization"] == "Hidden Corp" and staff["email"] == "dir-a@example.org"
    facets = (await client.get("/api/v1/alumni/directory/facets", headers=h)).json()["data"]
    assert any(c["value"] == "United Arab Emirates" for c in facets["countries"])

    # connections: B asks, A accepts → A's career becomes visible to B
    live.SENT.clear()
    r = await client.post("/api/v1/alumni/connections", headers=h, json={"user_id": a_id, "message": "Batchmates!"})
    assert r.status_code == 201
    assert any(room == f"user:{a_id}" and ev == "connection:request" for room, ev, _ in live.SENT)
    assert (await client.post("/api/v1/alumni/connections", headers=h, json={"user_id": a_id})).status_code == 409
    received = (await client.get("/api/v1/alumni/connections?type=received", headers=auth(a_tok))).json()
    assert received["meta"]["counts"]["received"] == 1
    req_id = received["data"][0]["request_id"]
    assert (await client.post(f"/api/v1/alumni/connections/{req_id}/accept", headers=h)).status_code == 409  # not B's to accept
    assert (await client.post(f"/api/v1/alumni/connections/{req_id}/accept", headers=auth(a_tok))).status_code == 200
    prof = (await client.get(f"/api/v1/alumni/profiles/{a_id}", headers=h)).json()["data"]
    assert prof["organization"] == "Hidden Corp" and prof["connection"] == "accepted"
    # follow + report
    assert (await client.post(f"/api/v1/alumni/profiles/{a_id}/follow", headers=h)).json()["data"]["following"]
    assert (await client.get("/api/v1/alumni/connections?type=followers", headers=auth(a_tok))).json()["meta"]["total"] == 1
    r = await client.post(f"/api/v1/alumni/profiles/{a_id}/report", headers=h, json={"reason": "spam"})
    assert r.status_code == 201
    assert (await client.post(f"/api/v1/alumni/profiles/{a_id}/report", headers=h, json={"reason": "spam"})).status_code == 409
    reports = (await client.get("/api/v1/admin/profile-reports", headers=auth(installed))).json()["data"]
    assert reports[0]["user_id"] == a_id
    await client.post(f"/api/v1/admin/profile-reports/{reports[0]['id']}/resolve", headers=auth(installed), json={"status": "dismissed"})


async def test_batches_dashboard_and_settings(client, installed):
    h = auth(installed)
    r = await client.post("/api/v1/admin/batches/generate", headers=h, json={"from_year": 2000, "to_year": 2003})
    assert r.status_code == 201 and len(r.json()["data"]["created"]) == 4
    batches = (await client.get("/api/v1/admin/batches", headers=h)).json()["data"]
    b2001 = next(b for b in batches if b["name"] == "Class of 2001")
    r = await client.post("/api/v1/admin/batches", headers=h, json={"name": "class of 2001", "graduation_year": 2001})
    assert r.status_code == 409
    public = (await client.get("/api/v1/public/batches")).json()
    assert any(b["name"] == "Class of 2001" for b in public["data"]) and public["meta"]["registration_open"]
    # registering with a batch from another year is refused
    r = await client.post("/api/v1/auth/register", json={
        "full_name": "Wrong Batch", "email": "wb@example.org", "phone": "+923001234567", "password": PW, "accept_terms": True,
        "graduation_year": 2003, "batch_id": b2001["id"]})
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "batch_id"

    # dashboard widgets: admins can hide a widget, and it disappears from members' dashboards
    token, _ = await _member(client, "dash@example.org", "Dash Board", graduation_year=2001, admission_year=1991)
    d = (await client.get("/api/v1/alumni/dashboard", headers=auth(token))).json()["data"]
    keys = [w["key"] for w in d["widgets"]]
    assert "verification" in keys and "suggestions" not in keys  # unverified: no directory
    assert d["me"]["batch"] == "Class of 2001" and d["stats"]["registered_alumni"] >= 1
    cfg = (await client.get("/api/v1/admin/config/settings/dashboard", headers=h)).json()["data"]
    for w in cfg["widgets"]:
        if w["key"] == "stats":
            w["enabled"] = False
    assert (await client.put("/api/v1/admin/config/settings/dashboard", headers=h, json=cfg)).status_code == 200
    bad = {"widgets": [{"key": "nope"}]}
    assert (await client.put("/api/v1/admin/config/settings/dashboard", headers=h, json=bad)).status_code == 422
    d = (await client.get("/api/v1/alumni/dashboard", headers=auth(token))).json()["data"]
    assert "stats" not in [w["key"] for w in d["widgets"]]
    admin_dash = (await client.get("/api/v1/admin/dashboard", headers=h)).json()["data"]
    assert admin_dash["pending_verification"] >= 1 and admin_dash["alumni"]["registered_alumni"] >= 1

    # registration can be closed
    alumni_cfg = (await client.get("/api/v1/admin/config/settings/alumni", headers=h)).json()["data"]
    await client.put("/api/v1/admin/config/settings/alumni", headers=h, json={**alumni_cfg, "registration_open": False})
    r = await client.post("/api/v1/auth/register", json={
        "full_name": "Too Late", "email": "late@example.org", "phone": "+923001234567", "password": PW, "accept_terms": True,
        "graduation_year": 2003})
    assert r.status_code == 403
    await client.put("/api/v1/admin/config/settings/alumni", headers=h, json=alumni_cfg)
    # export respects permission and neutralises formulas
    r = await client.get("/api/v1/admin/alumni/export", headers=h)
    assert r.status_code == 200 and "Graduation year" in r.text
