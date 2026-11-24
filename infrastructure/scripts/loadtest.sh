#!/usr/bin/env bash
# Load test through nginx with k6 (container on the stack's network). Reports p50/p95/p99 and
# exits non-zero when p95 exceeds the budget.
#   ./infrastructure/scripts/loadtest.sh <admin-email> <admin-password> [VUS=200] [P95_MS=200] [HOLD=2m]
# Note: the login rate limit (nginx 10 r/s) is not hit — the test signs in once.
source "$(dirname "$0")/common.sh"
EMAIL="${1:?admin email}"; PASSWORD="${2:?admin password}"
"${DOCKER[@]}" run --rm -i --network "${PROJECT}_edge" \
  -e BASE=http://nginx -e EMAIL="$EMAIL" -e PASSWORD="$PASSWORD" \
  -e VUS="${VUS:-200}" -e P95_MS="${P95_MS:-200}" -e HOLD="${HOLD:-2m}" \
  grafana/k6:0.55.0 run - < "$ROOT/infrastructure/loadtest/api.js"
