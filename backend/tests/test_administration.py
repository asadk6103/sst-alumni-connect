"""Stage 5 — CMS pages and blocks, news, navigation, contact form, custom fields, localization, reports and exports."""

import io
import re
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app import worker
from app.i18n import CATALOG

from .conftest import auth
from .test_alumni import PW, _member
from .test_community import _verified


async def test_cms_pages_draft_publish_schedule_preview(client, installed):
    h = auth(installed)
    # seeded About page is live
    about = (await client.get("/api/v1/public/pages/about")).json()["data"]
    assert about["blocks"][0]["type"] == "hero" and about["blocks"][2]["type"] == "stats"
    assert about["blocks"][2]["items"][0]["value"] != ""  # live figure filled in

    bad = {"title": "Bad", "slug": "bad-page", "blocks": [{"type": "cta", "heading": "Go", "button_url": "javascript:alert(1)"}]}
    r = await client.post("/api/v1/admin/cms/pages", headers=h, json=bad)
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "blocks.0.button_url"
    assert (await client.post("/api/v1/admin/cms/pages", headers=h, json={**bad, "slug": "news", "blocks": []})).status_code == 422

    body = {
        "title": "Reunion 2026",
        "slug": "reunion-2026",
        "seo_description": "Grand reunion",
        "blocks": [
            {"type": "rich_text", "heading": "Welcome", "text": "**Bold** <script>x</script>"},
            {"type": "events", "heading": "Upcoming", "limit": 3},
            {"type": "newsletter", "heading": "Stay in touch"},
        ],
    }
    page = (await client.post("/api/v1/admin/cms/pages", headers=h, json=body)).json()["data"]
    assert page["status"] == "draft" and len(page["blocks"]) == 3 and page["blocks"][0]["id"]
    assert (await client.get("/api/v1/public/pages/reunion-2026")).status_code == 404  # drafts are not public

    tok = (await client.post(f"/api/v1/admin/cms/pages/{page['id']}/preview-token", headers=h)).json()["data"]["token"]
    prev = (await client.get(f"/api/v1/public/preview?token={tok}")).json()["data"]
    html = prev["blocks"][0]["html"]
    assert "<strong>Bold</strong>" in html and "<script>" not in html and "&lt;script&gt;" in html
    assert (await client.get("/api/v1/public/preview?token=nope")).status_code == 401

    await client.post(f"/api/v1/admin/cms/pages/{page['id']}/publish", headers=h, json={})
    live = (await client.get("/api/v1/public/pages/reunion-2026")).json()["data"]
    assert live["seo_description"] == "Grand reunion" and [b["type"] for b in live["blocks"]] == ["rich_text", "events", "newsletter"]

    # editing the draft does not change the live page until published again
    body2 = {**body, "title": "Reunion 2026 — updated", "blocks": body["blocks"][:1]}
    saved = (await client.put(f"/api/v1/admin/cms/pages/{page['id']}", headers=h, json=body2)).json()["data"]
    assert saved["has_unpublished_changes"]
    settings_cache_clear()
    assert len((await client.get("/api/v1/public/pages/reunion-2026")).json()["data"]["blocks"]) == 3

    # schedule for the future → not visible yet
    later = (datetime.now(UTC) + timedelta(days=2)).isoformat()
    sched = (await client.post(f"/api/v1/admin/cms/pages/{page['id']}/publish", headers=h, json={"publish_at": later})).json()["data"]
    assert sched["status"] == "scheduled"
    settings_cache_clear()
    assert (await client.get("/api/v1/public/pages/reunion-2026")).status_code == 404

    # home page setting + protection
    web = (await client.get("/api/v1/admin/config/settings/website", headers=h)).json()["data"]
    assert (await client.put("/api/v1/admin/config/settings/website", headers=h, json={**web, "home_page": "about"})).status_code == 200
    assert (await client.get("/api/v1/public/home")).json()["data"]["slug"] == "about"
    about_id = next(p["id"] for p in (await client.get("/api/v1/admin/cms/pages", headers=h)).json()["data"] if p["slug"] == "about")
    assert (await client.delete(f"/api/v1/admin/cms/pages/{about_id}", headers=h)).status_code == 422
    await client.put("/api/v1/admin/config/settings/website", headers=h, json={**web, "home_page": None})

    # a member cannot use the page builder
    tok_m, _ = await _member(client, "cms-member@example.org", "Cms Member")
    assert (await client.get("/api/v1/admin/cms/pages", headers=auth(tok_m))).status_code == 403


