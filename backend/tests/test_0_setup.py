from app.core import secrets

from .conftest import ADMIN, SETUP_BODY, auth


async def test_setup_flow(client):
    r = await client.get("/api/v1/setup/status")
    assert r.json()["data"]["installed"] is False
    assert r.json()["data"]["checks"]["database"]["ok"] is True

    code = secrets.ensure_setup_code()
    r = await client.post("/api/v1/setup/verify-code", json={"code": "WRONG-CODE1"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "INVALID_SETUP_CODE"

    weak = {**SETUP_BODY, "admin": {**ADMIN, "password": "short"}}
    r = await client.post("/api/v1/setup/complete", json={"code": code, **weak})
    assert r.status_code == 422 and r.json()["error"]["code"] == "WEAK_PASSWORD"

    bad_url = {**SETUP_BODY, "institution": {**SETUP_BODY["institution"], "app_url": "not a url"}}
    r = await client.post("/api/v1/setup/complete", json={"code": code, **bad_url})
    assert r.status_code == 422

    r = await client.post("/api/v1/setup/complete", json={"code": code, **SETUP_BODY})
    assert r.status_code == 201, r.text
    body = r.json()["data"]
    assert body["user"]["roles"][0]["key"] == "super_admin"
    assert "set-cookie" in r.headers and "httponly" in r.headers["set-cookie"].lower()

    # locked afterwards; code removed
    r = await client.get("/api/v1/setup/status")
    assert r.json()["data"] == {"installed": True}
    r = await client.post("/api/v1/setup/complete", json={"code": code, **SETUP_BODY})
    assert r.status_code == 409
    assert not secrets.check_setup_code(code)

    # settings from the wizard are live
    site = (await client.get("/api/v1/public/site")).json()["data"]
    assert site["institution_name"] == "SST Public School Rashidabad"
    assert site["app_url"] == "https://alumni.example.org"
    assert site["branding"]["colors"]["primary"] == "#7138DB"

    me = (await client.get("/api/v1/auth/me", headers=auth(body["access_token"]))).json()["data"]
    assert "settings.configure" in me["permissions"] and me["is_staff"]
