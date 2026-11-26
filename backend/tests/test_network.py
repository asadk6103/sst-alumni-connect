"""Redesign phase 2 — mutual connections, network summary, suggestions, directory filters, profile cover / overview / activity."""

import io

from PIL import Image

from .conftest import auth
from .test_community import _verified
from .test_feed import _connect


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 32), (113, 56, 219)).save(buf, "PNG")
    return buf.getvalue()


async def test_mutual_connections_and_summary(client, installed):
    a_tok, a_id = await _verified(client, installed, "net-a@example.org", "Anam Network", 2020)
    b_tok, b_id = await _verified(client, installed, "net-b@example.org", "Bilal Network", 2020)
    c_tok, c_id = await _verified(client, installed, "net-c@example.org", "Chand Network", 2020)
    await _connect(client, a_tok, b_tok, b_id)  # A–B
    await _connect(client, c_tok, b_tok, b_id)  # C–B  → B is a mutual connection of A and C
    rows = (await client.get("/api/v1/alumni/directory?q=Chand", headers=auth(a_tok))).json()["data"]
    chand = next(r for r in rows if r["id"] == c_id)
    assert chand["mutual"] == 1 and chand["mutual_ids"] == [b_id] and chand["online"] is False
    s = (await client.get("/api/v1/alumni/network/summary", headers=auth(a_tok))).json()["data"]
    assert s["network"]["connections"] == 1 and s["tabs"]["same_batch"] >= 2 and s["me"]["graduation_year"] == 2020
    assert isinstance(s["by_batch"], list) and isinstance(s["common_groups"], list)
    sugg = (await client.get("/api/v1/alumni/suggestions", headers=auth(a_tok))).json()["data"]
    assert any(x["id"] == c_id for x in sugg)  # same batch, not yet connected
    # year list filter
    rows = (await client.get("/api/v1/alumni/directory?years=2020,1999", headers=auth(a_tok))).json()["data"]
    assert {r["graduation_year"] for r in rows} == {2020}
    facets = (await client.get("/api/v1/alumni/directory/facets", headers=auth(a_tok))).json()["data"]
    assert "organizations" in facets and "designations" in facets and "groups" in facets


async def test_cover_overview_activity(client, installed):
    a_tok, a_id = await _verified(client, installed, "prof-a@example.org", "Parveen Profile", 2021)
    b_tok, _ = await _verified(client, installed, "prof-b@example.org", "Qasim Profile", 2021)
    r = await client.post("/api/v1/alumni/me/cover", headers=auth(a_tok), files={"file": ("c.png", _png(), "image/png")})
    assert r.status_code == 200 and r.json()["data"]["url"]
    files = {"file": ("p.png", _png(), "image/png")}
    up = (await client.post("/api/v1/community/uploads", headers=auth(a_tok), files=files)).json()["data"]
    body = {"body": "Campus memories", "media_ids": [up["id"]]}
    post = (await client.post("/api/v1/community/posts", headers=auth(a_tok), json=body)).json()["data"]
    await client.post(f"/api/v1/community/posts/{post['id']}/comments", headers=auth(a_tok), json={"body": "Good old days"})
    view = (await client.get(f"/api/v1/alumni/profiles/{a_id}", headers=auth(b_tok))).json()["data"]
    assert view["cover"]["url"]
    ov = (await client.get(f"/api/v1/alumni/profiles/{a_id}/overview", headers=auth(b_tok))).json()["data"]
    assert ov["photo_count"] == 1 and len(ov["photos"]) == 1 and ov["post_count"] == 1
    act = (await client.get(f"/api/v1/alumni/profiles/{a_id}/activity", headers=auth(b_tok))).json()["data"]
    assert [x["type"] for x in act] == ["comment", "post"]
    feed = (await client.get(f"/api/v1/community/feed?author_id={a_id}", headers=auth(b_tok))).json()["data"]
    assert [x["id"] for x in feed] == [post["id"]]
    assert (await client.delete("/api/v1/alumni/me/cover", headers=auth(a_tok))).status_code == 200


async def test_corrupt_image_is_rejected(client, installed):
    tok, _ = await _verified(client, installed, "bad-img@example.org", "Badar Image", 2021)
    bad = _png()[:60]  # valid header, truncated pixel data
    r = await client.post("/api/v1/alumni/me/cover", headers=auth(tok), files={"file": ("c.png", bad, "image/png")})
    assert r.status_code == 415