def settings_cache_clear():
    from app.core import settings_store

    settings_store._cache.clear()


async def test_news_navigation_and_contact(client, installed):
    h = auth(installed)
    n = (
        await client.post(
            "/api/v1/admin/news",
            headers=h,
            json={
                "title": "Scholarship winners announced",
                "category": "announcement",
                "summary": "Ten students",
                "body": "## Winners\n\n- Ali",
            },
        )
    ).json()["data"]
    assert n["slug"] == "scholarship-winners-announced" and n["status"] == "draft"
    assert not (await client.get("/api/v1/public/news")).json()["data"]
    await client.post(f"/api/v1/admin/news/{n['id']}/publish", headers=h, json={"publish": True})
    art = (await client.get(f"/api/v1/public/news/{n['slug']}")).json()["data"]
    assert "<h3" in art["html"] and "body" in art and art["body"] is None  # raw source is staff-only
    members = (await client.post("/api/v1/admin/news", headers=h, json={"title": "Members only note", "members_only": True})).json()["data"]
    await client.post(f"/api/v1/admin/news/{members['id']}/publish", headers=h, json={"publish": True})
    assert all(x["slug"] != members["slug"] for x in (await client.get("/api/v1/public/news")).json()["data"])
    tok, _ = await _verified(client, installed, "news-reader@example.org", "News Reader", 2010)
    assert any(x["slug"] == members["slug"] for x in (await client.get("/api/v1/news", headers=auth(tok))).json()["data"])

    # navigation: page link only appears while the page is published
    menus = (await client.get("/api/v1/admin/website/navigation", headers=h)).json()
    assert any(i["target"] == "about" for i in menus["data"]["header"])
    items = [
        {"label": "Home", "labels": {"ur": "ہوم"}, "type": "route", "target": "/"},
        {"label": "About", "type": "page", "target": "about", "children": [{"label": "Contact", "type": "route", "target": "/contact"}]},
        {"label": "School site", "type": "url", "target": "https://example.org", "new_tab": True},
    ]
    assert (await client.put("/api/v1/admin/website/navigation/header", headers=h, json=items)).status_code == 200
    bad = [{"label": "Evil", "type": "url", "target": "javascript:alert(1)"}]
    assert (await client.put("/api/v1/admin/website/navigation/header", headers=h, json=bad)).status_code == 422
    site = (await client.get("/api/v1/public/website?lang=ur")).json()["data"]
    assert (
        site["header"][0]["label"] == "ہوم"
        and site["header"][1]["href"] == "/about"
        and site["header"][1]["children"][0]["href"] == "/contact"
    )

    # contact form: stored, emailed to the office, honeypot, rate limit
    worker.TEST_OUTBOX.clear()
    msg = {"name": "Visitor", "email": "visitor@example.org", "subject": "Reunion", "message": "When is the next reunion?"}
    assert (await client.post("/api/v1/public/contact", json=msg)).status_code == 201
    assert any(p.get("subject", "").startswith("Website message") for name, p in worker.TEST_OUTBOX if name == "app.tasks.send_email")
    await client.post("/api/v1/public/contact", json={**msg, "website": "http://spam"})  # silently dropped
    inbox = (await client.get("/api/v1/admin/website/messages", headers=h)).json()
    assert inbox["meta"]["new"] == 1 and inbox["data"][0]["subject"] == "Reunion"
    for _ in range(4):
        await client.post("/api/v1/public/contact", json=msg)
    assert (await client.post("/api/v1/public/contact", json=msg)).status_code == 429


