"""Real-time gateway (`uvicorn app.realtime:app`), scaled independently of the REST API.

Stage 1 provides the authenticated connection layer: the access token is verified on connect, the
identity comes only from that token (never from client-supplied IDs), each connection joins its
private `user:{id}` room, and Redis coordinates broadcasts across gateway replicas. Messaging,
presence, typing and feed rooms build on this in Stage 3.
"""

import asyncio
import logging

import socketio
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

from .core import settings_store
from .core.config import infra
from .core.db import SessionLocal
from .core.deps import load_principal
from .core.metrics import SOCKETS, metrics_endpoint

log = logging.getLogger("app.realtime")


def _timing() -> tuple[int, int]:
    async def load():
        async with SessionLocal() as db:
            rt = await settings_store.get_group(db, "realtime")
            return rt.heartbeat_interval_seconds, rt.connection_timeout_seconds

    try:
        return asyncio.run(load())
    except Exception:  # database not ready yet: defaults; restart applies saved values
        return 25, 20


_ping_interval, _ping_timeout = (25, 20) if infra().environment == "test" else _timing()

sio = socketio.AsyncServer(
    async_mode="asgi",
    client_manager=None if infra().environment == "test" else socketio.AsyncRedisManager(infra().redis_url),
    cors_allowed_origins=[],  # served same-origin through nginx
    ping_interval=_ping_interval,
    ping_timeout=_ping_timeout,
    max_http_buffer_size=1_000_000,
    # WebSocket only: works across scaled gateway replicas without sticky sessions.
    transports=["websocket"],
)


@sio.event
async def connect(sid, environ, auth):
    token = (auth or {}).get("token") if isinstance(auth, dict) else None
    if not token:
        raise socketio.exceptions.ConnectionRefusedError("unauthenticated")
    async with SessionLocal() as db:
        principal = await load_principal(db, token)
        if not principal:
            raise socketio.exceptions.ConnectionRefusedError("unauthenticated")
        rt = await settings_store.get_group(db, "realtime")
    if SOCKETS._value.get() >= rt.max_connections_per_gateway:  # noqa: SLF001
        raise socketio.exceptions.ConnectionRefusedError("server_busy")
    await sio.save_session(sid, {"user_id": str(principal.id), "session_id": str(principal.session_id)})
    await sio.enter_room(sid, f"user:{principal.id}")
    SOCKETS.inc()
    await sio.emit("ready", {"user_id": str(principal.id)}, to=sid)


@sio.event
async def disconnect(sid, *args):
    SOCKETS.dec()


async def health(_):
    return JSONResponse({"status": "ok", "connections": SOCKETS._value.get()})  # noqa: SLF001


app = Starlette(routes=[Route("/realtime/health", health), Route("/metrics", metrics_endpoint),
                        Mount("/", socketio.ASGIApp(sio, socketio_path="/realtime/socket.io"))])
