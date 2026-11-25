"""Mobile app support: token-based refresh, device registration, push fan-out and preferences."""

from app import worker
from app.services.push import messages

from .conftest import auth
from .test_alumni import PW
from .test_community import _verified

M = {"X-Client": "mobile"}


def _pushes():
    return [p for n, p in worker.TEST_OUTBOX if n == "app.tasks.send_push"]


async def test_mobile_login_and_refresh_rotation(client, installed):
    await _verified(client, installed, "mob-auth@example.org", "Mona Mobile", 2015)
    client.cookies.clear()
    r = await client.post("/api/v1/auth/login", json={"email": "mob-auth@example.org", "password": PW}, headers=M)
    d = r.json()["data"]
    assert d["refresh_token"] and "sst_rt" not in r.headers.get("set-cookie", "")
    r2 = (await client.post("/api/v1/auth/refresh", headers={**M, "X-Refresh-Token": d["refresh_token"]})).json()["data"]
    assert r2["access_token"] and r2["refresh_token"] != d["refresh_token"]
    # the header is ignored for browsers, and an old token is rejected after the grace period logic (rotated)
    assert (await client.post("/api/v1/auth/refresh", headers={"X-Refresh-Token": r2["refresh_token"]})).json()["data"] is None
    bad = await client.post("/api/v1/auth/refresh", headers={**M, "X-Refresh-Token": "nope"})
    assert bad.status_code == 401
    out = await client.post("/api/v1/auth/logout", headers={**M, "X-Refresh-Token": r2["refresh_token"]})
    assert out.status_code == 200
    assert (await client.post("/api/v1/auth/refresh", headers={**M, "X-Refresh-Token": r2["refresh_token"]})).status_code == 401


async def test_devices_and_push_fan_out(client, installed):
    a_tok, a_id = await _verified(client, installed, "push-a@example.org", "Asma Push", 2016)
    b_tok, b_id = await _verified(client, installed, "push-b@example.org", "Basit Push", 2016)
    bad = await client.post("/api/v1/devices", headers=auth(b_tok), json={"token": "not-a-token", "platform": "android"})
    assert bad.status_code == 422
    tok = "ExponentPushToken[abcDEF123456]"
    for _ in range(2):  # idempotent
        assert (
            await client.post("/api/v1/devices", headers=auth(b_tok), json={"token": tok, "platform": "android", "device_name": "Pixel"})
        ).status_code == 200
    assert len((await client.get("/api/v1/devices", headers=auth(b_tok))).json()["data"]) == 1

    # a notification (connection request) reaches B's phone
    worker.TEST_OUTBOX.clear()
    await client.post("/api/v1/alumni/connections", headers=auth(a_tok), json={"user_id": b_id})
    p = _pushes()
    assert p and p[0]["tokens"] == [tok] and p[0]["data"]["category"] == "connections"
    msg = messages(p[0])[0]
    assert msg["to"] == tok and msg["channelId"] == "connections" and msg["priority"] == "high"

    # turning connection pushes off stops them, bell still works
    await client.put(
        "/api/v1/notifications/preferences",
        headers=auth(b_tok),
        json=[{"category": "connections", "in_app": True, "email": False, "push": False}],
    )
    prefs = {x["category"]: x for x in (await client.get("/api/v1/notifications/preferences", headers=auth(b_tok))).json()["data"]}
    assert prefs["connections"]["push"] is False and prefs["messages"]["push"] is True
    req = (await client.get("/api/v1/alumni/connections?type=received", headers=auth(b_tok))).json()["data"][0]["request_id"]
    await client.post(f"/api/v1/alumni/connections/{req}/accept", headers=auth(b_tok))

    # a chat message pushes to B (collapsed per conversation); muting the conversation stops it
    conv = (await client.post("/api/v1/messages/conversations/direct", headers=auth(a_tok), json={"user_id": b_id})).json()["data"]
    worker.TEST_OUTBOX.clear()
    await client.post(
        f"/api/v1/messages/conversations/{conv['id']}/messages", headers=auth(a_tok), json={"body": "Salam!", "client_id": "c-1"}
    )
    p = _pushes()
    assert p and p[0]["data"]["category"] == "messages" and p[0]["collapse"] == f"conv-{conv['id']}" and p[0]["body"] == "Salam!"
    await client.put(f"/api/v1/messages/conversations/{conv['id']}/settings", headers=auth(b_tok), json={"muted": True})
    worker.TEST_OUTBOX.clear()
    await client.post(
        f"/api/v1/messages/conversations/{conv['id']}/messages", headers=auth(a_tok), json={"body": "Again", "client_id": "c-2"}
    )
    assert not _pushes()

    # announcements are broadcast to every device
    h = auth(installed)
    n = (
        await client.post(
            "/api/v1/admin/news", headers=h, json={"title": "Reunion date fixed", "category": "announcement", "summary": "12 December"}
        )
    ).json()["data"]
    worker.TEST_OUTBOX.clear()
    await client.post(f"/api/v1/admin/news/{n['id']}/publish", headers=h, json={"publish": True})
    p = _pushes()
    assert p and tok in p[0]["tokens"] and p[0]["data"]["category"] == "announcements"

    # sign-out on the phone unregisters it
    await client.post("/api/v1/devices/unregister", headers=auth(b_tok), json={"token": tok})
    assert (await client.get("/api/v1/devices", headers=auth(b_tok))).json()["data"] == []
