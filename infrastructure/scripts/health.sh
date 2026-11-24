#!/usr/bin/env bash
# Health overview: container states plus HTTP checks through nginx.
source "$(dirname "$0")/common.sh"

step "Containers"
compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Health}}'

PORT="$(sed -n 's/^HTTP_PORT=//p' .env 2>/dev/null | tail -n1)"; PORT="${PORT:-8080}"
BASE="http://localhost:$PORT"
step "Endpoints ($BASE)"
fail=0
check() {  # check NAME PATH
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$BASE$2" || echo 000)"
  if [ "$code" -ge 200 ] && [ "$code" -lt 400 ]; then info "${G}OK${N}   $1 ($code)"; else info "${R}FAIL${N} $1 ($code)"; fail=1; fi
}
check "API readiness"       /api/v1/health/ready
check "Public website"      /
check "Portal / admin app"  /login
check "Site settings"       /api/v1/public/site
check "Real-time gateway"   /realtime/health
exit $fail
