#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  SST Alumni Connect — bare-metal installer (no Docker)
#
#  Supported: Ubuntu 22.04 / 24.04, Debian 12 (x86_64 or arm64), 4 GB RAM or more.
#
#  Installs PostgreSQL, Redis, nginx, Python 3.12 (via uv) and Node.js 22, builds the API and the
#  portal/admin app, and runs them as systemd services behind nginx:
#
#     /api/        → REST API            (sst-alumni-api.service,      127.0.0.1:8100)
#     /realtime/   → Socket.IO gateway   (sst-alumni-realtime.service, 127.0.0.1:8101)
#     /media/      → uploaded files      (<prefix>/data/storage/public, else streamed by the API)
#     /            → portal, administration, sign-in and setup wizard (static files)
#     background   → sst-alumni-worker.service (Celery) + sst-alumni-beat.service (scheduler)
#
#  Files are stored on the local disk (storage provider "local"). An S3-compatible object store
#  can be configured later in System Configuration → Storage.
#
#  Run from the project folder:
#     sudo ./install/install-baremetal.sh                                              # http://<server>/
#     sudo ./install/install-baremetal.sh --domain alumni.school.pk --email it@school.pk  # + HTTPS
#
#  Re-running the script upgrades an existing installation (database backup, rebuild,
#  migrations, restart). Data, uploads, users and security keys are kept.
# ─────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail

PREFIX=/opt/sst-alumni
DOMAIN=""
EMAIL=""
HTTP_PORT=80
SKIP_PACKAGES=0
SKIP_BACKUP=0
API_WORKERS=""

usage() {
  cat <<'EOF'
Usage: sudo ./install/install-baremetal.sh [options]

  --domain NAME      Domain name nginx answers to (default: any name / IP address)
  --email ADDRESS    With --domain: request a free Let's Encrypt HTTPS certificate
  --port N           HTTP port for nginx (default 80)
  --prefix DIR       Installation folder (default /opt/sst-alumni)
  --workers N        API worker processes (default: number of CPU cores, 2–8)
  --skip-packages    Do not install system packages (PostgreSQL, Redis, nginx, Node.js, uv)
  --skip-backup      Upgrades: do not back up the database first
  -h, --help         Show this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --port) HTTP_PORT="${2:-}"; shift 2 ;;
    --prefix) PREFIX="${2:-}"; shift 2 ;;
    --workers) API_WORKERS="${2:-}"; shift 2 ;;
    --skip-packages) SKIP_PACKAGES=1; shift ;;
    --skip-backup) SKIP_BACKUP=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

# ── helpers ──────────────────────────────────────────────────────────────────
if [ -t 1 ]; then B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; N=$'\e[0m'; else B=; G=; Y=; R=; N=; fi
step() { echo; echo "${B}==> $*${N}"; }
info() { echo "    $*"; }
warn() { echo "${Y}WARNING:${N} $*" >&2; }
die()  { echo "${R}ERROR:${N} $*" >&2; exit 1; }
trap 'die "installation failed at line $LINENO (see the output above)."' ERR

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$PREFIX/app"
DATA="$PREFIX/data"
WWW="$PREFIX/www"
HOME_DIR="$PREFIX/home"
PYTHONS="$PREFIX/python"
BACKUPS="$PREFIX/backups"
ETC=/etc/sst-alumni
ENV_FILE="$ETC/alumni.env"
SVC_USER=alumni
DB_NAME=alumni
DB_USER=alumni
UV_VERSION=0.5.11
API_PORT=8100
RT_PORT=8101
SERVICES=(sst-alumni-api sst-alumni-realtime sst-alumni-worker sst-alumni-beat)

[ "$(id -u)" -eq 0 ] || die "run this script as root, e.g.  sudo $0"
[ -f "$SRC/docker-compose.yml" ] && grep -q '^name: sst-alumni' "$SRC/docker-compose.yml" && [ -f "$SRC/backend/pyproject.toml" ] \
  || die "run the script from inside the SST Alumni Connect project folder (install/install-baremetal.sh)."
