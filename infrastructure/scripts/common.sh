#!/usr/bin/env bash
# Shared helpers for the operator scripts (sourced, not run).
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
if [ -t 1 ]; then B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; N=$'\e[0m'; else B=; G=; Y=; R=; N=; fi
step() { echo; echo "${B}==> $*${N}"; }
info() { echo "    $*"; }
warn() { echo "${Y}WARNING:${N} $*" >&2; }
die()  { echo "${R}ERROR:${N} $*" >&2; exit 1; }

DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  if command -v sudo >/dev/null && sudo docker info >/dev/null 2>&1; then DOCKER=(sudo docker); else die "Docker is not running or not accessible."; fi
fi
"${DOCKER[@]}" compose version >/dev/null 2>&1 || die "The Docker Compose plugin (docker compose) is required."

# Use the production overlay when present in COMPOSE_FILE or requested with PROD=1.
COMPOSE_ARGS=()
if [ "${PROD:-0}" = 1 ]; then COMPOSE_ARGS=(-f docker-compose.yml -f docker-compose.prod.yml); fi
compose() { "${DOCKER[@]}" compose "${COMPOSE_ARGS[@]}" "$@"; }

PROJECT=sst-alumni
volume() { echo "${PROJECT}_$1"; }

wait_healthy() {  # wait_healthy SERVICE TIMEOUT_SECONDS
  local svc=$1 limit=${2:-300} id status=""
  for _ in $(seq 1 $((limit / 5))); do
    id="$(compose ps -q "$svc" | head -n1)"
    status="$("${DOCKER[@]}" inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo starting)"
    [ "$status" = healthy ] && return 0
    sleep 5
  done
  echo "$status"
  return 1
}
