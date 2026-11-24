#!/usr/bin/env bash
# Upgrade after updating the source (git pull): backup → rebuild → rolling restart → health check.
# Data volumes are never removed. Database migrations run automatically when the API starts.
#   ./infrastructure/scripts/upgrade.sh [--skip-backup]
source "$(dirname "$0")/common.sh"

if [ "${1:-}" != "--skip-backup" ]; then
  step "Backing up first"
  "$ROOT/infrastructure/scripts/backup.sh" --keep 14
fi

step "Building new images"
compose build

step "Restarting services"
compose up -d --remove-orphans
wait_healthy api 600 >/dev/null || { compose logs --tail=80 api; die "The API is not healthy after the upgrade. Restore with restore.sh if needed."; }
"$ROOT/infrastructure/scripts/health.sh"
