"""Stage 4 — notifications, donations and scholarships, newsletters, gallery."""

import io
import re
import uuid

from PIL import Image

from app import worker

from .conftest import auth
from .test_community import _verified


def _sent(subject_part: str) -> list[dict]:
    return [p for n, p in worker.TEST_OUTBOX if n == "app.tasks.send_email" and subject_part in p.get("subject", "")]


async def test_notifications_and_preferences(client, installed):
    a_tok, a_id = await _verified(client, installed, "nt-a@example.org", "Nadia Notify", 2007)
    b_tok, b_id = await _verified(client, installed, "nt-b@example.org", "Bilal Notify", 2007)
    prefs = (await client.get("/api/v1/notifications/preferences", headers=auth(b_tok))).json()["data"]
    assert any(p["category"] == "connections" and p["email"] for p in prefs)
    # B turns connection emails off but keeps the bell
    await client.put(
        "/api/v1/notifications/preferences", headers=auth(b_tok), json=[{"category": "connections", "in_app": True, "email": False}]
    )
    worker.TEST_OUTBOX.clear()
    await client.post("/api/v1/alumni/connections", headers=auth(a_tok), json={"user_id": b_id, "message": "Hi!"})
    assert not _sent("wants to connect")
    n = (await client.get("/api/v1/notifications?category=connections", headers=auth(b_tok))).json()
    assert n["data"][0]["kind"] == "connection_request" and n["data"][0]["actor"]["id"] == a_id and not n["data"][0]["read"]
    kinds = [x["kind"] for x in (await client.get("/api/v1/notifications", headers=auth(b_tok))).json()["data"]]
    assert "verified" in kinds  # approval also notified the member
    assert (await client.get("/api/v1/notifications/unread-count", headers=auth(b_tok))).json()["data"]["unread"] == 2
    await client.post("/api/v1/notifications/read-all", headers=auth(b_tok))
    assert (await client.get("/api/v1/notifications/unread-count", headers=auth(b_tok))).json()["data"]["unread"] == 0
    # A keeps email on: B's acceptance emails A and notifies in-app
    req = (await client.get("/api/v1/alumni/connections?type=received", headers=auth(b_tok))).json()["data"][0]["request_id"]
    worker.TEST_OUTBOX.clear()
    await client.post(f"/api/v1/alumni/connections/{req}/accept", headers=auth(b_tok))
    assert _sent("accepted your connection request")
    assert (await client.get("/api/v1/notifications?unread=true", headers=auth(a_tok))).json()["data"][0]["kind"] == "connection_accepted"


