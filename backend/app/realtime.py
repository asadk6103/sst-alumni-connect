"""Real-time gateway (`uvicorn app.realtime:app`), scaled independently of the REST API.

The access token is verified on connect and the identity comes only from it (never from client-supplied
IDs). Each connection joins its private `user:{id}` room; other rooms (feed, group, batch, conversation,
event, admin) are joined with `subscribe` and authorised against the database every time. Messages sent
here are persisted before the acknowledgement. Presence is multi-device (Redis TTL + heartbeat); typing
and presence are ephemeral. Redis coordinates broadcasts across gateway replicas.
"""

import asyncio
import concurrent.futures
import json
import logging
import uuid

import socketio
from sqlalchemy import select
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

from .core import settings_store
from .core.config import infra
from .core.db import SessionLocal
from .core.deps import load_principal, principal_for_session
from .core.metrics import SOCKETS, metrics_endpoint
from .services import rooms

log = logging.getLogger("app.realtime")


def _timing() -> tuple[int, int]:
    """Heartbeat settings (restart-required) read once at start-up.

    Runs on its own thread, event loop and throw-away engine: the module may be imported while uvicorn's loop
    is already running, and the shared connection pool must never be bound to a temporary loop.
    """

    async def load():
        from sqlalchemy.ext.asyncio import create_async_engine
        from sqlalchemy.pool import NullPool

        from .core.settings_schemas import RealtimeSettings
        from .models import SystemSetting

        eng = create_async_engine(infra().database_url, poolclass=NullPool)
        try:
            async with eng.connect() as conn:
                row = (await conn.execute(select(SystemSetting.value).where(SystemSetting.key == "realtime"))).scalar_one_or_none()
        finally:
            await eng.dispose()
        rt = RealtimeSettings.model_validate(row or {})
        return rt.heartbeat_interval_seconds, rt.connection_timeout_seconds

    try:
        with concurrent.futures.ThreadPoolExecutor(1) as pool:
            return pool.submit(asyncio.run, load()).result(timeout=15)
    except Exception as e:  # database not ready yet: defaults; a restart applies the saved values
        log.warning("real-time settings not loaded (%s); using defaults", e)
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
    from .modules.messaging import service as msg

    try:
        if await msg.presence_connect(principal.id, sid, rt.presence_ttl_seconds):
            await _announce_presence(principal.id, True)
    except Exception as e:
        log.debug("presence on connect: %s", e)
    await sio.emit("ready", {"user_id": str(principal.id)}, to=sid)


MAX_ROOMS = 60


async def _principal(sid):
    """The socket's principal, re-checked against the database (revoked sessions lose access)."""
    sess = await sio.get_session(sid)
    async with SessionLocal() as db:
        return await principal_for_session(db, uuid.UUID(sess["session_id"]), uuid.UUID(sess["user_id"])), sess


async def _announce_presence(uid: uuid.UUID, online: bool) -> None:
    from .modules.messaging import service as msg

    async with SessionLocal() as db:
        contacts = await msg.contacts_of(db, uid)
    data = {"user_id": str(uid), "online": online}
    for c in contacts:
        await sio.emit("presence", data, room=f"user:{c}")


@sio.event
async def disconnect(sid, *args):
    SOCKETS.dec()
    try:
        sess = await sio.get_session(sid)
        from .modules.messaging import service as msg

        if await msg.presence_disconnect(uuid.UUID(sess["user_id"]), sid):
            await _announce_presence(uuid.UUID(sess["user_id"]), False)
    except Exception as e:  # never let presence bookkeeping break a disconnect
        log.debug("presence on disconnect: %s", e)


@sio.event
async def subscribe(sid, data):
    """Join a room after an authorisation check. Ack: {ok, room} or {ok: false, error}."""
    room = data.get("room") if isinstance(data, dict) else None
    if not isinstance(room, str):
        return {"ok": False, "error": "invalid_room"}
    p, sess = await _principal(sid)
    if not p:
        await sio.disconnect(sid)
        return {"ok": False, "error": "unauthenticated"}
    rooms_now = [r for r in sio.rooms(sid) if r != sid]
    if room in rooms_now:
        return {"ok": True, "room": room}
    if len(rooms_now) >= MAX_ROOMS:
        return {"ok": False, "error": "too_many_rooms"}
    async with SessionLocal() as db:
        allowed = await rooms.can_join(db, p, room)
    if not allowed:
        return {"ok": False, "error": "forbidden"}
    await sio.enter_room(sid, room)
    return {"ok": True, "room": room}


