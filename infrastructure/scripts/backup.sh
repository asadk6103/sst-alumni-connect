#!/usr/bin/env bash
# Backs up the database (custom-format dump) and, unless --db-only, uploaded files and object storage.
#   ./infrastructure/scripts/backup.sh [--db-only] [--keep N]
# Output: backups/<timestamp>/{database.dump, storage.tar.gz, objects.tar.gz, app-config.tar.gz, SHA256SUMS}
# Backups contain personal data and encryption keys: store them encrypted and off the server.
source "$(dirname "$0")/common.sh"

DB_ONLY=0; KEEP=14
while [ $# -gt 0 ]; do
  case "$1" in --db-only) DB_ONLY=1; shift ;; --keep) KEEP="$2"; shift 2 ;; *) die "Unknown option $1" ;; esac
done

STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="backups/$STAMP"
mkdir -p "$DEST"
chmod 700 backups "$DEST" 2>/dev/null || true

step "Database"
compose exec -T postgres pg_dump -U alumni -d alumni -Fc --no-owner > "$DEST/database.dump"
info "database.dump ($(du -h "$DEST/database.dump" | cut -f1))"

archive() {  # archive VOLUME FILE
  "${DOCKER[@]}" run --rm -v "$(volume "$1")":/data:ro -v "$ROOT/$DEST":/out alpine:3.20 \
    tar czf "/out/$2" -C /data .
  info "$2 ($(du -h "$DEST/$2" | cut -f1))"
}
if [ $DB_ONLY = 0 ]; then
  step "Files"
  archive storage storage.tar.gz
  archive miniodata objects.tar.gz
  # application keys: needed to decrypt stored integration secrets after a restore
  archive app_config app-config.tar.gz
fi

(cd "$DEST" && sha256sum ./* > SHA256SUMS)
step "Pruning old backups (keeping the newest $KEEP)"
ls -1d backups/2* 2>/dev/null | sort -r | tail -n +$((KEEP + 1)) | xargs -r rm -rf
echo; echo "${G}Backup written to $DEST${N}"
