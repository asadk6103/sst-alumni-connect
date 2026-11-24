"""Request metrics (Prometheus) and an in-process latency window for p50/p95/p99 reporting.

Every response carries `Server-Timing: app;dur=<ms>`; /metrics exposes histograms for scraping and
GET /api/v1/admin/health shows recent p95 per route group in the admin portal.
"""

import time
from collections import defaultdict, deque

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp, Receive, Scope, Send

REQUESTS = Counter("http_requests_total", "HTTP requests", ["method", "route", "status"])
LATENCY = Histogram("http_request_duration_seconds", "HTTP request latency", ["method", "route"],
                    buckets=(0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.5, 0.75, 1, 2, 5))
IN_FLIGHT = Gauge("http_requests_in_flight", "Requests being processed")
SOCKETS = Gauge("realtime_connections", "Open Socket.IO connections on this gateway")

WINDOW = 2000
_samples: dict[str, deque] = defaultdict(lambda: deque(maxlen=WINDOW))


def _route(scope: Scope) -> str:
    r = scope.get("route")
    return getattr(r, "path", None) or "unmatched"


class MetricsMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        start = time.perf_counter()
        status = {"code": 500}

        async def _send(message):
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
                dur = (time.perf_counter() - start) * 1000
                headers = list(message.get("headers", []))
                headers.append((b"server-timing", f"app;dur={dur:.1f}".encode()))
                message["headers"] = headers
            await send(message)

        IN_FLIGHT.inc()
        try:
            await self.app(scope, receive, _send)
        finally:
            IN_FLIGHT.dec()
            elapsed = time.perf_counter() - start
            route = _route(scope)
            if route not in ("/metrics", "/api/v1/health/live", "/api/v1/health/ready"):
                REQUESTS.labels(scope["method"], route, str(status["code"])).inc()
                LATENCY.labels(scope["method"], route).observe(elapsed)
                _samples[f"{scope['method']} {route}"].append(elapsed * 1000)


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = max(0, min(len(s) - 1, int(round(pct / 100 * len(s) + 0.5)) - 1))
    return round(s[k], 1)


def latency_summary(limit: int = 25) -> list[dict]:
    out = []
    for name, dq in _samples.items():
        v = list(dq)
        out.append({"route": name, "count": len(v), "p50_ms": percentile(v, 50), "p95_ms": percentile(v, 95),
                    "p99_ms": percentile(v, 99)})
    return sorted(out, key=lambda r: r["p95_ms"], reverse=True)[:limit]


async def metrics_endpoint(_: Request) -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
