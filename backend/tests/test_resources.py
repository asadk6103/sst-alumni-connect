"""Redesign phase 5 — resource hub: member uploads + review, downloads, saves, summary, featured, collections."""

from .conftest import auth
from .test_communities import PDF
from .test_community import _verified


async def test_upload_review_download_save_collections(client, installed):
    a_tok, _ = await _verified(client, installed, "res-a@example.org", "Ayan Resources", 2016)
    b_tok, _ = await _verified(client, installed, "res-b@example.org", "Basma Resources", 2016)
    bad = await client.post("/api/v1/resources/uploads", headers=auth(a_tok), files={"file": ("x.exe", b"MZ", "application/octet-stream")})
    assert bad.status_code == 415
    up = (
        await client.post("/api/v1/resources/uploads", headers=auth(a_tok), files={"file": ("cv-guide.pdf", PDF, "application/pdf")})
    ).json()["data"]
    assert up["file_type"] == "pdf"
    assert (
        await client.post("/api/v1/resources", headers=auth(a_tok), json={"title": "CV guide", "category": "career"})
    ).status_code == 422
    r = (
        await client.post(
            "/api/v1/resources",
            headers=auth(a_tok),
            json={"title": "CV writing guide", "category": "career", "media_id": up["id"], "description": "Templates"},
        )
    ).json()["data"]
    assert r["status"] == "pending" and r["url"] is None
    # hidden from others until reviewed; uploader sees it under "uploads"
    assert (await client.get(f"/api/v1/resources/{r['id']}", headers=auth(b_tok))).status_code == 404
    mine = (await client.get("/api/v1/resources?scope=uploads", headers=auth(a_tok))).json()["data"]
    assert [x["id"] for x in mine] == [r["id"]]
    assert (
        await client.post(f"/api/v1/admin/resources/{r['id']}/decide", headers=auth(installed), json={"approve": False})
    ).status_code == 422
    await client.post(f"/api/v1/admin/resources/{r['id']}/decide", headers=auth(installed), json={"approve": True})
    await client.post(f"/api/v1/admin/resources/{r['id']}/feature", headers=auth(installed), json={"featured": True})
    feat = (await client.get("/api/v1/resources?featured=true", headers=auth(b_tok))).json()["data"]
    assert r["id"] in [x["id"] for x in feat]
    # link resources by staff publish directly
    link = (
        await client.post(
            "/api/v1/resources",
            headers=auth(installed),
            json={"title": "Alumni talk", "category": "videos", "kind": "video", "url": "https://video.example.org/1"},
        )
    ).json()["data"]
    assert link["status"] == "published" and link["url"] == "https://video.example.org/1"
    # download (counted) + save + summary
    d = (await client.post(f"/api/v1/resources/{r['id']}/download", headers=auth(b_tok))).json()["data"]
    assert d["url"] and d["filename"] == "CV writing guide.pdf"
    await client.post(f"/api/v1/resources/{r['id']}/download", headers=auth(b_tok))
    assert (await client.get(f"/api/v1/resources/{r['id']}", headers=auth(b_tok))).json()["data"]["downloads"] == 2
    await client.put(f"/api/v1/resources/{r['id']}/save", headers=auth(b_tok))
    s = (await client.get("/api/v1/resources/summary", headers=auth(b_tok))).json()["data"]
    assert s["downloads"] == 1 and s["saved"] == 1 and s["uploads"] == 0 and s["categories"]["career"] >= 1 and s["can_upload"]
    saved = (await client.get("/api/v1/resources?scope=saved", headers=auth(b_tok))).json()["data"]
    assert [x["id"] for x in saved] == [r["id"]] and saved[0]["saved"]
    # collections
    c = (
        await client.post(
            "/api/v1/admin/resources/collections",
            headers=auth(installed),
            json={"title": "Career Development Pack", "icon": "briefcase", "resource_ids": [r["id"], link["id"]]},
        )
    ).json()["data"]
    cols = (await client.get("/api/v1/resources/collections", headers=auth(b_tok))).json()["data"]
    assert next(x for x in cols if x["id"] == c["id"])["count"] == 2
    one = (await client.get(f"/api/v1/resources/collections/{c['id']}", headers=auth(b_tok))).json()["data"]
    assert [x["id"] for x in one["resources"]] == [r["id"], link["id"]]
    # only the uploader (or staff) may delete
    assert (await client.delete(f"/api/v1/resources/{r['id']}", headers=auth(b_tok))).status_code == 403
    assert (await client.delete(f"/api/v1/resources/{r['id']}", headers=auth(a_tok))).status_code == 200
