import pyotp

from app.core import secrets

from .conftest import auth, last_email_link


async def _make_user(client, token, email, roles, password="An0therPassword!"):
    r = await client.post("/api/v1/admin/users", headers=auth(token),
                          json={"full_name": "Test User", "email": email, "roles": roles, "password": password})
    assert r.status_code == 201, r.text
    return r.json()["data"]


async def _login(client, email, password):
    return await client.post("/api/v1/auth/login", json={"email": email, "password": password})


async def test_login_errors_and_lockout(client, installed):
    await _make_user(client, installed, "lock@example.org", ["verified_alumni"])
    r = await _login(client, "nobody@example.org", "whatever123")
    assert r.status_code == 401 and r.json()["error"]["code"] == "INVALID_CREDENTIALS"
    for _ in range(5):
        r = await _login(client, "lock@example.org", "wrong-password")
    r = await _login(client, "lock@example.org", "An0therPassword!")
    assert r.status_code == 423 and r.json()["error"]["code"] == "ACCOUNT_LOCKED"
    # admin can unlock
    users = (await client.get("/api/v1/admin/users?q=lock@", headers=auth(installed))).json()["data"]
    assert users[0]["locked"] is True
    await client.post(f"/api/v1/admin/users/{users[0]['id']}/unlock", headers=auth(installed))
    assert (await _login(client, "lock@example.org", "An0therPassword!")).status_code == 200


async def test_refresh_rotation_and_reuse_detection(client, installed):
    await _make_user(client, installed, "refresh@example.org", ["verified_alumni"])
    r = await _login(client, "refresh@example.org", "An0therPassword!")
    assert r.status_code == 200
    first = r.cookies.get("sst_rt")
    access = r.json()["data"]["access_token"]
    r2 = await client.post("/api/v1/auth/refresh", cookies={"sst_rt": first})
    assert r2.status_code == 200
    second = r2.cookies.get("sst_rt")
    assert second and second != first
    # a near-simultaneous replay (two tabs) is refused without ending other sessions
    r3 = await client.post("/api/v1/auth/refresh", cookies={"sst_rt": first})
    assert r3.status_code == 401
    assert (await client.get("/api/v1/auth/me", headers=auth(access))).status_code == 200
    # a later replay of the rotated token is treated as theft: every session ends
    from datetime import timedelta

    from sqlalchemy import update

    from app.core.db import SessionLocal
    from app.models import Session

    async with SessionLocal() as db:
        await db.execute(update(Session).where(Session.rotated_at.is_not(None), Session.prev_refresh_hash.is_not(None))
                         .values(rotated_at=Session.rotated_at - timedelta(minutes=5)))
        await db.commit()
    r3 = await client.post("/api/v1/auth/refresh", cookies={"sst_rt": first})
    assert r3.status_code == 401
    r4 = await client.get("/api/v1/auth/me", headers=auth(access))
    assert r4.status_code == 401
    assert (await client.post("/api/v1/auth/refresh", cookies={"sst_rt": second})).status_code == 401
    client.cookies.clear()


async def test_password_reset_flow(client, installed):
    await _make_user(client, installed, "reset@example.org", ["verified_alumni"])
    r = await client.post("/api/v1/auth/password/forgot", json={"email": "reset@example.org"})
    assert r.status_code == 202
    # unknown addresses get the same answer
    r = await client.post("/api/v1/auth/password/forgot", json={"email": "ghost@example.org"})
    assert r.status_code == 202
    token = last_email_link("/reset-password")
    r = await client.post("/api/v1/auth/password/reset", json={"token": token, "password": "weak"})
    assert r.status_code == 422
    r = await client.post("/api/v1/auth/password/reset", json={"token": token, "password": "BrandNewPass123"})
    assert r.status_code == 200
    r = await client.post("/api/v1/auth/password/reset", json={"token": token, "password": "BrandNewPass123"})
    assert r.status_code == 400  # single use
    assert (await _login(client, "reset@example.org", "BrandNewPass123")).status_code == 200


