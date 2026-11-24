"""Latency load test: p50 / p95 / p99 per endpoint under concurrency.

    python scripts/loadtest.py --base http://localhost:8080 --email admin@... --password ... \
        --concurrency 50 --duration 30

Signs in once, then runs a mix of anonymous and authenticated requests from N concurrent virtual
users for the given duration, and prints a latency table. Exit code 1 when any endpoint's p95 is
above --p95-budget (milliseconds), so it can gate CI or an upgrade.
"""

import argparse
import asyncio
import random
import statistics
import time
from collections import defaultdict

import httpx


def pct(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = max(0, min(len(s) - 1, int(round(p / 100 * len(s) + 0.5)) - 1))
    return s[k]


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--concurrency", type=int, default=50)
    ap.add_argument("--duration", type=int, default=30)
    ap.add_argument("--p95-budget", type=float, default=200.0)
    a = ap.parse_args()

    limits = httpx.Limits(max_connections=a.concurrency * 2, max_keepalive_connections=a.concurrency * 2)
    async with httpx.AsyncClient(base_url=a.base, timeout=30, limits=limits) as c:
        r = await c.post("/api/v1/auth/login", json={"email": a.email, "password": a.password})
        r.raise_for_status()
        token = r.json()["data"]["access_token"]
        auth = {"Authorization": f"Bearer {token}"}
        # (weight, name, method, path, needs auth)
        mix = [
            (40, "GET /public/site", "GET", "/api/v1/public/site", False),
            (25, "GET /auth/me", "GET", "/api/v1/auth/me", True),
            (15, "GET /admin/users", "GET", "/api/v1/admin/users?page_size=20", True),
            (10, "GET /admin/dashboard", "GET", "/api/v1/admin/dashboard", True),
            (10, "GET /admin/audit-logs", "GET", "/api/v1/admin/audit-logs?page_size=20", True),
        ]
        weights = [m[0] for m in mix]
        lat: dict[str, list[float]] = defaultdict(list)
        errors: dict[str, int] = defaultdict(int)
        stop = time.perf_counter() + a.duration

        async def user():
            while time.perf_counter() < stop:
                _, name, method, path, needs = random.choices(mix, weights)[0]
                t = time.perf_counter()
                try:
                    resp = await c.request(method, path, headers=auth if needs else None)
                    ok = resp.status_code < 400
                except httpx.HTTPError:
                    ok = False
                lat[name].append((time.perf_counter() - t) * 1000)
                if not ok:
                    errors[name] += 1

        t0 = time.perf_counter()
        await asyncio.gather(*(user() for _ in range(a.concurrency)))
        elapsed = time.perf_counter() - t0

    total = sum(len(v) for v in lat.values())
    print(f"\n{a.concurrency} concurrent users · {elapsed:.0f}s · {total} requests · {total / elapsed:.0f} req/s\n")
    print(f"{'endpoint':<24}{'count':>8}{'errors':>8}{'mean':>9}{'p50':>9}{'p95':>9}{'p99':>9}")
    worst = 0.0
    for name, v in sorted(lat.items()):
        p95 = pct(v, 95)
        worst = max(worst, p95)
        print(f"{name:<24}{len(v):>8}{errors[name]:>8}{statistics.mean(v):>8.1f}ms{pct(v, 50):>7.1f}ms{p95:>7.1f}ms{pct(v, 99):>7.1f}ms")
    allv = [x for v in lat.values() for x in v]
    print(f"{'ALL':<24}{len(allv):>8}{sum(errors.values()):>8}{statistics.mean(allv):>8.1f}ms{pct(allv, 50):>7.1f}ms"
          f"{pct(allv, 95):>7.1f}ms{pct(allv, 99):>7.1f}ms")
    verdict = "PASS" if worst <= a.p95_budget else "FAIL"
    print(f"\np95 budget {a.p95_budget:.0f} ms: {verdict} (worst endpoint p95 {worst:.1f} ms)")
    return 0 if verdict == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
