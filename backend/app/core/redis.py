"""Shared async Redis client (cache, rate limits, presence, Socket.IO coordination)."""

import time

from redis.asyncio import Redis
from redis.asyncio.retry import Retry
from redis.backoff import ExponentialBackoff
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import TimeoutError as RedisTimeoutError

from .config import infra
from .errors import AppError

_client: Redis | None = None


def redis() -> Redis:
    global _client
    if _client is None:
        # Reconnect and retry transparently when Redis restarts or a pooled connection went stale.
        _client = Redis.from_url(
            infra().redis_url,
            decode_responses=True,
            health_check_interval=30,
            retry=Retry(ExponentialBackoff(cap=1.0, base=0.05), 3),
            retry_on_error=[RedisConnectionError, RedisTimeoutError],
        )
    return _client


def set_client(client: Redis) -> None:  # tests
    global _client
    _client = client


async def hit(key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
    """Fixed-window counter. Returns (allowed, seconds until the window resets)."""
    bucket = int(time.time() // window_seconds)
    k = f"rl:{key}:{bucket}"
    pipe = redis().pipeline()
    pipe.incr(k)
    pipe.expire(k, window_seconds + 1)
    count, _ = await pipe.execute()
    retry = window_seconds - int(time.time() % window_seconds)
    return count <= limit, retry


async def enforce(key: str, limit: int, window_seconds: int, message: str = "Too many requests. Please wait and try again.") -> None:
    ok, retry = await hit(key, limit, window_seconds)
    if not ok:
        raise AppError(429, "RATE_LIMITED", message, {"retry_after": retry})