@sio.event
async def unsubscribe(sid, data):
    room = data.get("room") if isinstance(data, dict) else None
    sess = await sio.get_session(sid)
    if isinstance(room, str) and room != f"user:{sess['user_id']}":
        await sio.leave_room(sid, room)
    return {"ok": True}


@sio.on("presence:ping")
async def presence_ping(sid, data=None):
    from .modules.messaging import service as msg

    sess = await sio.get_session(sid)
    async with SessionLocal() as db:
        rt = await settings_store.get_group(db, "realtime")
    await msg.presence_heartbeat(uuid.UUID(sess["user_id"]), sid, rt.presence_ttl_seconds)
    return {"ok": True}


@sio.event
async def typing(sid, data):
    """Ephemeral: relayed to the conversation room (only if the sender belongs to it)."""
    if not isinstance(data, dict):
        return
    conv = str(data.get("conversation_id", ""))
    room = f"conversation:{conv}"
    sess = await sio.get_session(sid)
    if room not in sio.rooms(sid):  # must have subscribed (= authorised) first
        return
    await sio.emit(
        "typing", {"conversation_id": conv, "user_id": sess["user_id"], "typing": bool(data.get("typing"))}, room=room, skip_sid=sid
    )


async def _with_db(sid, fn):
    """Run a messaging operation for the socket's user; returns an ack payload, never raises."""
    from .core.errors import AppError

    p, _ = await _principal(sid)
    if not p:
        return {"ok": False, "error": "unauthenticated"}
    if not p.can("portal.message"):
        return {"ok": False, "error": "forbidden"}
    try:
        async with SessionLocal() as db:
            result = await fn(db, p)
            await db.commit()
            return {"ok": True, **(result or {})}
    except AppError as e:
        return {"ok": False, "error": e.code.lower(), "message": e.message}
    except Exception:
        log.exception("socket messaging operation failed")
        return {"ok": False, "error": "server_error"}


@sio.on("message:send")
async def message_send(sid, data):
    """Persist first, then acknowledge with the stored message (idempotent with client_id)."""
    from .modules.messaging import service as msg

    if not isinstance(data, dict):
        return {"ok": False, "error": "invalid"}

    async def run(db, p):
        m = await msg.send(
            db,
            p,
            uuid.UUID(str(data.get("conversation_id"))),
            body=str(data.get("body") or ""),
            client_id=(str(data["client_id"])[:64] if data.get("client_id") else None),
            reply_to_id=uuid.UUID(str(data["reply_to_id"])) if data.get("reply_to_id") else None,
            attachment_ids=[uuid.UUID(str(a)) for a in (data.get("attachment_ids") or [])][:10],
        )
        return {"message": json.loads(json.dumps((await msg.messages_out(db, p.id, [m]))[0], default=str))}

    try:
        return await _with_db(sid, run)
    except ValueError:
        return {"ok": False, "error": "invalid"}


@sio.on("message:read")
async def message_read(sid, data):
    return await _mark(sid, data, "read")


@sio.on("message:delivered")
async def message_delivered(sid, data):
    return await _mark(sid, data, "delivered")


async def _mark(sid, data, kind):
    from .modules.messaging import service as msg

    if not isinstance(data, dict):
        return {"ok": False, "error": "invalid"}
    try:
        conv = uuid.UUID(str(data.get("conversation_id")))
        mid = uuid.UUID(str(data["message_id"])) if data.get("message_id") else None
    except ValueError:
        return {"ok": False, "error": "invalid"}

    async def run(db, p):
        await msg.mark(db, p, conv, kind, mid)

    return await _with_db(sid, run)


async def health(_):
    return JSONResponse({"status": "ok", "connections": SOCKETS._value.get()})  # noqa: SLF001


app = Starlette(
    routes=[
        Route("/realtime/health", health),
        Route("/metrics", metrics_endpoint),
        Mount("/", socketio.ASGIApp(sio, socketio_path="/realtime/socket.io")),
    ]
)
