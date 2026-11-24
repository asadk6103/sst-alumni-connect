# SST Alumni Connect — backend image (API, real-time gateway, Celery worker/beat, Flower)
# Build context: repository root.

FROM ghcr.io/astral-sh/uv:0.5.11 AS uv

FROM python:3.12.8-slim-bookworm AS build
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project

FROM python:3.12.8-slim-bookworm AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini curl \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --home-dir /app app
ENV PATH=/opt/venv/bin:$PATH PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    ENVIRONMENT=production CONFIG_DIR=/app/config STORAGE_DIR=/app/storage
COPY --from=build /opt/venv /opt/venv
WORKDIR /app
COPY backend/alembic.ini ./
COPY backend/alembic ./alembic
COPY backend/app ./app
COPY docker/backend/entrypoint.sh /entrypoint.sh
COPY docker/init/init-secrets.sh /app/init-secrets.sh
RUN mkdir -p /app/config /app/storage/public /app/storage/private \
 && chown -R app:app /app/config /app/storage \
 && chmod 755 /entrypoint.sh
USER app
EXPOSE 8000
ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
CMD ["api"]
