"""REST API application (`uvicorn app.main:app`)."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import ORJSONResponse
from starlette.middleware.gzip import GZipMiddleware
from starlette.routing import Route
from starlette.types import ASGIApp, Receive, Scope, Send

from .core import errors, secrets, settings_store
from .core.config import infra
from .core.db import SessionLocal, engine
from .core.metrics import MetricsMiddleware, metrics_endpoint
from .modules.achievements import router as achievements
from .modules.admin import audit as admin_audit
from .modules.admin import dashboard as admin_dashboard
from .modules.admin import health as admin_health
from .modules.admin import media as admin_media
from .modules.admin import roles as admin_roles
from .modules.admin import users as admin_users
from .modules.administration import custom_fields as custom_fields_api
from .modules.administration import localization, privacy, reports
from .modules.alumni import admin as alumni_admin
from .modules.alumni import batches as alumni_batches
from .modules.alumni import dashboard as alumni_dashboard
from .modules.alumni import network as alumni_network
from .modules.alumni import portal as alumni_portal
from .modules.alumni import records as alumni_records
from .modules.alumni import registration as alumni_registration
from .modules.auth.router import router as auth_router
from .modules.cms import news as news_api
from .modules.community import admin as community_admin
from .modules.community import groups as community_groups
from .modules.community import invitations, search
from .modules.community import router as community
from .modules.configuration.router import router as config_router
from .modules.events import extras as events_extras
from .modules.events import router as events
from .modules.institutional import donations as donations
from .modules.institutional import gallery as gallery
from .modules.institutional import newsletters as newsletters
from .modules.institutional import notifications as notifications_api
from .modules.jobs import router as jobs
from .modules.mentorship import router as mentorship
from .modules.messaging import router as messaging
from .modules.public.router import router as public_router
from .modules.setup.router import announce
from .modules.setup.router import router as setup_router

logging.basicConfig(level=infra().log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"strict-origin-when-cross-origin"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
    (b"cross-origin-opener-policy", b"same-origin"),
]


class SecurityHeaders:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def _send(message):
            if message["type"] == "http.response.start":
                message["headers"] = list(message.get("headers", [])) + SECURITY_HEADERS
            await send(message)

        await self.app(scope, receive, _send)


class DynamicCORS:
    """Cross-origin access only for origins listed in Configuration → Security (same-origin needs none)."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def _allowed(self, origin: str) -> bool:
        async with SessionLocal() as db:
            sec = await settings_store.get_group(db, "security")
        return origin in sec.allowed_origins

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        origin = dict(scope.get("headers", [])).get(b"origin", b"").decode()
        if not origin or not await self._allowed(origin):
            return await self.app(scope, receive, send)
        cors = [(b"access-control-allow-origin", origin.encode()), (b"access-control-allow-credentials", b"true"), (b"vary", b"Origin")]
        if scope["method"] == "OPTIONS":
            headers = cors + [
                (b"access-control-allow-methods", b"GET, POST, PUT, PATCH, DELETE"),
                (b"access-control-allow-headers", b"authorization, content-type, idempotency-key"),
                (b"access-control-max-age", b"600"),
            ]
            await send({"type": "http.response.start", "status": 204, "headers": headers})
            await send({"type": "http.response.body", "body": b""})
            return

        async def _send(message):
            if message["type"] == "http.response.start":
                message["headers"] = list(message.get("headers", [])) + cors
            await send(message)

        await self.app(scope, receive, _send)


@asynccontextmanager
async def lifespan(_: FastAPI):
    secrets.load()
    await announce()
    yield
    await engine.dispose()


def create_app() -> FastAPI:
    app = FastAPI(
        title="SST Alumni Connect API",
        version="1.0.0",
        description="REST API of SST Alumni Connect. Responses: `{data, meta?}`; errors: `{error: {code, message, details?}}`.",
        default_response_class=ORJSONResponse,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    errors.install(app)
    for r in (
        setup_router,
        auth_router,
        public_router,
        admin_users.router,
        admin_roles.router,
        admin_audit.router,
        admin_media.router,
        admin_health.router,
        admin_dashboard.router,
        config_router,
        alumni_registration.router,
        alumni_dashboard.router,
        alumni_portal.router,
        alumni_admin.router,
        alumni_records.router,
        alumni_batches.router,
        community_groups.router,
        community.router,
        community_admin.router,
        messaging.router,
        events_extras.router,
        events.router,
        events.admin,
        jobs.router,
        jobs.admin,
        mentorship.router,
        mentorship.admin,
        achievements.router,
        achievements.admin,
        achievements.public,
        notifications_api.router,
        donations.router,
        donations.admin,
        donations.public,
        donations.scholarships_router,
        donations.scholarships_admin,
        newsletters.public,
        newsletters.router,
        newsletters.admin,
        gallery.router,
        gallery.public,
        gallery.admin,
        custom_fields_api.admin,
        custom_fields_api.router,
        custom_fields_api.public,
        localization.public,
        localization.admin,
        reports.router,
        news_api.admin,
        news_api.router,
        privacy.router,
        privacy.admin,
        notifications_api.devices,
        search.router,
        alumni_network.router,
        invitations.router,
    ):
        app.include_router(r)
    app.router.routes.append(Route("/metrics", metrics_endpoint, include_in_schema=False))
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(DynamicCORS)
    app.add_middleware(SecurityHeaders)
    app.add_middleware(MetricsMiddleware)
    return app


app = create_app()
