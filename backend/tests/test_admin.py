import io

from PIL import Image

from .conftest import ADMIN, auth


async def _user_token(client, admin_token, email, roles):
    r = await client.post("/api/v1/admin/users", headers=auth(admin_token),
                          json={"full_name": "Staff Member", "email": email, "roles": roles, "password": "StaffPass1234"})
    assert r.status_code == 201, r.text
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": "StaffPass1234"})
    return r.json()["data"]["access_token"], r.json()["data"]["user"]["id"]


async def test_rbac_enforced_on_backend(client, installed):
    editor, _ = await _user_token(client, installed, "editor@example.org", ["content_editor"])
    alumni, _ = await _user_token(client, installed, "member@example.org", ["verified_alumni"])
    assert (await client.get("/api/v1/admin/users", headers=auth(editor))).status_code == 403
    assert (await client.get("/api/v1/admin/media", headers=auth(editor))).status_code == 200
    assert (await client.get("/api/v1/admin/config/settings/general", headers=auth(editor))).status_code == 403
    assert (await client.get("/api/v1/admin/media", headers=auth(alumni))).status_code == 403
    # duplicate email rejected
    r = await client.post("/api/v1/admin/users", headers=auth(installed),
                          json={"full_name": "Dup", "email": "EDITOR@example.org", "roles": ["guest"], "password": "StaffPass1234"})
    assert r.status_code == 409


async def test_role_escalation_blocked(client, installed):
    sysadmin, _ = await _user_token(client, installed, "sysadmin@example.org", ["system_admin"])
    # system admin may manage roles but cannot grant permissions it lacks (e.g. donations)
    r = await client.post("/api/v1/admin/roles", headers=auth(sysadmin),
                          json={"name": "Finance helper", "permissions": ["donations.view"]})
    assert r.status_code == 403
    r = await client.post("/api/v1/admin/roles", headers=auth(sysadmin),
                          json={"name": "Media helper", "is_staff": True, "permissions": ["media.view", "media.create"]})
    assert r.status_code == 201
    # and cannot hand out super admin
    r = await client.post("/api/v1/admin/users", headers=auth(sysadmin),
                          json={"full_name": "Xavier", "email": "x@example.org", "roles": ["super_admin"], "password": "StaffPass1234"})
    assert r.status_code == 403
    roles = (await client.get("/api/v1/admin/roles", headers=auth(installed))).json()["data"]
    assert len([x for x in roles if x["is_system"]]) == 15


async def test_last_super_admin_protected(client, installed):
    me = (await client.get("/api/v1/auth/me", headers=auth(installed))).json()["data"]
    r = await client.patch(f"/api/v1/admin/users/{me['id']}", headers=auth(installed), json={"roles": ["system_admin"]})
    assert r.status_code == 409
    r = await client.patch(f"/api/v1/admin/users/{me['id']}", headers=auth(installed), json={"status": "deactivated"})
    assert r.status_code == 409


async def test_settings_validation_and_audit(client, installed):
    r = await client.get("/api/v1/admin/config/settings/security", headers=auth(installed))
    sec = r.json()["data"]
    r = await client.put("/api/v1/admin/config/settings/security", headers=auth(installed),
                         json={**sec, "allowed_file_types": ["pdf", "exe"]})
    assert r.status_code == 422
    r = await client.put("/api/v1/admin/config/settings/security", headers=auth(installed),
                         json={**sec, "max_login_attempts": 1})
    assert r.status_code == 422  # lockout cannot be disabled
    r = await client.put("/api/v1/admin/config/settings/realtime", headers=auth(installed),
                         json={"heartbeat_interval_seconds": 30})
    assert r.status_code == 200 and r.json()["meta"]["restart_required"] == ["heartbeat_interval_seconds"]
    logs = (await client.get("/api/v1/admin/audit-logs?entity=settings", headers=auth(installed))).json()
    assert logs["meta"]["total"] >= 1
    csv = await client.get("/api/v1/admin/audit-logs/export", headers=auth(installed))
    assert csv.status_code == 200 and "Summary" in csv.text


async def test_branding_draft_and_publish(client, installed):
    b = (await client.get("/api/v1/admin/config/branding", headers=auth(installed))).json()["data"]
    draft = {**b["draft"], "colors": {**b["draft"]["colors"], "primary": "#123456"}}
    r = await client.put("/api/v1/admin/config/branding", headers=auth(installed), json=draft)
    assert r.json()["data"]["has_unpublished_changes"] is True
    site = (await client.get("/api/v1/public/site")).json()["data"]
    assert site["branding"]["colors"]["primary"] == "#7138DB"  # not public yet
    r = await client.put("/api/v1/admin/config/branding", headers=auth(installed),
                         json={**draft, "colors": {**draft["colors"], "primary": "purple"}})
    assert r.status_code == 422
    await client.post("/api/v1/admin/config/branding/publish", headers=auth(installed))
    from app.core import settings_store

    settings_store._cache.clear()
    site = (await client.get("/api/v1/public/site")).json()["data"]
    assert site["branding"]["colors"]["primary"] == "#123456"