async def test_donations_pledge_confirm_receipt(client, installed):
    h = auth(installed)
    cfg = (await client.get("/api/v1/admin/config/settings/donations", headers=h)).json()["data"]
    await client.put(
        "/api/v1/admin/config/settings/donations",
        headers=h,
        json={**cfg, "bank_name": "HBL", "account_title": "SST Alumni Fund", "iban": "PK00HABB0000000000000000", "min_amount": 500},
    )
    c = (
        await client.post(
            "/api/v1/admin/donations/campaigns",
            headers=h,
            json={
                "title": "Library renovation",
                "category": "library",
                "summary": "New books and reading rooms",
                "goal_amount": "1000000",
                "currency": "PKR",
            },
        )
    ).json()["data"]
    d_tok, d_id = await _verified(client, installed, "donor@example.org", "Dania Donor", 2003)
    o_tok, _ = await _verified(client, installed, "other-donor@example.org", "Omar Other", 2003)
    assert (
        await client.post("/api/v1/donations/pledges", headers=auth(d_tok), json={"campaign_id": c["id"], "amount": "5000"})
    ).status_code == 409  # draft
    await client.post(f"/api/v1/admin/donations/campaigns/{c['id']}/status", headers=h, json={"status": "active"})
    assert (
        await client.post("/api/v1/donations/pledges", headers=auth(d_tok), json={"campaign_id": c["id"], "amount": "100"})
    ).status_code == 422
    worker.TEST_OUTBOX.clear()
    p = (
        await client.post(
            "/api/v1/donations/pledges",
            headers=auth(d_tok),
            json={"campaign_id": c["id"], "amount": "25000", "recognition_consent": True, "message": "For the library!"},
        )
    ).json()["data"]
    assert p["status"] == "pledged" and p["reference"].startswith("DN-") and p["payment_info"]["bank"]["iban"].startswith("PK")
    assert p["payment_info"]["online_available"] is False
    assert _sent(p["reference"]) and "PK00HABB" in _sent(p["reference"])[0]["html"]
    assert (await client.get(f"/api/v1/donations/{p['id']}/receipt", headers=auth(d_tok))).status_code == 404  # not paid yet

    worker.TEST_OUTBOX.clear()
    r = (await client.post(f"/api/v1/admin/donations/{p['id']}/confirm", headers=h, json={"payment_reference": "HBL-TRX-991"})).json()[
        "data"
    ]
    assert r["status"] == "completed" and r["receipt_no"].startswith("RC-") and _sent("Receipt")
    camp = (await client.get(f"/api/v1/donations/campaigns/{c['id']}", headers=auth(o_tok))).json()["data"]
    assert camp["raised_amount"] == 25000 and camp["donor_count"] == 1 and camp["progress"] == 2
    assert camp["donors"][0]["name"] == "Dania Donor" and camp["donors"][0]["message"] == "For the library!"
    html = await client.get(f"/api/v1/donations/{p['id']}/receipt", headers=auth(d_tok))
    assert html.status_code == 200 and r["receipt_no"] in html.text and "Library renovation" in html.text
    assert (await client.get(f"/api/v1/donations/{p['id']}/receipt", headers=auth(o_tok))).status_code == 404
    assert (await client.post(f"/api/v1/admin/donations/{p['id']}/confirm", headers=h, json={})).status_code == 409
    mine = (await client.get("/api/v1/donations/mine", headers=auth(d_tok))).json()
    assert mine["meta"]["total_given"] == 25000

    # anonymous offline gift; refund reverses the campaign total
    off = (
        await client.post(
            "/api/v1/admin/donations",
            headers=h,
            json={
                "donor_name": "A well-wisher",
                "campaign_id": c["id"],
                "amount": "10000",
                "method": "cash",
                "anonymous": True,
                "recognition_consent": True,
            },
        )
    ).json()["data"]
    assert off["status"] == "completed"
    camp = (await client.get(f"/api/v1/donations/campaigns/{c['id']}", headers=auth(o_tok))).json()["data"]
    assert camp["raised_amount"] == 35000 and any(x["name"] == "Anonymous" for x in camp["donors"])
    await client.post(f"/api/v1/admin/donations/{off['id']}/status", headers=h, json={"status": "refunded"})
    assert (await client.get(f"/api/v1/donations/campaigns/{c['id']}", headers=auth(o_tok))).json()["data"]["raised_amount"] == 25000
    stats = (await client.get("/api/v1/admin/donations/stats", headers=h)).json()["data"]
    assert stats["total"] >= 25000 and any(x["category"] == "library" for x in stats["by_category"])
    exp = await client.get("/api/v1/admin/donations/export", headers=h)
    assert exp.status_code == 200 and p["reference"] in exp.text
    assert (await client.get("/api/v1/public/campaigns")).json()["data"][0]["title"] == "Library renovation"

    # scholarships: fund, campaign link, private awards
    s = (
        await client.post(
            "/api/v1/admin/scholarships",
            headers=h,
            json={"name": "Class of 2005 Merit Scholarship", "amount_per_award": "60000", "sponsor_name": "Class of 2005"},
        )
    ).json()["data"]
    await client.post(
        f"/api/v1/admin/scholarships/{s['id']}/awards",
        headers=h,
        json={
            "recipient_name": "Student A",
            "recipient_class": "Grade 10",
            "academic_year": "2026-27",
            "amount": "60000",
            "awarded_on": "2026-09-01",
        },
    )
    listed = (await client.get("/api/v1/scholarships", headers=auth(d_tok))).json()["data"]
    assert listed[0]["awards_count"] == 1 and "recipient_name" not in str(listed)
    assert (await client.get(f"/api/v1/admin/scholarships/{s['id']}/awards", headers=auth(d_tok))).status_code == 403
    assert (await client.delete(f"/api/v1/admin/scholarships/{s['id']}", headers=h)).status_code == 409


