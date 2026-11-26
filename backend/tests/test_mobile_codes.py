"""Mobile app: 6-digit email codes for email verification and password reset."""

import re

from app import worker

from .test_alumni import PW


def _last_code() -> str:
    for name, payload in reversed(worker.TEST_OUTBOX):
        if name == "app.tasks.send_email" and (m := re.search(r">(\d{6})<", payload["html"])):
            return m.group(1)
    raise AssertionError("no code email queued")


MOBILE = {"X-Client": "mobile"}


async def test_register_verify_code_and_reset_by_code(client, installed):
    body = {
        "full_name": "Mobile Coder",
        "email": "mob-code@example.org",
        "password": PW,
        "accept_terms": True,
        "phone": "+923001234567",
        "graduation_year": 2015,
        "admission_year": 2005,
    }
    assert (await client.post("/api/v1/auth/register", json=body, headers=MOBILE)).status_code == 201
    code = _last_code()
    bad = await client.post("/api/v1/auth/email/verify-code", json={"email": "mob-code@example.org", "code": "000000"})
    assert bad.status_code == 400
    ok = await client.post("/api/v1/auth/email/verify-code", json={"email": "mob-code@example.org", "code": code})
    assert ok.status_code == 200
    r = await client.post("/api/v1/auth/login", json={"email": "mob-code@example.org", "password": PW}, headers=MOBILE)
    assert r.status_code == 200 and r.json()["data"]["refresh_token"]
    # forgot password by code
    await client.post("/api/v1/auth/password/forgot", json={"email": "mob-code@example.org", "method": "code"})
    code = _last_code()
    tok = (await client.post("/api/v1/auth/password/verify-code", json={"email": "mob-code@example.org", "code": code})).json()["data"][
        "token"
    ]
    assert (await client.post("/api/v1/auth/password/reset", json={"token": tok, "password": "N3wPassword!!"})).status_code == 200
    assert (await client.post("/api/v1/auth/login", json={"email": "mob-code@example.org", "password": "N3wPassword!!"})).status_code == 200