[[ "$HTTP_PORT" =~ ^[0-9]+$ ]] && [ "$HTTP_PORT" -ge 1 ] && [ "$HTTP_PORT" -le 65535 ] || die "--port must be a number between 1 and 65535."
if [ -n "$EMAIL" ] && [ -z "$DOMAIN" ]; then die "--email needs --domain (certificates are issued for a domain name)."; fi
if [ -n "$EMAIL" ] && [ "$HTTP_PORT" != 80 ]; then die "HTTPS certificates need nginx on port 80 (drop --port)."; fi
if [ -n "$DOMAIN" ]; then [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || die "--domain must be a single domain name (e.g. alumni.school.pk)."; fi
if [ -z "$API_WORKERS" ]; then
  API_WORKERS=$(nproc 2>/dev/null || echo 2); [ "$API_WORKERS" -lt 2 ] && API_WORKERS=2; [ "$API_WORKERS" -gt 8 ] && API_WORKERS=8
fi
[[ "$API_WORKERS" =~ ^[0-9]+$ ]] && [ "$API_WORKERS" -ge 1 ] || die "--workers must be a positive number."

# shellcheck disable=SC1091
. /etc/os-release
case " ${ID:-} ${ID_LIKE:-} " in
  *" debian "*|*" ubuntu "*) ;;
  *) die "this installer supports Ubuntu and Debian. Detected: ${PRETTY_NAME:-unknown}." ;;
esac

UPGRADE=0
[ -f "$ENV_FILE" ] && UPGRADE=1

mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
swap_kb=$(awk '/SwapTotal/ {print $2}' /proc/meminfo)
if [ $(( mem_kb + swap_kb )) -lt 3800000 ]; then
  warn "less than 4 GB of memory (RAM + swap). Building the portal may fail — add swap if it does."
fi

as_svc() {
  runuser -u "$SVC_USER" -- env HOME="$HOME_DIR" PATH="/usr/local/bin:$PATH" CI=1 \
    UV_CACHE_DIR="$HOME_DIR/.cache/uv" UV_PYTHON_INSTALL_DIR="$PYTHONS" "$@"
}
pg() { (cd / && runuser -u postgres -- psql -v ON_ERROR_STOP=1 -qtA "$@"); }
env_value() { [ -f "$ENV_FILE" ] && sed -n "s#^$1=##p" "$ENV_FILE" | tail -n1 || true; }

echo "${B}SST Alumni Connect — bare-metal installer${N}"
info "source:      $SRC"
info "install to:  $PREFIX"
info "mode:        $([ $UPGRADE = 1 ] && echo upgrade || echo new installation)"

# ── 1. system packages ───────────────────────────────────────────────────────
if [ $SKIP_PACKAGES = 0 ]; then
  step "Installing system packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get install -y -q ca-certificates curl gnupg rsync openssl build-essential \
    nginx postgresql postgresql-contrib redis-server

  node_major=0
  command -v node >/dev/null && node_major=$(node -p 'process.versions.node.split(".")[0]')
  if [ "$node_major" -lt 20 ]; then
    info "installing Node.js 22 (NodeSource)"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -q nodejs
  else
    info "Node.js $(node -v) already installed"
  fi

  if ! command -v uv >/dev/null || [ "$(uv --version | awk '{print $2}')" != "$UV_VERSION" ]; then
    info "installing uv $UV_VERSION (Python package manager; it also provides Python 3.12)"
    curl -LsSf "https://astral.sh/uv/$UV_VERSION/install.sh" | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 INSTALLER_NO_MODIFY_PATH=1 sh
  fi
  if [ -n "$EMAIL" ]; then apt-get install -y -q certbot python3-certbot-nginx; fi
fi

command -v node >/dev/null || die "Node.js is not installed."
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || die "Node.js 20 or newer is required (found $(node -v))."
for c in npm uv psql pg_dump redis-cli nginx rsync openssl; do
  command -v "$c" >/dev/null || [ -x "/usr/local/bin/$c" ] || die "'$c' is not installed."
done

systemctl enable --now postgresql >/dev/null
systemctl enable nginx >/dev/null

# ── 2. service account and folders ───────────────────────────────────────────
step "Preparing the service account and folders"
if ! id "$SVC_USER" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$HOME_DIR" --shell /usr/sbin/nologin "$SVC_USER"
  info "created system user '$SVC_USER'"