async def test_two_factor(client, installed):
    await _make_user(client, installed, "mfa@example.org", ["verified_alumni"])
    token = (await _login(client, "mfa@example.org", "An0therPassword!")).json()["data"]["access_token"]
    setup = (await client.post("/api/v1/auth/mfa/setup", headers=auth(token))).json()["data"]
    r = await client.post("/api/v1/auth/mfa/enable", headers=auth(token), json={"code": "000000"})
    assert r.status_code == 400
    r = await client.post("/api/v1/auth/mfa/enable", headers=auth(token),
                          json={"code": pyotp.TOTP(setup["secret"]).now()})
    recovery = r.json()["data"]["recovery_codes"]
    assert len(recovery) == 8
    r = await _login(client, "mfa@example.org", "An0therPassword!")
    data = r.json()["data"]
    assert data["mfa_required"] is True and "access_token" not in data
    r = await client.post("/api/v1/auth/login/mfa", json={"challenge": data["challenge"], "code": "123456"})
    assert r.status_code == 401
    r = await client.post("/api/v1/auth/login/mfa", json={"challenge": data["challenge"],
                                                          "code": pyotp.TOTP(setup["secret"]).now()})
    assert r.status_code == 200 and r.json()["data"]["user"]["mfa_enabled"] is True
    # recovery code works once
    data = (await _login(client, "mfa@example.org", "An0therPassword!")).json()["data"]
    r = await client.post("/api/v1/auth/login/mfa", json={"challenge": data["challenge"], "code": recovery[0]})
    assert r.status_code == 200
    data = (await _login(client, "mfa@example.org", "An0therPassword!")).json()["data"]
    r = await client.post("/api/v1/auth/login/mfa", json={"challenge": data["challenge"], "code": recovery[0]})
    assert r.status_code == 401


async def test_change_password_and_sessions(client, installed):
    await _make_user(client, installed, "change@example.org", ["verified_alumni"])
    a = (await _login(client, "change@example.org", "An0therPassword!")).json()["data"]["access_token"]
    b = (await _login(client, "change@example.org", "An0therPassword!")).json()["data"]["access_token"]
    sessions = (await client.get("/api/v1/auth/sessions", headers=auth(a))).json()["data"]
    assert len(sessions) == 2 and sum(s["current"] for s in sessions) == 1
    r = await client.post("/api/v1/auth/password/change", headers=auth(a),
                          json={"current_password": "wrong", "new_password": "Something123New"})
    assert r.status_code == 400
    r = await client.post("/api/v1/auth/password/change", headers=auth(a),
                          json={"current_password": "An0therPassword!", "new_password": "Something123New"})
    assert r.status_code == 200
    assert (await client.get("/api/v1/auth/me", headers=auth(a))).status_code == 200  # this device stays
    assert (await client.get("/api/v1/auth/me", headers=auth(b))).status_code == 401  # others signed out
    r = await client.post("/api/v1/auth/logout-all", headers=auth(a))
    assert r.json()["data"]["sessions_ended"] == 1
    assert (await client.get("/api/v1/auth/me", headers=auth(a))).status_code == 401


async def test_unauthenticated_and_forged_tokens(client, installed):
    assert (await client.get("/api/v1/auth/me")).status_code == 401
    assert (await client.get("/api/v1/admin/users")).status_code == 401
    assert (await client.get("/api/v1/auth/me", headers=auth("not.a.token"))).status_code == 401
    import jwt

    forged = jwt.encode({"sub": "00000000-0000-0000-0000-000000000000", "sid": "x", "typ": "access", "exp": 9999999999},
                        "wrong-key", algorithm="HS256")
    assert (await client.get("/api/v1/auth/me", headers=auth(forged))).status_code == 401
    assert secrets.get("jwt_signing_key")  # generated, never from source
