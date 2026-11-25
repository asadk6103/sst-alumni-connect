"""Push events from the API to connected browsers through the Socket.IO gateway (Redis pub/sub).

Events are published after the database transaction commits, so a client that refetches on receipt
always sees the new state. Delivery is best-effort: pages also load the same data on their own.
"""

import asyncio
import json
import logging
import uuid

import orjson
import socketio
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import infra

log = logging.getLogger("app.live")
_manager: socketio.AsyncRedisManager | None = None
SENT: list[tuple[str, str, dict]] = []  # captured in tests
_tasks: set[asyncio.Task] = set()


def _spawn(coro) -> None:
    task = asyncio.get_running_loop().create_task(coro)
    _tasks.add(task)  # keep a reference until done (tasks are otherwise weakly held)
    task.add_done_callback(_tasks.discard)


def _mgr() -> socketio.AsyncRedisManager:
    global _manager
    if _manager is None:
        _manager = socketio.AsyncRedisManager(infra().redis_url, write_only=True)
    return _manager


def _plain(data: dict) -> dict:
    """JSON-safe copy: the gateway serialises events with the standard json module (no datetimes, UUIDs, Decimals)."""
    return orjson.loads(orjson.dumps(data, default=str))


async def _emit(room: str, name: str, data: dict) -> None:
    data = _plain(data)
    if infra().environment == "test":
        json.dumps(data)  # same serialiser as the gateway: fails the test if an event is not JSON-safe
        SENT.append((room, name, data))
        return
    try:
        await _mgr().emit(name, data, room=room)
    except Exception as e:  # never fail a request because the gateway is unreachable
        log.warning("live event %s not delivered: %s", name, e)


def emit_to_user(db: AsyncSession, user_id: uuid.UUID, name: str, data: dict) -> None:
    """Schedule an event for one member's open tabs once `db` commits."""
    room = f"user:{user_id}"

    def fire(_session) -> None:
        try:
            _spawn(_emit(room, name, data))
        except RuntimeError:
            pass

    event.listen(db.sync_session, "after_commit", fire, once=True)


def emit_to_room(db: AsyncSession, room: str, name: str, data: dict) -> None:
    """Schedule an event for a room (group, feed, conversation …) once `db` commits."""

    def fire(_session) -> None:
        try:
            _spawn(_emit(room, name, data))
        except RuntimeError:
            pass

    event.listen(db.sync_session, "after_commit", fire, once=True)


async def emit_now(room: str, name: str, data: dict, skip_sid: str | None = None) -> None:
    """Ephemeral event (typing, presence): published immediately, never persisted."""
    data = _plain(data)
    if infra().environment == "test":
        json.dumps(data)
        SENT.append((room, name, data))
        return
    try:
        await _mgr().emit(name, data, room=room, skip_sid=skip_sid)
    except Exception as e:
        log.warning("live event %s not delivered: %s", name, e)