async def test_custom_fields_registration_profile_and_visibility(client, installed):
    h = auth(installed)
    tok, uid = await _verified(client, installed, "fields-b@example.org", "Faraz Fields", 2012)
    other, _ = await _verified(client, installed, "fields-c@example.org", "Farah Fields", 2012)
    base = {"entity": "alumni_profile", "required": False, "visibility": "members"}
    r = await client.post(
        "/api/v1/admin/custom-fields",
        headers=h,
        json={
            **base,
            "key": "blood_group",
            "label": "Blood group",
            "type": "select",
            "options": [{"value": "a", "label": "A+"}, {"value": "o", "label": "O+"}],
            "required": True,
            "on_registration": True,
        },
    )
    assert r.status_code == 201, r.text
    await client.post(
        "/api/v1/admin/custom-fields",
        headers=h,
        json={**base, "key": "donor", "label": "Willing to donate blood", "type": "checkbox", "on_registration": True},
    )
    cond = {
        **base,
        "key": "donor_city",
        "label": "Donation city",
        "type": "text",
        "required": True,
        "on_registration": True,
        "condition": {"field": "donor", "operator": "equals", "value": "true"},
    }
    assert (await client.post("/api/v1/admin/custom-fields", headers=h, json=cond)).status_code == 201
    await client.post(
        "/api/v1/admin/custom-fields",
        headers=h,
        json={**base, "key": "hobby", "label": "Hobby", "type": "text", "visibility": "private", "validation": {"max_length": 20}},
    )
    # file fields cannot be asked during registration; bad regex is rejected
    assert (
        await client.post(
            "/api/v1/admin/custom-fields", headers=h, json={**base, "key": "cv", "label": "CV", "type": "file", "on_registration": True}
        )
    ).status_code == 422
    assert (
        await client.post(
            "/api/v1/admin/custom-fields",
            headers=h,
            json={**base, "key": "code", "label": "Code", "type": "text", "validation": {"pattern": "("}},
        )
    ).status_code == 422

    reg = (await client.get("/api/v1/public/custom-fields/registration")).json()["data"]
    assert [f["key"] for f in reg] == ["blood_group", "donor", "donor_city"]

    body = {
        "full_name": "Fatima Fields",
        "email": "fields@example.org",
        "phone": "+92 300 1112233",
        "password": PW,
        "accept_terms": True,
        "graduation_year": 2012,
        "admission_year": 2002,
        "city": "Lahore",
        "country": "Pakistan",
    }
    r = await client.post("/api/v1/auth/register", json=body)
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "custom_fields.blood_group"
    r = await client.post("/api/v1/auth/register", json={**body, "custom_fields": {"blood_group": "b"}})
    assert r.status_code == 422  # not an option
    r = await client.post("/api/v1/auth/register", json={**body, "custom_fields": {"blood_group": "o", "donor": True}})
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "custom_fields.donor_city"  # condition met → required
    r = await client.post(
        "/api/v1/auth/register", json={**body, "custom_fields": {"blood_group": "o", "donor": False, "donor_city": "ignored"}}
    )
    assert r.status_code == 201, r.text

    me = (
        await client.put("/api/v1/alumni/me", headers=auth(tok), json={"custom_fields": {"blood_group": "a", "hobby": "Cricket"}})
    ).json()["data"]
    assert me["custom_fields"] == {"blood_group": "a", "hobby": "Cricket"}
    r = await client.put("/api/v1/alumni/me", headers=auth(tok), json={"custom_fields": {"blood_group": "a", "hobby": "x" * 30}})
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "custom_fields.hobby"

    view = (await client.get(f"/api/v1/alumni/profiles/{uid}", headers=auth(other))).json()["data"]
    shown = {f["key"]: f["display"] for f in view["extra_fields"]}
    assert shown == {"blood_group": "A+"}  # the private hobby is hidden from other members
    admin_view = (await client.get(f"/api/v1/alumni/profiles/{uid}", headers=h)).json()["data"]
    assert {f["key"] for f in admin_view["extra_fields"]} == {"blood_group", "hobby"}

    # deleting a field another depends on is blocked
    fields = (await client.get("/api/v1/admin/custom-fields?entity=alumni_profile", headers=h)).json()["data"]
    donor = next(f for f in fields if f["key"] == "donor")
    assert (await client.delete(f"/api/v1/admin/custom-fields/{donor['id']}", headers=h)).status_code == 409
    # reorder
    ids = [f["id"] for f in reversed(fields)]
    assert (
        await client.put("/api/v1/admin/custom-fields/order", headers=h, json={"entity": "alumni_profile", "ids": ids})
    ).status_code == 200
    assert (await client.get("/api/v1/admin/custom-fields?entity=alumni_profile", headers=h)).json()["data"][0]["id"] == ids[0]
    await _deactivate(client, h, "alumni_profile")


