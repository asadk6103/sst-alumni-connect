#!/usr/bin/env bash
# Log inspection.
#   ./infrastructure/scripts/logs.sh                 follow all services
#   ./infrastructure/scripts/logs.sh api worker      follow some services
#   ./infrastructure/scripts/logs.sh --errors        recent warnings/errors from every service
source "$(dirname "$0")/common.sh"

if [ "${1:-}" = "--errors" ]; then
  compose logs --no-color --since 24h 2>/dev/null | grep -Ei ' (warning|error|critical|exception)|Traceback| 5[0-9]{2} ' | tail -n 200
  exit 0
fi
compose logs -f --tail=200 "$@"
