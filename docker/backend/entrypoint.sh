#!/bin/sh
# Role-based entrypoint for the backend image.
#   api       migrations + bootstrap, then the REST API (gunicorn + uvicorn workers)
#   realtime  Socket.IO gateway
#   worker    Celery worker          beat     Celery scheduler (run exactly one)
#   flower    Celery monitoring UI   migrate  migrations + bootstrap only
#   cli ...   python -m app.cli ...
set -e
ROLE="${1:-api}"
shift || true

# Connection strings from the generated infrastructure secrets (docker/init/init-secrets.sh),
# unless they were provided explicitly (external database / Redis / S3).
INFRA=/run/infra
if [ -d "$INFRA" ]; then
  if [ -z "${DATABASE_URL:-}" ] && [ -s "$INFRA/postgres_password" ]; then
    export DATABASE_URL="postgresql+asyncpg://${POSTGRES_USER:-alumni}:$(cat $INFRA/postgres_password)@${POSTGRES_HOST:-postgres}:5432/${POSTGRES_DB:-alumni}"
  fi
  if [ -z "${REDIS_URL:-}" ] && [ -s "$INFRA/redis_password" ]; then
    export REDIS_URL="redis://:$(cat $INFRA/redis_password)@${REDIS_HOST:-redis}:6379/0"
  fi
  if [ -n "${MINIO_ENDPOINT:-}" ] && [ -s "$INFRA/minio_user" ]; then
    export MINIO_ACCESS_KEY="$(cat $INFRA/minio_user)" MINIO_SECRET_KEY="$(cat $INFRA/minio_password)"
  fi
  if [ -s "$INFRA/flower_password" ]; then
    export FLOWER_PASSWORD="${FLOWER_PASSWORD:-$(cat $INFRA/flower_password)}"
  fi
fi

prepare() {
  echo "[entrypoint] applying database migrations…"
  alembic upgrade head
  echo "[entrypoint] synchronising roles, permissions and defaults…"
  python -m app.bootstrap
}

case "$ROLE" in
  api)
    prepare
    exec gunicorn app.main:app \
      --worker-class uvicorn.workers.UvicornWorker \
      --workers "${API_WORKERS:-2}" \
      --bind 0.0.0.0:8000 \
      --forwarded-allow-ips="*" \
      --graceful-timeout 20 --timeout 60 --keep-alive 5 \
      --access-logfile - --error-logfile -
    ;;
  realtime)
    exec uvicorn app.realtime:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips="*" \
      --ws websockets --timeout-keep-alive 75 --no-access-log
    ;;
  worker)
    exec celery -A app.worker:celery_app worker --loglevel "${LOG_LEVEL:-INFO}" \
      --queues default,notifications --concurrency "${WORKER_CONCURRENCY:-4}" --without-gossip --without-mingle
    ;;
  beat)
    exec celery -A app.worker:celery_app beat --loglevel "${LOG_LEVEL:-INFO}" --schedule /tmp/celerybeat-schedule
    ;;
  flower)
    exec celery -A app.worker:celery_app flower --port=5555 --url_prefix=flower \
      --basic_auth="${FLOWER_USER:-admin}:${FLOWER_PASSWORD:?FLOWER_PASSWORD is required}"
    ;;
  migrate)
    prepare
    ;;
  cli)
    exec python -m app.cli "$@"
    ;;
  *)
    exec "$ROLE" "$@"
    ;;
esac