async def _deactivate(client, h, entity):
    """Turn a form's custom fields off again so later tests are unaffected."""
    for f in (await client.get(f"/api/v1/admin/custom-fields?entity={entity}", headers=h)).json()["data"]:
        keep = (
            "entity",
            "key",
            "label",
            "labels",
            "help_text",
            "type",
            "options",
            "visibility",
            "validation",
            "condition",
            "on_registration",
        )
        r = await client.put(
            f"/api/v1/admin/custom-fields/{f['id']}", headers=h, json={**{k: f[k] for k in keep}, "required": False, "active": False}
        )
        assert r.status_code == 200, r.text


async def test_custom_fields_on_jobs_and_files(client, installed):
    h = auth(installed)
    await client.post(
        "/api/v1/admin/custom-fields",
        headers=h,
        json={
            "entity": "job_post",
            "key": "openings",
            "label": "Openings",
            "type": "number",
            "required": True,
            "validation": {"min": 1, "max": 50},
        },
    )
    await client.post(
        "/api/v1/admin/custom-fields",
        headers=h,
        json={"entity": "job_post", "key": "brochure", "label": "Brochure", "type": "file", "visibility": "members"},
    )
    tok, _ = await _verified(client, installed, "jobs-cf@example.org", "Javed Fields", 2008)
    job = {
        "title": "Data analyst",
        "organization": "Acme",
        "employment_type": "full_time",
        "location": "Lahore",
        "description": "Analyse data and build dashboards for the operations team at Acme.",
    }
    r = await client.post("/api/v1/jobs", headers=h, json={**job, "custom_fields": {"openings": 99}})
    assert r.status_code == 422 and "at most 50" in r.json()["error"]["message"]
    up = await client.post("/api/v1/custom-fields/files", headers=h, files={"file": ("b.pdf", b"%PDF-1.4\n%%EOF\n", "application/pdf")})
    fid = up.json()["data"]["id"]
    # another member cannot attach the administrator's file
    r = await client.post("/api/v1/jobs", headers=auth(tok), json={**job, "custom_fields": {"openings": 2, "brochure": fid}})
    assert r.status_code == 422
    j = (await client.post("/api/v1/jobs", headers=h, json={**job, "custom_fields": {"openings": 3, "brochure": fid}})).json()["data"]
    assert {f["key"]: f["value"] for f in j["extra_fields"]}["openings"] == 3
    f = await client.get(f"/api/v1/custom-fields/job_post/{j['id']}/brochure/file", headers=auth(tok))
    assert f.status_code == 200 and f.content.startswith(b"%PDF")
    await _deactivate(client, h, "job_post")


async def test_localization(client, installed):
    h = auth(installed)
    ur = (await client.get("/api/v1/public/i18n/ur")).json()["data"]
    assert ur["rtl"] and ur["messages"]["nav.directory"] == "ڈائریکٹری"
    langs = (await client.get("/api/v1/public/languages")).json()["data"]
    assert {lang["code"] for lang in langs} >= {"en", "ur"}
    await client.put("/api/v1/admin/localization/translations/ur", headers=h, json=[{"key": "nav.directory", "value": "فہرست"}])
    assert (await client.get("/api/v1/public/i18n/ur")).json()["data"]["messages"]["nav.directory"] == "فہرست"
    await client.put("/api/v1/admin/localization/translations/ur", headers=h, json=[{"key": "nav.directory", "value": ""}])  # reset
    assert (await client.get("/api/v1/public/i18n/ur")).json()["data"]["messages"]["nav.directory"] == "ڈائریکٹری"
    # a new language starts from English; English cannot be switched off
    assert (
        await client.post(
            "/api/v1/admin/localization/languages", headers=h, json={"code": "ar", "name": "Arabic", "native_name": "العربية", "rtl": True}
        )
    ).status_code == 201
    rows = (await client.get("/api/v1/admin/localization/translations/ar?missing=true", headers=h)).json()
    assert rows["meta"]["total"] == len(CATALOG)
    csv_text = (await client.get("/api/v1/admin/localization/translations/ar/export", headers=h)).text
    assert csv_text.lstrip("﻿").startswith("key,english,translation")
    up = "key,english,translation\nnav.jobs,Jobs,وظائف\nunknown.key,x,y\n".encode()
    r = (
        await client.post("/api/v1/admin/localization/translations/ar/import", headers=h, files={"file": ("t.csv", up, "text/csv")})
    ).json()
    assert r["data"] == {"saved": 1, "skipped": 1}
    assert (
        await client.put(
            "/api/v1/admin/localization/languages/en",
            headers=h,
            json={"code": "en", "name": "English", "native_name": "English", "enabled": False},
        )
    ).status_code == 422
    await client.delete("/api/v1/admin/localization/languages/ar", headers=h)


