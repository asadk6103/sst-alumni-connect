"""Test harness: real PostgreSQL (TEST_DATABASE_URL), in-memory Redis, captured task queue."""

import os
import tempfile

TMP = tempfile.mkdtemp(prefix="alumni-test-")
os.environ.update(
    {
        "ENVIRONMENT": "test",
        "DATABASE_URL": os.environ.get("TEST_DATABASE_URL", "postgresql+asyncpg://sst:sst_test@localhost:5544/alumni_test"),
        "REDIS_URL": "redis://unused:6379/0",
        "CONFIG_DIR": os.path.join(TMP, "config"),
        "STORAGE_DIR": os.path.join(TMP, "storage"),
        "TRUSTED_PROXIES": "0",
        "DB_POOL_SIZE": "5",
    }
)

import asyncio  # noqa: E402
import re  # noqa: E402

import fakeredis  # noqa: E402
import httpx  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from app import worker  # noqa: E402
from app.core import deps, secrets, settings_store  # noqa: E402
from app.core import redis as redis_mod
from app.core.db import engine  # noqa: E402

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def pytest_collection_modifyitems(items):
    """Run every test on the session event loop (shared app, engine and fixtures)."""
    marker = pytest.mark.asyncio(loop_scope="session")
    for item in items:
        if pytest_asyncio.is_async_test(item):
            item.add_marker(marker, append=False)


def _migrate() -> None:
    cfg = Config(os.path.join(BACKEND, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(BACKEND, "alembic"))
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")


@pytest.fixture(scope="session", autouse=True)
async def database():
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    # Start from an empty schema each run (also removes leftovers of an interrupted run).
    eng = create_async_engine(os.environ["DATABASE_URL"])
    async with eng.begin() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
    await eng.dispose()
    await asyncio.to_thread(_migrate)
    from app import bootstrap

    await bootstrap.run()
    yield
    await engine.dispose()


@pytest.fixture(scope="session", autouse=True)
def fake_redis():
    redis_mod.set_client(fakeredis.FakeAsyncRedis(decode_responses=True))
    worker.TEST_OUTBOX = []
    yield


@pytest.fixture(autouse=True)
async def clean_state():
    """Fresh rate-limit counters and caches for every test."""
    await redis_mod.redis().flushall()
    settings_store._cache.clear()
    deps.forget_principals()
    worker.TEST_OUTBOX.clear()
    yield


@pytest.fixture(scope="session")
async def client():
    from app.main import app

    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as c:
            yield c


ADMIN = {"full_name": "Asad Mehmood", "email": "owner@example.org", "password": "Str0ngPassword!"}
SETUP_BODY = {
    "institution": {
        "institution_name": "SST Public School Rashidabad",
        "app_url": "https://alumni.example.org",
        "contact_email": "alumni@example.org",
    },
    "branding": {"tagline": "Reconnect. Network. Mentor. Give Back."},
    "admin": ADMIN,
    "security": {"min_password_length": 10, "mfa_policy": "optional", "require_email_verification": True},
}


@pytest.fixture(scope="session")
async def installed(client):
    """Runs the setup wizard once; returns the super administrator's access token."""
    r = await client.get("/api/v1/setup/status")
    if r.json()["data"]["installed"]:
        r = await client.post("/api/v1/auth/login", json={"email": ADMIN["email"], "password": ADMIN["password"]})
        return r.json()["data"]["access_token"]
    code = secrets.ensure_setup_code()
    r = await client.post("/api/v1/setup/complete", json={"code": code, **SETUP_BODY})
    assert r.status_code == 201, r.text
    return r.json()["data"]["access_token"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def last_email_link(path: str) -> str:
    """Token from the most recent queued email containing a link to `path`."""
    for name, payload in reversed(worker.TEST_OUTBOX):
        if name == "app.tasks.send_email":
            m = re.search(re.escape(path) + r"\?token=([A-Za-z0-9_\-]+)", payload["html"])
            if m:
                return m.group(1)
    raise AssertionError(f"no email with a {path} link was queued")
