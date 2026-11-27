# Installing SST Alumni Connect

Two installers are available. Neither needs passwords in a `.env` file. After installation, open
`/setup` and complete the setup wizard with the **setup code** the installer prints. The wizard covers
institution, branding, the first administrator, email, storage and security.

| | Docker Compose | Bare metal |
|---|---|---|
| Script | `install-docker.sh` (Linux/macOS), `install-docker.ps1` (Windows) | `install-baremetal.sh` |
| Runs on | any machine with Docker (4 GB RAM, 8 GB+ for `--production`) | Ubuntu 22.04 / 24.04, Debian 12 (4 GB RAM) |
| Installs | Docker Engine (Linux, optional `--install-docker`) | PostgreSQL, Redis, nginx, Python 3.12 (uv), Node.js 22, systemd services |
| Includes | PostgreSQL 16, Redis 7, MinIO object storage, API, real-time gateway, Celery worker + scheduler, nginx | the same, with files on the local disk instead of MinIO |
| Default address | `http://<server>:8080/` | `http://<server>/` |
| HTTPS (Let's Encrypt, auto-renewed) | `--domain` + `--email` | `--domain` + `--email` |

## Docker Compose

```bash
./install/install-docker.sh                         # Linux / macOS
./install/install-docker.sh --port 80               # serve on port 80
./install/install-docker.sh --production            # production sizing (replicas, bigger database settings)
sudo ./install/install-docker.sh --install-docker   # fresh Linux server without Docker
```

```powershell
powershell -ExecutionPolicy Bypass -File .\install\install-docker.ps1            # Windows
powershell -ExecutionPolicy Bypass -File .\install\install-docker.ps1 -Port 80
```

The database, Redis, MinIO and Flower passwords are generated on first start into the private
`infra_secrets` volume. The application keys and the setup code go into `app_config`. Nothing secret is
written to `.env`, which only holds optional infrastructure settings (port, sizing, HTTPS).

### HTTPS with Let's Encrypt (Docker)

```bash
./install/install-docker.sh --domain alumni.school.pk --email it@school.pk
./install/install-docker.sh --domain "alumni.school.pk,www.alumni.school.pk" --email it@school.pk   # several names
./install/install-docker.sh --domain alumni.school.pk --email it@school.pk --staging               # trial run
./install/install-docker.sh --no-https                                                              # turn it off
./install/install-docker.sh --shared-proxy --domain alumni.school.pk --email it@school.pk          # another SST app on this server
```

Before you run it:
1. Point the domain's DNS **A record** at the server's public IP.
2. Make sure ports **80 and 443** are open in the firewall and router, and that no other web server uses them.

The installer adds a Caddy container (`docker-compose.letsencrypt.yml`) in front of nginx. Caddy:
- gets the certificate from Let's Encrypt and renews it automatically;
- redirects `http://` to `https://`;
- adds HSTS;
- passes WebSockets (real-time chat and notifications) through.

Certificates are stored in the `caddy_data` volume. Watch the requests with `docker compose logs -f https`.

The installer saves `COMPOSE_FILE`, `DOMAIN` and `ACME_EMAIL` in `.env`, so plain `docker compose …` and `make …` commands keep HTTPS
(and `--production` sizing) on. With HTTPS on, nginx listens only on `127.0.0.1:8080` (for `make health`).

After the first HTTPS run, set **System Configuration → General → Application URL** to `https://<your-domain>`.
This address is used in email links and by the mobile app.

On Windows use `-Domain`, `-Email`, `-Staging`, `-NoHttps`, `-Production` and `-NoProduction`.
Requires Docker Compose 2.24 or newer.

**Own certificate** (e.g. the institution's wildcard certificate): use `docker-compose.https.yml` instead, see
[docs/DEPLOYMENT.md → HTTPS](../docs/DEPLOYMENT.md#https).

## Several SST applications on one server

SST Alumni Connect and the SST Platform website can share one server, each with its own domain.
Only one program can use ports 80/443, so both applications use **one shared HTTPS proxy**:

```
internet ──80/443──► sst-edge (Caddy, Let's Encrypt for every domain)
                       ├─ sstpsr.duckdns.org          ──► SST Platform nginx        (127.0.0.1:8000 on the host)
                       └─ sstpsr-connect.duckdns.org  ──► SST Alumni Connect nginx  (127.0.0.1:8080 on the host)
```

Clone both projects next to each other (e.g. `/opt/sst-platform` and `/opt/sst-alumni-connect`), then:

```bash
cd /opt/sst-platform
./install/install-docker.sh --shared-proxy --domain sstpsr.duckdns.org --email it@school.pk

cd /opt/sst-alumni-connect
./install/install-docker.sh --shared-proxy --domain sstpsr-connect.duckdns.org --email it@school.pk
```

Either order works. The first installer creates the shared proxy in `/opt/sst-edge`, and each installer adds its own
site file (`/opt/sst-edge/sites/<app>.caddy`) and reloads the proxy without interrupting the other site.
Re-running an installer (upgrade) keeps the setting. Choose another folder with `--shared-proxy-dir DIR` (use the same
folder for both applications).

| Port / name | Used by |
|---|---|
| 80, 443 (public) | shared proxy `sst-edge` only |
| 127.0.0.1:8000 | SST Platform nginx (local checks only) |
| 127.0.0.1:8080 | SST Alumni Connect nginx (local checks, `make health`) |
| Docker network `sst-edge` | proxy → `sst-platform-nginx`, `sst-alumni-nginx` |
| Compose projects | `sst` (Platform), `sst-alumni` (Alumni Connect), `sst-edge` (proxy): separate containers, volumes and databases |

Requirements and checks:
1. **DNS:** both names must point to the server's public IP. With DuckDNS, `sstpsr` and `sstpsr-connect` are separate
   subdomains, so set the IP for each one at duckdns.org (or keep the DuckDNS update cron updating both).
2. **Firewall / cloud security group:** open TCP 80 and 443 (and UDP 443 for HTTP/3). Ports 8000 and 8080 stay closed.
3. Don't use `--domain` without `--shared-proxy` on this server. That starts a second proxy, which can't get ports 80/443.
4. After the setup wizard, set **System Configuration → General → Application URL** to `https://sstpsr-connect.duckdns.org`
   (and the public address `https://sstpsr.duckdns.org` in the SST Platform administration).
5. Memory: both stacks together need about 6 GB of RAM (8 GB recommended). Leave out `--production` unless the server has 16 GB.

Shared proxy commands: `cd /opt/sst-edge && docker compose ps` · `docker compose logs -f caddy`.
Bare-metal installs can also share a server: give each installer its own `--domain`, and nginx serves both names.
Don't mix a Docker install and a bare-metal install on one server: both need ports 80/443.

## Bare metal

```bash
sudo ./install/install-baremetal.sh                                                   # http://<server-ip>/
sudo ./install/install-baremetal.sh --domain alumni.school.pk --email it@school.pk    # with HTTPS (certbot)
```

| Item | Location |
|---|---|
| Application | `/opt/sst-alumni/app` (services run as the `alumni` user) |
| Python 3.12 (managed by uv) | `/opt/sst-alumni/python`; virtual environment in `app/backend/.venv` |
| Uploaded files | `/opt/sst-alumni/data/storage` (`public/` served by nginx, `private/` only through the API) |
| Application keys, setup code | `/opt/sst-alumni/data/config` (**back this up**: it decrypts stored credentials) |
| Database / Redis connection | `/etc/sst-alumni/alumni.env` (database `alumni`, random passwords) |
| Portal / admin app files | `/opt/sst-alumni/www/app` |
| nginx site | `/etc/nginx/sites-available/sst-alumni.conf` |
| Database backups | `/opt/sst-alumni/backups` (taken automatically before each upgrade) |

| Service | Role |
|---|---|
| `sst-alumni-api` | REST API on 127.0.0.1:8100 (applies migrations and defaults at start) |
| `sst-alumni-realtime` | Socket.IO gateway on 127.0.0.1:8101 (chat, notifications, presence) |
| `sst-alumni-worker` | Celery worker (email, SMS, push notifications, exports) |
| `sst-alumni-beat` | Celery scheduler (reminders, weekly digest, clean-up), run exactly one |

```bash
systemctl status sst-alumni-api sst-alumni-realtime sst-alumni-worker sst-alumni-beat
journalctl -u sst-alumni-api -f
sudo cat /opt/sst-alumni/data/config/setup-code.txt
```

Options: `--port N`, `--prefix DIR`, `--workers N` (API processes), `--skip-packages`, `--skip-backup`.

Files are kept on the local disk. To use S3-compatible object storage instead, configure it in
**System Configuration → Storage**.

## Upgrading

Update the project folder to the new version, then run the same installer again.
- **Docker:**
  1. Backs up the database and files to `backups/<timestamp>` (`--skip-backup` skips this).
  2. Rebuilds the images and restarts the services.
  3. Migrations run automatically. Data volumes are kept.
- **Bare metal:**
  1. Backs up the database and application keys.
  2. Rebuilds the application.
  3. Applies migrations and restarts the services.

  During the rebuild, nginx shows a "back shortly" page.

## Mobile app

The Android/iOS app talks to `https://sstpsr-connect.duckdns.org`. That address is set at build time
(`extra.apiUrl` in the app's `app.json`), and the app has no server setting. For a different server, change it there
and build a new APK.