async def test_newsletters_double_opt_in_and_sending(client, installed):
    h = auth(installed)
    worker.TEST_OUTBOX.clear()
    assert (
        await client.post("/api/v1/public/newsletter/subscribe", json={"email": "Reader@Example.org", "name": "Reader"})
    ).status_code == 202
    link = _sent("Confirm your")[0]["html"]
    token = re.search(r"newsletter/confirm\?token=([\w\-]+)", link).group(1)
    subs = (await client.get("/api/v1/admin/newsletters/subscribers/list?status=pending", headers=h)).json()["data"]
    assert any(x["email"] == "reader@example.org" for x in subs)
    assert (await client.post("/api/v1/public/newsletter/confirm", json={"token": token})).json()["data"]["status"] == "subscribed"
    m_tok, _ = await _verified(client, installed, "nl-member@example.org", "Mehak Member", 2009)
    out_tok, _ = await _verified(client, installed, "nl-optout@example.org", "Osman Optout", 2009)
    await client.put("/api/v1/newsletter/me", headers=auth(out_tok), json={"subscribed": False})

    n = (
        await client.post(
            "/api/v1/admin/newsletters",
            headers=h,
            json={
                "subject": "Alumni News — December",
                "preheader": "Reunion, scholarships and more",
                "body": "# Reunion 2026\n\nJoin us on **12 December**. <b>no html</b>\n\n- Dinner\n- Campus tour\n\nhttps://example.org/reunion",
                "audience": "all_subscribers",
            },
        )
    ).json()["data"]
    pv = (await client.post(f"/api/v1/admin/newsletters/{n['id']}/preview", headers=h)).json()["data"]["html"]
    assert "<strong>12 December</strong>" in pv and "<b>no html</b>" not in pv and "&lt;b&gt;" in pv
    assert n["estimated_recipients"] >= 2
    r = await client.post(f"/api/v1/admin/newsletters/{n['id']}/send", headers=h, json={})
    assert r.json()["data"]["status"] == "sending"
    from app.core.db import SessionLocal
    from app.modules.institutional.newsletters import send_issue

    worker.TEST_OUTBOX.clear()
    async with SessionLocal() as db:
        first = await send_issue(db, uuid.UUID(n["id"]))
        await db.commit()
    sent = _sent("Alumni News")
    to = {p["to"] for p in sent}
    assert first == len(sent) and "reader@example.org" in to and "nl-member@example.org" in to and "nl-optout@example.org" not in to
    assert all("Unsubscribe" in p["html"] for p in sent)
    async with SessionLocal() as db:  # resuming never sends twice
        from app.models import Newsletter

        nl = await db.get(Newsletter, uuid.UUID(n["id"]))
        nl.status = "sending"
        await db.commit()
        assert await send_issue(db, uuid.UUID(n["id"])) == 0
        await db.commit()
    got = (await client.get(f"/api/v1/admin/newsletters/{n['id']}", headers=h)).json()["data"]
    assert got["status"] == "sent" and got["recipient_count"] == first
    assert (
        await client.put(f"/api/v1/admin/newsletters/{n['id']}", headers=h, json={"subject": "x" * 5, "body": "y" * 20})
    ).status_code == 409
    # one-click unsubscribe from the footer link
    reader_html = next(p["html"] for p in sent if p["to"] == "reader@example.org")
    unsub = re.search(r"newsletter/unsubscribe\?token=([\w\-]+)", reader_html).group(1)
    assert (await client.post("/api/v1/public/newsletter/unsubscribe", json={"token": unsub})).json()["data"]["status"] == "unsubscribed"
    assert (await client.get("/api/v1/newsletter/me", headers=auth(m_tok))).json()["data"]["subscribed"] is True


async def test_gallery_albums(client, installed):
    h = auth(installed)
    m_tok, _ = await _verified(client, installed, "gal@example.org", "Gul Gallery", 2011)
    a = (await client.post("/api/v1/admin/gallery", headers=h, json={"title": "Reunion 2025", "visibility": "public"})).json()["data"]
    assert (await client.post(f"/api/v1/admin/gallery/{a['id']}/publish", headers=h, json={"published": True})).status_code == 409  # empty
    buf = io.BytesIO()
    Image.new("RGB", (1000, 700), (113, 56, 219)).save(buf, format="JPEG")
    ph = (
        await client.post(
            f"/api/v1/admin/gallery/{a['id']}/photos",
            headers=h,
            files={"file": ("p.jpg", buf.getvalue(), "image/jpeg")},
            data={"caption": "Batch photo"},
        )
    ).json()["data"]
    assert ph["caption"] == "Batch photo"
    assert (await client.get(f"/api/v1/gallery/albums/{a['id']}", headers=auth(m_tok))).status_code == 404  # draft
    await client.post(f"/api/v1/admin/gallery/{a['id']}/publish", headers=h, json={"published": True})
    album = (await client.get(f"/api/v1/gallery/albums/{a['id']}", headers=auth(m_tok))).json()["data"]
    assert album["photo_count"] == 1 and album["photos"][0]["caption"] == "Batch photo" and album["cover"]
    assert any(x["id"] == a["id"] for x in (await client.get("/api/v1/public/gallery")).json()["data"])
    private = (await client.post("/api/v1/admin/gallery", headers=h, json={"title": "Members only", "visibility": "members"})).json()[
        "data"
    ]
    await client.post(f"/api/v1/admin/gallery/{private['id']}/photos", headers=h, files={"file": ("p.jpg", buf.getvalue(), "image/jpeg")})
    await client.post(f"/api/v1/admin/gallery/{private['id']}/publish", headers=h, json={"published": True})
    assert all(x["id"] != private["id"] for x in (await client.get("/api/v1/public/gallery")).json()["data"])
    assert (await client.get(f"/api/v1/public/gallery/{private['id']}")).status_code == 404
