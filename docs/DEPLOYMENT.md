# Deployment guide

## Requirements
- Docker Engine 24+ with the Compose plugin 2.24+ (Docker Desktop on Windows/macOS).
- 4 GB RAM minimum (8 GB recommended for the production overlay), 20 GB disk plus uploads.

## Services

| Service | Role | Scales | Persistent data |
|---|---|---|---|
| `nginx` | single entry point (port `HTTP_PORT`, default 8080), serves the portal/admin app | – | – |
| `api` | REST API; runs migrations + bootstrap on start | ✓ `--scale api=N` | – |
| `realtime` | Socket.IO gateway (WebSocket), Redis-coordinated | ✓ `--scale realtime=N` | – |
| `celery-worker` | email/SMS delivery, background jobs | ✓ | – |
| `celery-beat` | scheduler (exactly one) | – | – |
| `postgres` | database | – | `pgdata` |
| `redis` | cache, rate limits, queues, presence | – | `redisdata` |
| `minio` | object storage (bundled S3) | – | `miniodata` |
| `init-secrets` | one-shot: generates infrastructure passwords | – | `infra_secrets` |
| `flower` (profile `ops`) | queue monitor at `/flower/` (basic auth) | – | – |
| `mailpit` (profile `dev`) | development mail catcher at :8025 | – | – |

Other volumes: `storage` (local uploads), `app_config` (application keys and setup code).
Networks: `edge` (public) and `data` (internal only — PostgreSQL, Redis and MinIO are unreachable from outside).

## Configuration

Infrastructure values only (`.env`, all optional):

| Variable | Default | Purpose |
|---|---|---|
| `HTTP_PORT` | 8080 | host port for nginx |
| `ENVIRONMENT` | production | `development` pre-fills Mailpit in the setup wizard |
| `COMPOSE_PROFILES` | – | `dev`, `ops` |
| `API_WORKERS` | 4 | processes per API container |
| `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` | 10 / 20 | connections per API process |
| `POSTGRES_MAX_CONNECTIONS` / `POSTGRES_SHARED_BUFFERS` | 300 / 256MB | database sizing |
| `API_REPLICAS` / `REALTIME_REPLICAS` / `WORKER_REPLICAS` | 2 / 2 / 1 | production overlay |
| `LOG_LEVEL` | INFO | backend log level |

Passwords are **not** configured: `init-secrets` generates them into the `infra_secrets` volume. Application
settings (institution, branding, SMTP/SMS/storage credentials, security policy, modules, feature flags,
real-time limits) are managed in **System Configuration**; credentials are encrypted at rest with a key
generated into `app_config` and never shown again after saving.

Settings marked **restart** in the UI (real-time heartbeat/timeout/connection cap) apply after
`docker compose restart realtime`.

## First run
1. `docker compose up -d --build`
2. `docker compose logs api` → setup code
3. `http://<server>:8080/setup` → wizard → you are signed in as Super Administrator.

Lost the code? `docker compose exec api python -m app.cli setup-code`.
Locked out? `docker compose exec -it api python -m app.cli reset-password <email>` or `create-admin <email> "<name>"`.

## HTTPS
**Automatic (recommended):** `./install/install-docker.sh --domain alumni.example.org --email it@example.org`.
This adds Caddy (`docker-compose.letsencrypt.yml`), which gets and renews a Let's Encrypt certificate by itself.
On bare metal, `sudo ./install/install-baremetal.sh --domain … --email …` uses certbot. See
[install/README.md](../install/README.md).

**Own certificate:** a TLS edge (`docker-compose.https.yml`) listens on 80/443. It redirects HTTP to HTTPS, sends HSTS and
forwards to nginx with `X-Forwarded-Proto: https` (secure cookies). WebSockets work through it.

1. Point the domain's DNS to the server.
2. Get a certificate. With Let's Encrypt (first time, nothing listening on port 80 yet):
   ```
   docker run --rm -p 80:80 -v "$PWD/certs:/etc/letsencrypt" certbot/certbot certonly --standalone      -d alumni.example.org --agree-tos -m it@example.org --non-interactive
   cp certs/live/alumni.example.org/fullchain.pem certs/live/alumni.example.org/privkey.pem certs/
   ```
   Or copy the institution's certificate to `certs/fullchain.pem` and `certs/privkey.pem`.
3. `make up-https` (production sizing + TLS edge). The main nginx is then bound to `127.0.0.1:8080` only.
4. Set System Configuration → General → Application URL to `https://alumni.example.org`.
5. Renewal (monthly cron; uses the webroot served by the edge):
   ```
   docker run --rm -v "$PWD/certs:/etc/letsencrypt" -v "$PWD/certs/acme:/var/www/acme" certbot/certbot renew      --webroot -w /var/www/acme && cp certs/live/*/fullchain.pem certs/live/*/privkey.pem certs/      && docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.https.yml exec tls nginx -s reload
   ```
Behind an existing load balancer instead: skip the overlay and forward `X-Forwarded-Proto: https` to port 8080.

## Backups
Full guide: [BACKUP_RESTORE.md](BACKUP_RESTORE.md).

`make backup` writes `backups/<timestamp>/` with `database.dump`, `storage.tar.gz`, `objects.tar.gz`,
`app-config.tar.gz` (needed to decrypt stored credentials) and `SHA256SUMS`. Keep copies off the server
and encrypted — they contain personal data. Restore with `make restore b=backups/<timestamp>`.
Schedule nightly with cron, e.g. `0 2 * * * cd /opt/sst-alumni-connect && ./infrastructure/scripts/backup.sh`.

## Upgrades
`git pull && make upgrade` — takes a backup, rebuilds, restarts (migrations run automatically, volumes are
kept) and runs the health checks.

## Performance (p95)
Every response carries `Server-Timing: app;dur=<ms>`; **Administration → System Health** shows p50/p95/p99
per route for the current API instance, and `/metrics` (internal network) exposes Prometheus histograms.
`make loadtest email=… password=… VUS=200 P95_MS=200` runs k6 through nginx and fails when p95 exceeds
the budget.