def test_frontend_translation_keys_are_in_the_catalog():
    root = Path(__file__).resolve().parents[2] / "frontend"
    used = set()
    for path in [
        *root.glob("app/src/**/*.tsx"),
        *root.glob("app/src/**/*.ts"),
        *root.glob("web/src/**/*.tsx"),
        *root.glob("web/src/**/*.ts"),
    ]:
        used |= set(re.findall(r"""\bt\(\s*['"]([a-z_]+\.[a-z0-9_.]+)['"]""", path.read_text(encoding="utf-8")))
    missing = sorted(used - set(CATALOG))
    assert not missing, f"add these keys to app/i18n.py: {missing}"


async def test_reports_and_exports(client, installed):
    h = auth(installed)
    keys = [r["key"] for r in (await client.get("/api/v1/admin/reports", headers=h)).json()["data"]]
    assert len(keys) == 13
    for key in keys:
        r = await client.get(f"/api/v1/admin/reports/{key}", headers=h)
        assert r.status_code == 200, (key, r.text)
        d = r.json()["data"]
        assert d["columns"] and isinstance(d["rows"], list) and d["chart"]["labels"] is not None
    reg = (await client.get("/api/v1/admin/reports/registrations?date_from=2020-01-01", headers=h)).json()["data"]
    assert sum(r[1] for r in reg["rows"]) >= 3

    csv_r = await client.get("/api/v1/admin/reports/graduation_year/export?format=csv", headers=h)
    assert csv_r.status_code == 200 and csv_r.text.lstrip("﻿").splitlines()[0].startswith("Graduation year")
    x = await client.get("/api/v1/admin/reports/location/export?format=xlsx", headers=h)
    z = zipfile.ZipFile(io.BytesIO(x.content))
    assert "xl/worksheets/sheet1.xml" in z.namelist() and b"Alumni by location" in z.read("xl/worksheets/sheet1.xml")
    p = await client.get("/api/v1/admin/reports/verification/export?format=pdf", headers=h)
    assert p.headers["content-type"] == "application/pdf" and p.content.startswith(b"%PDF-1.4") and p.content.rstrip().endswith(b"%%EOF")
    logs = (await client.get("/api/v1/admin/audit-logs?entity=report", headers=h)).json()["data"]
    assert len(logs) >= 3

    # staff without alumni access get small groups merged
    tok, _ = await _verified(client, installed, "reports-viewer@example.org", "Rafia Reports", 2001)
    me = (await client.get("/api/v1/auth/me", headers=auth(tok))).json()["data"]
    role = (
        await client.post(
            "/api/v1/admin/roles", headers=h, json={"name": "Report reader", "description": "Reports only", "permissions": ["reports.view"]}
        )
    ).json()["data"]
    keys = [r["key"] for r in me["roles"]] + [role["key"]]
    assert (await client.patch(f"/api/v1/admin/users/{me['id']}", headers=h, json={"roles": keys})).status_code == 200
    tok = (await client.post("/api/v1/auth/login", json={"email": "reports-viewer@example.org", "password": PW})).json()["data"][
        "access_token"
    ]
    d = (await client.get("/api/v1/admin/reports/organization", headers=auth(tok))).json()["data"]
    assert d["suppressed"] and all(r[1] >= 3 or r[0].startswith("Other") for r in d["rows"])
    assert (await client.get("/api/v1/admin/reports/organization/export", headers=auth(tok))).status_code == 403  # no export permission
