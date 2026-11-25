# SST Alumni Connect

**Reconnect. Network. Mentor. Give Back.** — the alumni platform of SST Public School Rashidabad.

| Part | Folder | Technology |
|---|---|---|
| REST API, background tasks, real-time gateway | `backend/` | Python 3.12, FastAPI, SQLAlchemy 2, Alembic, Celery, python-socketio |
| Portal, administration, sign-in, setup wizard | `frontend/app/` | React 18, TypeScript, Vite, Tailwind, shadcn-style components (Radix), Lucide |
| Deployment | `docker-compose*.yml`, `docker/`, `infrastructure/` | Docker Compose, nginx, PostgreSQL 16, Redis 7, MinIO |

Development status and stage plan: [DEVELOPMENT_PROGRESS.md](DEVELOPMENT_PROGRESS.md).

## Install (Docker Compose)

```bash
cp .env.example .env              # optional — every value has a safe default
docker compose up -d --build      # or: ./infrastructure/scripts/install.sh
docker compose logs api           # copy the one-time setup code
```

Open **http://localhost:8080/setup** and complete the 10-step setup wizard (institution, branding, first
administrator, email, storage, security). No passwords are kept in files: database, Redis and object-storage
passwords and the application keys are generated on first start. Everything else is configured in
**Administration → System Configuration**.

| Task | Command |
|---|---|
| Status / logs | `docker compose ps` · `docker compose logs -f` · `make errors` |
| Migrations / defaults (automatic on start) | `docker compose exec api alembic upgrade head` · `docker compose exec api python -m app.bootstrap` |
| Health | `make health` |
| Backup / restore | `make backup` · `make restore b=backups/<timestamp>` |
| Upgrade (backup → rebuild → restart) | `make upgrade` |
| Scale | `docker compose up -d --scale api=3 --scale realtime=3` |
| Production sizing | `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` |
| p95 load test | `make loadtest email=<admin> password=<password> VUS=200 P95_MS=200` |
| Stop (data kept) | `docker compose down` |

Documentation:
- [Deployment guide](docs/DEPLOYMENT.md) (incl. HTTPS) · [Production checklist](docs/PRODUCTION_CHECKLIST.md) · [Backup & restore](docs/BACKUP_RESTORE.md)
- [Architecture](docs/ARCHITECTURE.md) · [Database ERD](docs/ERD.md) · [API reference](docs/API.md) (interactive at `/api/docs`)
- [Administrator handbook](docs/ADMIN_HANDBOOK.md) · [Member guide](docs/USER_HANDBOOK.md) · [Testing report](docs/TESTING_REPORT.md)

## Local development without Docker

```bash
cd backend && uv sync && uv run alembic upgrade head && uv run python -m app.bootstrap
uv run uvicorn app.main:app --port 8100 --reload      # API (needs PostgreSQL + Redis, see backend/.env)
uv run pytest -q                                      # tests (TEST_DATABASE_URL)
cd frontend/app && npm ci && npm run dev              # portal/admin on http://localhost:5173
```
