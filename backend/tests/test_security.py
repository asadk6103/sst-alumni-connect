"""Stage 6 — security sweeps: access control on every route, injection, headers, CSRF, object-level access, privacy."""

import json
import re

from fastapi.routing import APIRoute

from app.main import create_app

from .conftest import auth
from .test_alumni import PW, _member
from .test_community import _verified

PUBLIC_PREFIXES = (
    "/api/v1/public",
    "/api/v1/setup",
    "/api/v1/auth/login",
    "/api/v1/auth/refresh",
    "/api/v1/auth/register",
    "/api/v1/auth/password/forgot",
    "/api/v1/auth/password/reset",
    "/api/v1/auth/email/verify",
    "/api/v1/auth/mfa/challenge",
    "/api/v1/auth/logout",
    "/api/v1/health",
    "/api/v1/auth/email/resend",
    "/api/v1/auth/session",
)


def _routes(method: str):
    for r in create_app().routes:
        if isinstance(r, APIRoute) and method in r.methods and r.path.startswith("/api/"):
            yield r.path


def _fill(path: str) -> str:
    # any path parameter becomes a random UUID / plausible value: access control must run before lookups
    return re.sub(r"\{[^}]+\}", "00000000-0000-4000-8000-000000000000", path)


async def test_every_admin_endpoint_rejects_members(client, installed):
    tok, _ = await _verified(client, installed, "sweep-member@example.org", "Sweep Member", 2011)
    leaks = []
    for method in ("GET", "POST", "PUT", "PATCH", "DELETE"):
        for path in _routes(method):
            if not path.startswith("/api/v1/admin"):
                continue
            r = await client.request(method, _fill(path), headers=auth(tok), json={})
            if r.status_code not in (401, 403):
                leaks.append(f"{method} {path} → {r.status_code}")
    assert not leaks, leaks


async def test_every_private_endpoint_requires_sign_in(client, installed):
    open_ = []
    for method in ("GET", "POST", "PUT", "PATCH", "DELETE"):
        for path in _routes(method):
            if path.startswith(PUBLIC_PREFIXES):
                continue
            r = await client.request(method, _fill(path), json={})
            if r.status_code not in (401, 403, 422) or (r.status_code == 422 and method == "GET"):
                open_.append(f"{method} {path} → {r.status_code}")
    assert not open_, open_


async def test_injection_payloads_are_inert(client, installed):
    tok, _ = await _verified(client, installed, "inj@example.org", "Inj Member", 2011)
    h = auth(installed)
    payloads = [
        "' OR '1'='1",
        "1; DROP TABLE users; --",
        "%' UNION SELECT password_hash FROM users --",
        "\\x00",
        "<script>alert(1)</script>",
    ]
    for p in payloads:
        for url, headers in (
            (f"/api/v1/alumni/directory?q={p}", auth(tok)),
            (f"/api/v1/admin/users?q={p}", h),
            (f"/api/v1/admin/audit-logs?q={p}", h),
            (f"/api/v1/news?q={p}", auth(tok)),
            (f"/api/v1/jobs?q={p}", auth(tok)),
        ):
            r = await client.get(url, headers=headers)
            assert r.status_code in (200, 422), (url, r.status_code)
            assert "password_hash" not in r.text and "argon2" not in r.text
    # the users table is still there
    assert (await client.get("/api/v1/admin/users", headers=h)).status_code == 200


async def test_security_headers_and_error_hygiene(client, installed):
    r = await client.get("/api/v1/public/site")
    for name in ("x-content-type-options", "referrer-policy", "x-frame-options"):
        assert name in r.headers, name
    r = await client.get("/api/v1/admin/users/not-a-uuid", headers=auth(installed))
    assert r.status_code == 422 and "Traceback" not in r.text
    body = await client.post("/api/v1/auth/login", content=b"{not json", headers={"content-type": "application/json"})
    assert body.status_code == 422 and "error" in body.json()


async def test_cross_site_cookie_requests_are_blocked(client, installed):
    r = await client.post("/api/v1/auth/login", json={"email": "owner@example.org", "password": "Str0ngPassword!"})
    assert r.status_code == 200
    evil = await client.post("/api/v1/auth/refresh", headers={"origin": "https://evil.example"})
    assert evil.status_code == 403 and evil.json()["error"]["code"] == "CROSS_SITE_REQUEST"
    # behind nginx the Host header has no port while the browser's Origin does
    proxied = await client.post("/api/v1/auth/refresh", headers={"origin": "http://testserver:8080", "host": "testserver"})
    assert proxied.status_code == 200, proxied.text
    same = await client.post("/api/v1/auth/refresh", headers={"origin": "https://testserver"})
    assert same.status_code == 200 and same.json()["data"]["access_token"]


