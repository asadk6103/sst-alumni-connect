#!/usr/bin/env bash
# First installation: builds and starts the stack, waits until it is healthy and prints the setup code.
#   ./infrastructure/scripts/install.sh            (PROD=1 to use docker-compose.prod.yml)
source "$(dirname "$0")/common.sh"

step "Preparing configuration"
if [ ! -f .env ]; then cp .env.example .env; info "created .env from .env.example (optional settings only)"; fi

step "Building and starting containers (the first build takes several minutes)"
compose up -d --build

step "Waiting for the API"
if ! wait_healthy api 600; then compose logs --tail=80 api; die "The API did not become healthy. See the log above."; fi
info "API is healthy"

PORT="$(sed -n 's/^HTTP_PORT=//p' .env | tail -n1)"; PORT="${PORT:-8080}"
CODE="$(compose exec -T api cat /app/config/setup-code.txt 2>/dev/null | tr -d '\r\n' || true)"
echo
echo "${G}${B}SST Alumni Connect is running.${N}  Open http://localhost:${PORT}/setup"
if [ -n "$CODE" ]; then
  echo "    First-run setup code: ${B}${CODE}${N}    (shown again with: docker compose logs api)"
else
  echo "    Installation already completed — sign in at http://localhost:${PORT}/login"
fi
