"""Redesign phase 6 — member settings (enforced on the backend), deactivation, trusted devices, security, support desk."""

import pyotp

from .conftest import auth
from .test_alumni import PW
from .test_community import _verified
from .test_feed import _connect


async def test_settings_validation_and_privacy_enforcement(client, installed):
    a_tok, a_id = await _verified(client, installed, "set-a@example.org", "Afshan Settings", 2011)
    b_tok, b_id = await _verified(client, installed, "set-b@example.org", "Bahram Settings", 2011)
    c_tok, c_id = await _verified(client, installed, "set-c@example.org", "Chaudhry Settings", 1995)
    s = (await client.get("/api/v1/me/settings", headers=auth(a_tok))).json()["data"]
    assert s["show_in_directory"] is True and s["connection_requests"] == "anyone" and s["theme"] == "light"
    bad = await client.put("/api/v1/me/settings", headers=auth(a_tok), json={"theme": "purple", "nope": 1})
    assert bad.status_code == 422 and {e["field"] for e in bad.json()["error"]["details"]} == {"theme", "nope"}
    # hidden from the directory, search and suggestions
    await client.put("/api/v1/me/settings", headers=auth(a_tok), json={"show_in_directory": False, "allow_follow": False})
    rows = (await client.get("/api/v1/alumni/directory?q=Afshan", headers=auth(b_tok))).json()["data"]
    assert a_id not in [r["id"] for r in rows]
    assert (await client.post(f"/api/v1/alumni/profiles/{a_id}/follow", headers=auth(b_tok))).status_code == 403
    # connection requests: batch only (C graduated 16 years apart)
    await client.put("/api/v1/me/settings", headers=auth(a_tok), json={"connection_requests": "batch"})
    assert (await client.post("/api/v1/alumni/connections", headers=auth(c_tok), json={"user_id": a_id})).status_code == 403
    assert (await client.post("/api/v1/alumni/connections", headers=auth(b_tok), json={"user_id": a_id})).status_code == 201
    await client.put("/api/v1/me/settings", headers=auth(a_tok), json={"connection_requests": "none"})
    assert (await client.post("/api/v1/alumni/connections", headers=auth(c_tok), json={"user_id": a_id})).status_code == 403
    # messaging: C (not connected, other batch) may message A only once A allows all alumni
    assert (await client.post("/api/v1/messages/conversations/direct", headers=auth(c_tok), json={"user_id": a_id})).status_code == 403
    await client.put("/api/v1/me/settings", headers=auth(a_tok), json={"msg_alumni": True})
    conv = await client.post("/api/v1/messages/conversations/direct", headers=auth(c_tok), json={"user_id": a_id})
    assert conv.status_code == 200
    # read receipts: A hides them, so C never sees "read"
    cid = conv.json()["data"]["id"]
    m = (await client.post(f"/api/v1/messages/conversations/{cid}/messages", headers=auth(c_tok), json={"body": "Hello"})).json()["data"]
    await client.put("/api/v1/me/settings", headers=auth(a_tok), json={"read_receipts": False})
    await client.post(f"/api/v1/messages/conversations/{cid}/read", headers=auth(a_tok), json={"message_id": m["id"]})
    mine = (await client.get(f"/api/v1/messages/conversations/{cid}/messages", headers=auth(c_tok))).json()["data"]
    assert mine[-1]["status"] != "read"
    # activity hidden from others, still visible to staff
    await client.put("/api/v1/me/settings", headers=auth(b_tok), json={"show_activity": False, "show_connections": False})
    await client.post("/api/v1/community/posts", headers=auth(b_tok), json={"body": "Private-ish thoughts"})
    act = (await client.get(f"/api/v1/alumni/profiles/{b_id}/activity", headers=auth(c_tok))).json()
    assert act["data"] == [] and act["meta"]["hidden"]
    feed = (await client.get(f"/api/v1/community/feed?author_id={b_id}", headers=auth(c_tok))).json()["data"]
    assert feed == []
    ov = (await client.get(f"/api/v1/alumni/profiles/{b_id}/overview", headers=auth(c_tok))).json()["data"]
    assert ov["connections_hidden"] and ov["connection_count"] == 0
    reset = (await client.post("/api/v1/me/settings/reset", headers=auth(b_tok), json=["show_activity"])).json()["data"]
    assert reset["show_activity"] is True and reset["show_connections"] is False
    await _connect(client, b_tok, c_tok, c_id)  # keeps the helpers in use


