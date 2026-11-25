#!/usr/bin/env bash
# Restores a backup made by backup.sh. Replaces the current database (and files when present).
#   ./infrastructure/scripts/restore.sh backups/20261124-120000 [--yes]
source "$(dirname "$0")/common.sh"

SRC="${1:-}"; [ -n "$SRC" ] && [ -f "$SRC/database.dump" ] || die "Usage: restore.sh backups/<timestamp> [--yes]"
if [ "${2:-}" != "--yes" ]; then
  read -r -p "This REPLACES the current database$( [ -f "$SRC/storage.tar.gz" ] && echo ' and files') with $SRC. Type RESTORE to continue: " ok
  [ "$ok" = RESTORE ] || die "Cancelled."
fi
if [ -f "$SRC/SHA256SUMS" ]; then (cd "$SRC" && sha256sum -c --quiet SHA256SUMS) || die "Checksum mismatch — the backup is damaged."; fi

step "Stopping application services"
compose stop nginx api realtime celery-worker celery-beat >/dev/null

step "Restoring database"
compose exec -T postgres psql -U alumni -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS alumni WITH (FORCE)" -c "CREATE DATABASE alumni OWNER alumni" >/dev/null
compose exec -T postgres pg_restore -U alumni -d alumni --no-owner --exit-on-error < "$SRC/database.dump"
info "database restored"

restore_volume() {  # restore_volume VOLUME FILE
  [ -f "$SRC/$2" ] || return 0
  "${DOCKER[@]}" run --rm -v "$(volume "$1")":/data -v "$ROOT/$SRC":/in:ro alpine:3.20 \
    sh -c "find /data -mindepth 1 -delete && tar xzf /in/$2 -C /data"
  info "$2 restored"
}
step "Restoring files"
restore_volume storage storage.tar.gz
restore_volume miniodata objects.tar.gz
restore_volume app_config app-config.tar.gz

step "Starting the application (migrations run automatically)"
compose up -d
wait_healthy api 600 >/dev/null || die "The API did not become healthy after the restore."
echo; echo "${G}Restore complete.${N}"