async def test_object_level_access(client, installed):
    a_tok, a_id = await _verified(client, installed, "idor-a@example.org", "Idor Alpha", 2010)
    b_tok, _ = await _verified(client, installed, "idor-b@example.org", "Idor Beta", 2010)
    # a private verification document of A cannot be opened by B
    from io import BytesIO

    up = await client.post(
        "/api/v1/alumni/me/verification/documents",
        headers=auth(a_tok),
        files={"file": ("cert.pdf", BytesIO(b"%PDF-1.4\n%%EOF\n"), "application/pdf")},
    )
    if up.status_code == 201:
        doc = up.json()["data"]["id"]
        r = await client.get(f"/api/v1/admin/media/{doc}/download", headers=auth(b_tok))
        assert r.status_code in (401, 403, 404)
    # B cannot see A's donations or receipts
    cfg = (await client.get("/api/v1/admin/config/settings/donations", headers=auth(installed))).json()["data"]
    await client.put("/api/v1/admin/config/settings/donations", headers=auth(installed), json={**cfg, "min_amount": 100})
    d = (await client.post("/api/v1/donations/pledges", headers=auth(a_tok), json={"amount": "500", "category": "general"})).json()["data"]
    for path in (f"/api/v1/donations/{d['id']}", f"/api/v1/donations/{d['id']}/receipt"):
        assert (await client.get(path, headers=auth(b_tok))).status_code in (403, 404)
    assert (await client.post(f"/api/v1/donations/{d['id']}/cancel", headers=auth(b_tok))).status_code in (403, 404)
    # B cannot read a conversation B is not part of
    c_tok, c_id = await _verified(client, installed, "idor-c@example.org", "Idor Gamma", 2010)
    await client.post("/api/v1/alumni/connections", headers=auth(a_tok), json={"user_id": c_id})
    req = (await client.get("/api/v1/alumni/connections?type=received", headers=auth(c_tok))).json()["data"][0]["request_id"]
    await client.post(f"/api/v1/alumni/connections/{req}/accept", headers=auth(c_tok))
    conv = await client.post("/api/v1/messages/conversations/direct", headers=auth(a_tok), json={"user_id": c_id})
    assert conv.status_code == 200, conv.text
    cid = conv.json()["data"]["id"]
    assert (await client.get(f"/api/v1/messages/conversations/{cid}/messages", headers=auth(b_tok))).status_code in (403, 404)
    assert (await client.post(f"/api/v1/messages/conversations/{cid}/messages", headers=auth(b_tok), json={"body": "x"})).status_code in (
        403,
        404,
    )


async def test_personal_data_export_and_deletion(client, installed):
    tok, uid = await _verified(client, installed, "gdpr@example.org", "Gita Privacy", 2009)
    await client.put("/api/v1/alumni/me", headers=auth(tok), json={"bio": "Hello", "city": "Multan"})
    r = await client.get("/api/v1/account/export", headers=auth(tok))
    assert r.status_code == 200 and r.headers["content-disposition"].startswith("attachment")
    data = json.loads(r.content)
    assert data["account"]["email"] == "gdpr@example.org" and data["profile"][0]["city"] == "Multan"
    assert "password_hash" not in r.text and "refresh_hash" not in r.text

    bad = await client.post("/api/v1/account/deletion-request", headers=auth(tok), json={"password": "wrong", "reason": "x"})
    assert bad.status_code == 422
    req = (await client.post("/api/v1/account/deletion-request", headers=auth(tok), json={"password": PW, "reason": "Moving on"})).json()[
        "data"
    ]
    assert req["status"] == "pending"
    assert (await client.post("/api/v1/account/deletion-request", headers=auth(tok), json={"password": PW})).status_code == 409

    h = auth(installed)
    queue = (await client.get("/api/v1/admin/privacy/requests", headers=h)).json()["data"]
    assert any(q["id"] == req["id"] and q["user"]["email"] == "gdpr@example.org" for q in queue)
    assert (await client.post(f"/api/v1/admin/privacy/requests/{req['id']}/approve", headers=h, json={"note": "Done"})).status_code == 200

    # signed out everywhere, cannot sign in again, no longer findable
    assert (await client.get("/api/v1/alumni/me", headers=auth(tok))).status_code in (401, 403)
    assert (await client.post("/api/v1/auth/login", json={"email": "gdpr@example.org", "password": PW})).status_code in (401, 403)
    users = (await client.get("/api/v1/admin/users?q=gdpr", headers=h)).json()["data"]
    assert not users
    other, _ = await _member(client, "gdpr-other@example.org", "Other Person")
    assert "Gita" not in (await client.get("/api/v1/alumni/directory?q=Gita", headers=auth(other))).text