async def test_deactivate_trusted_device_security_and_notifications(client, installed):
    tok, uid = await _verified(client, installed, "set-d@example.org", "Dania Settings", 2012)
    assert (await client.post("/api/v1/me/deactivate", headers=auth(tok), json={"password": "wrong"})).status_code == 400
    assert (await client.post("/api/v1/me/deactivate", headers=auth(tok), json={"password": PW})).status_code == 200
    assert (await client.get("/api/v1/me/settings", headers=auth(tok))).status_code == 401
    r = await client.post("/api/v1/auth/login", json={"email": "set-d@example.org", "password": PW})
    assert r.status_code == 200  # signing in again reactivates
    tok = r.json()["data"]["access_token"]
    # two-factor + "remember this device"
    setup = (await client.post("/api/v1/auth/mfa/setup", headers=auth(tok))).json()["data"]
    await client.post("/api/v1/auth/mfa/enable", headers=auth(tok), json={"code": pyotp.TOTP(setup["secret"]).now()})
    ch = (await client.post("/api/v1/auth/login", json={"email": "set-d@example.org", "password": PW})).json()["data"]
    r = await client.post(
        "/api/v1/auth/login/mfa", json={"challenge": ch["challenge"], "code": pyotp.TOTP(setup["secret"]).now(), "remember_device": True}
    )
    assert r.status_code == 200 and "sst_td" in r.cookies
    again = (await client.post("/api/v1/auth/login", json={"email": "set-d@example.org", "password": PW})).json()["data"]
    assert "access_token" in again and not again.get("mfa_required")
    tok = again["access_token"]
    devices = (await client.get("/api/v1/me/trusted-devices", headers=auth(tok))).json()["data"]
    assert len(devices) == 1
    await client.delete("/api/v1/me/trusted-devices", headers=auth(tok))
    assert (await client.post("/api/v1/auth/login", json={"email": "set-d@example.org", "password": PW})).json()["data"]["mfa_required"]
    codes = (await client.post("/api/v1/me/recovery-codes", headers=auth(tok), json={"password": PW})).json()["data"]["codes"]
    assert len(codes) == 8
    # security summary + login activity
    await client.post("/api/v1/auth/login", json={"email": "set-d@example.org", "password": "bad-password"})
    sec = (await client.get("/api/v1/me/security", headers=auth(tok))).json()["data"]
    assert sec["mfa_enabled"] and sec["checks"]["mfa"] and sec["failed_30d"] >= 1 and sec["recovery_codes_left"] == 8
    acts = (await client.get("/api/v1/me/login-activity", headers=auth(tok))).json()["data"]
    assert any(not a["success"] for a in acts) and all("browser" in a for a in acts)
    # notification preferences: new categories and SMS
    prefs = (await client.get("/api/v1/notifications/preferences", headers=auth(tok))).json()["data"]
    cats = {p["category"]: p for p in prefs}
    assert {"mentions", "comments", "news", "marketing", "support"} <= set(cats) and cats["marketing"]["email"] is False
    assert cats["events"]["sms_available"] and not cats["mentions"]["sms_available"]
    body = [
        {"category": "events", "in_app": True, "email": True, "sms": True},
        {"category": "mentions", "in_app": True, "email": False, "sms": True},
    ]
    prefs = {p["category"]: p for p in (await client.put("/api/v1/notifications/preferences", headers=auth(tok), json=body)).json()["data"]}
    assert prefs["events"]["sms"] is True and prefs["mentions"]["sms"] is False
    # data requests list records exports
    await client.get("/api/v1/account/export", headers=auth(tok))
    reqs = (await client.get("/api/v1/account/requests", headers=auth(tok))).json()["data"]
    assert reqs[0]["kind"] == "export" and reqs[0]["status"] == "completed"
    assert uid


async def test_support_tickets_and_faqs(client, installed):
    tok, _ = await _verified(client, installed, "sup-a@example.org", "Saima Support", 2014)
    up = await client.post("/api/v1/support/uploads", headers=auth(tok), files={"file": ("shot.exe", b"MZ", "application/octet-stream")})
    assert up.status_code == 415
    t = (
        await client.post(
            "/api/v1/support/tickets",
            headers=auth(tok),
            json={
                "category": "account",
                "priority": "high",
                "subject": "Cannot change email",
                "description": "The save button does nothing.",
            },
        )
    ).json()["data"]
    assert t["number"].startswith("SST-") and t["status"] == "open"
    mine = (await client.get("/api/v1/support/tickets", headers=auth(tok))).json()["data"]
    assert [x["id"] for x in mine] == [t["id"]]
    # staff reply notifies the member and moves it to in progress
    r = (
        await client.post(f"/api/v1/admin/support/tickets/{t['id']}/replies", headers=auth(installed), json={"body": "Looking into it."})
    ).json()["data"]
    assert r["status"] == "in_progress" and r["replies"][0]["staff"]
    notes = (await client.get("/api/v1/notifications?category=support", headers=auth(tok))).json()["data"]
    assert notes and notes[0]["kind"] == "support_reply"
    await client.patch(f"/api/v1/admin/support/tickets/{t['id']}", headers=auth(installed), json={"status": "resolved"})
    again = (await client.post(f"/api/v1/support/tickets/{t['id']}/replies", headers=auth(tok), json={"body": "Still broken"})).json()[
        "data"
    ]
    assert again["status"] == "open" and len(again["replies"]) == 2
    assert (await client.get("/api/v1/admin/support/tickets", headers=auth(tok))).status_code == 403
    # FAQs
    f = (
        await client.post(
            "/api/v1/admin/support/faqs",
            headers=auth(installed),
            json={"question": "How do I reset my password?", "answer": "Use Forgot password."},
        )
    ).json()["data"]
    listed = (await client.get("/api/v1/support/faqs?q=reset", headers=auth(tok))).json()["data"]
    assert [x["id"] for x in listed] == [f["id"]]
    await client.put(
        f"/api/v1/admin/support/faqs/{f['id']}",
        headers=auth(installed),
        json={"question": "How do I reset my password?", "answer": "x" * 6, "published": False},
    )
    assert (await client.get("/api/v1/support/faqs?q=reset", headers=auth(tok))).json()["data"] == []
    assert "email" in (await client.get("/api/v1/support/contact", headers=auth(tok))).json()["data"]
