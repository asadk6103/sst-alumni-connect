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

The Android/iOS app talks to the same server. On its sign-in screen, tap **Server** and enter the address
printed by the installer. From phones on the same network, use the server's LAN IP rather than `localhost`.