async def test_modules_and_flags(client, installed):
    r = await client.put("/api/v1/admin/config/modules/jobs", headers=auth(installed), json={"enabled": False})
    assert r.status_code == 200
    site = (await client.get("/api/v1/public/site")).json()["data"]
    assert site["modules"]["jobs"] is False and site["modules"]["events"] is True
    await client.put("/api/v1/admin/config/modules/jobs", headers=auth(installed), json={"enabled": True})
    r = await client.put("/api/v1/admin/config/feature-flags/beta_dark_mode", headers=auth(installed),
                         json={"enabled": True, "roles": ["super_admin"]})
    assert r.status_code == 200
    anon = (await client.get("/api/v1/public/site")).json()["data"]["features"]
    mine = (await client.get("/api/v1/public/site", headers=auth(installed))).json()["data"]["features"]
    assert anon["beta_dark_mode"] is False and mine["beta_dark_mode"] is True


async def test_integration_secrets_never_returned(client, installed):
    body = {"provider": "smtp", "enabled": True, "secrets": {"password": "s3cret-smtp-pass"},
            "config": {"host": "smtp.example.org", "port": 587, "encryption": "starttls", "username": "mailer",
                       "sender_email": "alumni@example.org"}}
    r = await client.put("/api/v1/admin/config/integrations/email", headers=auth(installed), json=body)
    assert r.status_code == 200
    assert "s3cret" not in r.text and r.json()["data"]["secrets"]["password"] == "••••••••"
    # saving again with the mask keeps the stored secret
    r = await client.put("/api/v1/admin/config/integrations/email", headers=auth(installed),
                         json={**body, "secrets": {"password": "••••••••"}})
    from app.core.db import SessionLocal
    from app.services import integrations

    async with SessionLocal() as db:
        assert (await integrations.load(db, "email")).secrets["password"] == "s3cret-smtp-pass"
    listing = await client.get("/api/v1/admin/config/integrations", headers=auth(installed))
    assert "s3cret" not in listing.text
    r = await client.put("/api/v1/admin/config/integrations/email", headers=auth(installed),
                         json={**body, "config": {**body["config"], "sender_email": "nope"}})
    assert r.status_code == 422


async def test_media_upload_validation(client, installed):
    buf = io.BytesIO()
    Image.new("RGB", (1600, 900), (113, 56, 219)).save(buf, format="JPEG")
    r = await client.post("/api/v1/admin/media", headers=auth(installed),
                          files={"file": ("banner.jpg", buf.getvalue(), "image/jpeg")}, data={"folder": "branding"})
    assert r.status_code == 201, r.text
    m = r.json()["data"]
    assert m["width"] == 1600 and [v["width"] for v in m["variants"]] == [160, 480, 1200]
    served = await client.get(m["url"])
    assert served.status_code == 200 and served.headers["content-type"] == "image/jpeg"
    # disguised executable
    r = await client.post("/api/v1/admin/media", headers=auth(installed),
                          files={"file": ("photo.jpg", b"MZ\x90\x00" + b"\x00" * 200, "image/jpeg")})
    assert r.status_code == 415
    # SVG (script-capable) refused
    r = await client.post("/api/v1/admin/media", headers=auth(installed),
                          files={"file": ("logo.svg", b"<svg xmlns='http://www.w3.org/2000/svg'><script>x</script></svg>",
                                          "image/svg+xml")})
    assert r.status_code == 415


async def test_health_and_metrics(client, installed):
    r = await client.get("/api/v1/admin/health", headers=auth(installed))
    data = r.json()["data"]
    assert data["checks"]["database"]["ok"] and data["checks"]["redis"]["ok"]
    assert any("p95_ms" in row for row in data["latency"])
    assert "server-timing" in r.headers
    assert (await client.get("/metrics")).status_code == 200
    assert ADMIN["email"]


async def test_dashboard_and_profile(client, installed):
    r = await client.get("/api/v1/admin/dashboard", headers=auth(installed))
    d = r.json()["data"]
    assert r.status_code == 200 and d["users_total"] >= 1 and d["staff"] >= 1 and d["recent_activity"]
    r = await client.patch("/api/v1/auth/me", headers=auth(installed), json={"full_name": "Asad M.", "phone": "+92 300 1234567"})
    assert r.status_code == 200 and r.json()["data"]["full_name"] == "Asad M." and r.json()["data"]["phone"] == "+923001234567"
    assert r.json()["data"]["phone_verified"] is False