fi
install -d -m 755 "$PREFIX" "$WWW"
install -d -m 755 -o "$SVC_USER" -g "$SVC_USER" "$APP" "$HOME_DIR" "$PYTHONS" "$DATA" "$DATA/storage" "$DATA/storage/public"
install -d -m 700 -o "$SVC_USER" -g "$SVC_USER" "$DATA/config" "$DATA/storage/private" "$DATA/run"
install -d -m 700 "$BACKUPS"
install -d -m 750 -g "$SVC_USER" "$ETC"

# ── 3. database and Redis ────────────────────────────────────────────────────
step "Configuring PostgreSQL"
DB_PASSWORD="$(env_value DATABASE_URL | sed -n "s#^postgresql+asyncpg://$DB_USER:\([^@]*\)@.*#\1#p")"
[ -n "$DB_PASSWORD" ] || DB_PASSWORD=$(openssl rand -hex 24)
if [ "$(pg -c "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER'")" = 1 ]; then
  pg -c "ALTER ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASSWORD'"
else
  pg -c "CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASSWORD'"
  info "created database role '$DB_USER'"
fi
DB_EXISTS=0
if [ "$(pg -c "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'")" = 1 ]; then
  DB_EXISTS=1
else
  (cd / && runuser -u postgres -- createdb -O "$DB_USER" -E UTF8 -T template0 "$DB_NAME")
  info "created database '$DB_NAME'"
fi

step "Configuring Redis (queues, real-time fan-out, rate limits)"
REDIS_PASSWORD="$(env_value REDIS_URL | sed -n 's#^redis://:\([^@]*\)@.*#\1#p')"
[ -n "$REDIS_PASSWORD" ] || REDIS_PASSWORD=$(openssl rand -hex 24)
REDIS_CONF=/etc/redis/redis.conf
[ -f "$REDIS_CONF" ] || die "$REDIS_CONF not found (is redis-server installed?)."
sed -i -E '/^[[:space:]]*requirepass[[:space:]]/d; /^# sst-alumni$/d' "$REDIS_CONF"
printf '# sst-alumni\nrequirepass %s\n' "$REDIS_PASSWORD" >> "$REDIS_CONF"
grep -qE '^[[:space:]]*bind[[:space:]]' "$REDIS_CONF" || echo "bind 127.0.0.1 -::1" >> "$REDIS_CONF"
grep -qE '^[[:space:]]*maxmemory-policy[[:space:]]+noeviction' "$REDIS_CONF" || echo "maxmemory-policy noeviction" >> "$REDIS_CONF"
systemctl enable redis-server >/dev/null
systemctl restart redis-server

# Only infrastructure settings live here. Application keys and the setup code are generated by the
# API on first start (in $DATA/config); everything else is configured in the web interface.
umask 027
cat > "$ENV_FILE" <<EOF
# SST Alumni Connect — written by install/install-baremetal.sh. Infrastructure settings only:
# institution, branding, email/SMS/storage credentials and security policy are managed in the
# web interface (setup wizard, then Administration → System Configuration).
ENVIRONMENT=production
DATABASE_URL=postgresql+asyncpg://$DB_USER:$DB_PASSWORD@127.0.0.1:5432/$DB_NAME
REDIS_URL=redis://:$REDIS_PASSWORD@127.0.0.1:6379/0
CONFIG_DIR=$DATA/config
STORAGE_DIR=$DATA/storage
TRUSTED_PROXIES=1
LOG_LEVEL=INFO
API_WORKERS=$API_WORKERS
WORKER_CONCURRENCY=4
DB_POOL_SIZE=10
DB_MAX_OVERFLOW=20
EOF
umask 022
chown root:"$SVC_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"

if [ $UPGRADE = 1 ] && [ $DB_EXISTS = 1 ] && [ $SKIP_BACKUP = 0 ]; then
  BACKUP_FILE="$BACKUPS/alumni-$(date +%Y%m%d-%H%M%S).dump"
  (cd / && runuser -u postgres -- pg_dump -Fc "$DB_NAME") > "$BACKUP_FILE"
  tar czf "${BACKUP_FILE%.dump}-config.tar.gz" -C "$DATA" config
  info "database backed up to $BACKUP_FILE (application keys: ${BACKUP_FILE%.dump}-config.tar.gz)"
fi

# ── 4. application files ─────────────────────────────────────────────────────
step "Copying the application"
for s in "${SERVICES[@]}"; do
  if systemctl is-active --quiet "$s" 2>/dev/null; then systemctl stop "$s"; info "stopped $s for the upgrade"; fi
done
if [ "$SRC" != "$APP" ]; then
  rsync -a --delete \
    --exclude '.git/' --exclude 'node_modules/' --exclude '.env' --exclude '.venv/' --exclude 'dist/' \
    --exclude '__pycache__/' --exclude '.pytest_cache/' --exclude '.ruff_cache/' --exclude '*.tsbuildinfo' \
    --exclude '/storage/' --exclude '/backups/' --exclude '/certs/' --exclude '/backend/config/' \
    --exclude '/backend/storage/' --exclude '/docs/design/' \
    "$SRC/" "$APP/"
fi
chown -R "$SVC_USER:$SVC_USER" "$APP"

# ── 5. build ─────────────────────────────────────────────────────────────────
step "Installing the API (Python 3.12 and dependencies — a few minutes the first time)"
(cd "$APP/backend" && as_svc uv sync --frozen --no-dev --python 3.12)
VENV="$APP/backend/.venv"
[ -x "$VENV/bin/gunicorn" ] || die "the Python environment was not created ($VENV)."

step "Building the portal and administration app"
(cd "$APP/frontend/app" && as_svc npm ci --no-audit --no-fund && as_svc npm run build)
[ -f "$APP/frontend/app/dist/index.html" ] || die "the portal build did not produce dist/index.html."
rsync -a --delete "$APP/frontend/app/dist/" "$WWW/app/"
install -d -m 755 "$WWW/html"
install -m 644 "$APP/infrastructure/nginx/html/__unavailable.html" "$WWW/html/__unavailable.html"

# ── 6. systemd services ──────────────────────────────────────────────────────
step "Installing systemd services"
unit() {  # unit NAME DESCRIPTION EXEC [EXEC_START_PRE...]
  local name=$1 desc=$2 exec=$3; shift 3
  {
    cat <<EOF
[Unit]
Description=SST Alumni Connect — $desc
After=network-online.target postgresql.service redis-server.service
Wants=network-online.target
Requires=postgresql.service redis-server.service

[Service]
Type=simple
User=$SVC_USER
Group=$SVC_USER
WorkingDirectory=$APP/backend
EnvironmentFile=$ENV_FILE
Environment=HOME=$HOME_DIR PATH=$VENV/bin:/usr/local/bin:/usr/bin:/bin PYTHONUNBUFFERED=1
EOF
    for pre in "$@"; do echo "ExecStartPre=$pre"; done
    cat <<EOF
ExecStart=$exec
Restart=on-failure
RestartSec=5
TimeoutStartSec=900
TimeoutStopSec=30
UMask=0022
LimitNOFILE=65535
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
EOF
  } > "/etc/systemd/system/$name.service"
}
# Same start-up as the Docker image: migrations + roles/permissions/defaults, then the service.
unit sst-alumni-api "REST API" \
  "$VENV/bin/gunicorn app.main:app --worker-class uvicorn.workers.UvicornWorker --workers \${API_WORKERS} --bind 127.0.0.1:$API_PORT --forwarded-allow-ips=127.0.0.1 --graceful-timeout 20 --timeout 60 --keep-alive 5 --access-logfile - --error-logfile -" \
  "$VENV/bin/alembic upgrade head" "$VENV/bin/python -m app.bootstrap"
unit sst-alumni-realtime "real-time gateway (Socket.IO)" \
  "$VENV/bin/uvicorn app.realtime:app --host 127.0.0.1 --port $RT_PORT --proxy-headers --forwarded-allow-ips=127.0.0.1 --ws websockets --timeout-keep-alive 75 --no-access-log"
unit sst-alumni-worker "background tasks (Celery worker)" \
  "$VENV/bin/celery -A app.worker:celery_app worker --loglevel \${LOG_LEVEL} --queues default,notifications --concurrency \${WORKER_CONCURRENCY} --without-gossip --without-mingle"
unit sst-alumni-beat "scheduled tasks (Celery beat)" \
  "$VENV/bin/celery -A app.worker:celery_app beat --loglevel \${LOG_LEVEL} --schedule $DATA/run/celerybeat-schedule"
# The real-time gateway and the workers need the schema the API applies at start.
for s in sst-alumni-realtime sst-alumni-worker sst-alumni-beat; do
  sed -i "s#^After=network-online.target#After=network-online.target sst-alumni-api.service#" "/etc/systemd/system/$s.service"
done
systemctl daemon-reload
systemctl enable "${SERVICES[@]}" >/dev/null

# ── 7. nginx ─────────────────────────────────────────────────────────────────
step "Configuring nginx"
SERVER_NAME="${DOMAIN:-_}"
LISTEN_OPTS=""
[ -z "$DOMAIN" ] && LISTEN_OPTS=" default_server"
SITE=/etc/nginx/sites-available/sst-alumni.conf
# A certbot run edits this file to add HTTPS, so keep it if it already holds a certificate.
if [ -f "$SITE" ] && grep -q "managed by Certbot" "$SITE"; then
  info "keeping $SITE (it contains the HTTPS settings added by certbot)"
else
  cat > "$SITE" <<EOF
# SST Alumni Connect — written by install/install-baremetal.sh
map \$http_upgrade \$alumni_connection_upgrade { default upgrade; '' close; }
map \$http_x_forwarded_proto \$alumni_forwarded_proto { default \$http_x_forwarded_proto; '' \$scheme; }
limit_req_zone \$binary_remote_addr zone=alumni_auth:10m rate=10r/s;
limit_req_zone \$binary_remote_addr zone=alumni_api:20m rate=50r/s;

server {
  listen $HTTP_PORT$LISTEN_OPTS;
  listen [::]:$HTTP_PORT$LISTEN_OPTS;
  server_name $SERVER_NAME;

  server_tokens off;
  client_max_body_size 101m;   # the API enforces the configured upload limit (max 100 MB)
  limit_req_status 429;

  gzip on;
  gzip_comp_level 5;
  gzip_min_length 1024;
  gzip_vary on;
  gzip_types text/plain text/css application/json application/javascript text/javascript image/svg+xml application/xml;

  add_header X-Content-Type-Options nosniff always;
  add_header X-Frame-Options SAMEORIGIN always;
  add_header Referrer-Policy strict-origin-when-cross-origin always;
  add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

  proxy_http_version 1.1;
  proxy_set_header Host              \$host;
  proxy_set_header X-Real-IP         \$remote_addr;
  proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto \$alumni_forwarded_proto;
  proxy_set_header Upgrade           \$http_upgrade;
  proxy_set_header Connection        \$alumni_connection_upgrade;

  error_page 502 503 504 /__unavailable.html;
  location = /__unavailable.html { root $WWW/html; internal; }
  location = /metrics { return 404; }

  location /api/v1/auth/ {
    limit_req zone=alumni_auth burst=20 nodelay;
    proxy_pass http://127.0.0.1:$API_PORT;
  }
  location /api/ {
    limit_req zone=alumni_api burst=100 nodelay;
    proxy_pass http://127.0.0.1:$API_PORT;
    proxy_read_timeout 120s;
  }

  location /realtime/ {
    proxy_pass http://127.0.0.1:$RT_PORT;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
  }

  location /media/ {
    root $DATA/storage/public;
    rewrite ^/media/(.*)\$ /\$1 break;
    try_files \$uri @media_api;
    expires 30d;
    add_header Cache-Control "public, immutable" always;
    add_header X-Content-Type-Options nosniff always;
  }
  location @media_api { proxy_pass http://127.0.0.1:$API_PORT; }

  location /spa-assets/ {
    root $WWW/app;
    expires 1y;
    add_header Cache-Control "public, immutable" always;
    try_files \$uri =404;
  }
  location / {
    root $WWW/app;
    try_files \$uri /index.html;
    add_header Cache-Control "no-cache" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self' ws: wss:; frame-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;
  }
}
EOF
fi
ln -sf "$SITE" /etc/nginx/sites-enabled/sst-alumni.conf
if [ -z "$DOMAIN" ] && [ -L /etc/nginx/sites-enabled/default ] && grep -qE "listen\s+$HTTP_PORT\s+default_server" /etc/nginx/sites-available/default 2>/dev/null; then
  rm /etc/nginx/sites-enabled/default
  info "disabled nginx's default welcome site (it also claimed port $HTTP_PORT)"
fi
nginx -t 2>&1 | sed 's/^/    /'
systemctl reload-or-restart nginx

if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "$HTTP_PORT/tcp" >/dev/null
  if [ -n "$EMAIL" ]; then ufw allow 443/tcp >/dev/null; fi
  info "firewall (ufw): opened port $HTTP_PORT$([ -n "$EMAIL" ] && echo ' and 443')"
fi

# ── 8. start ─────────────────────────────────────────────────────────────────
step "Starting the services (the first start creates the database tables and defaults)"
systemctl restart sst-alumni-api || die "the API did not start. Check:  journalctl -u sst-alumni-api -n 100 --no-pager"
for s in sst-alumni-realtime sst-alumni-worker sst-alumni-beat; do systemctl restart "$s"; done
for _ in $(seq 1 90); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$API_PORT/api/v1/health/ready" && curl -fsS -o /dev/null "http://127.0.0.1:$RT_PORT/realtime/health"; then break; fi
  sleep 2
done
curl -fsS -o /dev/null "http://127.0.0.1:$API_PORT/api/v1/health/ready" || die "the API is not answering. Check:  journalctl -u sst-alumni-api -n 100 --no-pager"
curl -fsS -o /dev/null "http://127.0.0.1:$RT_PORT/realtime/health" || warn "the real-time gateway is not answering yet. Check:  journalctl -u sst-alumni-realtime -n 100 --no-pager"
for s in sst-alumni-worker sst-alumni-beat; do
  systemctl is-active --quiet "$s" || warn "$s is not running. Check:  journalctl -u $s -n 100 --no-pager"
done

# ── 9. HTTPS (optional) ──────────────────────────────────────────────────────
SCHEME=http
if [ -n "$EMAIL" ]; then
  step "Requesting an HTTPS certificate for $DOMAIN"
  if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect; then
    SCHEME=https
  else
    warn "certbot failed — the site is available over HTTP. Make sure $DOMAIN points to this server, then run:"
    warn "  sudo certbot --nginx -d $DOMAIN --redirect"
  fi
elif [ -n "$DOMAIN" ] && grep -q "managed by Certbot" "$SITE"; then
  SCHEME=https
fi

# ── done ─────────────────────────────────────────────────────────────────────
if [ -n "$DOMAIN" ]; then HOST="$DOMAIN"; else HOST="$(hostname -I 2>/dev/null | awk '{print $1}')"; HOST="${HOST:-localhost}"; fi
PORT_SUFFIX=""
if [ "$SCHEME" = http ] && [ "$HTTP_PORT" != 80 ]; then PORT_SUFFIX=":$HTTP_PORT"; fi
BASE="$SCHEME://$HOST$PORT_SUFFIX"

code="$(cd "$APP/backend" && runuser -u "$SVC_USER" -- env $(grep -v '^#' "$ENV_FILE" | xargs) HOME="$HOME_DIR" "$VENV/bin/python" -m app.cli setup-code 2>/dev/null | tail -n1 || true)"
echo
echo "${G}${B}SST Alumni Connect is installed.${N}"
if [ -n "$code" ] && ! echo "$code" | grep -qi "complete"; then
  echo "    Setup wizard:  $BASE/setup"
  echo
  echo "    ${B}First-run setup:${N} open the setup wizard and enter this setup code:"
  echo
  echo "        ${B}$code${N}"
  echo
  echo "    (shown again any time with:  sudo cat $DATA/config/setup-code.txt)"
else
  echo "    Sign in:       $BASE/login"
fi
cat <<EOF

    Services:   systemctl status ${SERVICES[*]}
    Logs:       journalctl -u sst-alumni-api -f      (also -realtime, -worker, -beat)
    Upgrade:    pull the new version, then run this script again
    Data:       database '$DB_NAME', files in $DATA/storage, keys in $DATA/config
    Backups:    $BACKUPS (taken before each upgrade — copy them off the server)
    Mobile app: on the app's sign-in screen, set the server to $BASE
EOF
