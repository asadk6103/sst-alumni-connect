# SST Alumni Connect — common operations (wrappers around docker compose and the scripts).
SHELL := /bin/bash
COMPOSE := docker compose
PROD_COMPOSE := docker compose -f docker-compose.yml -f docker-compose.prod.yml

.PHONY: help install up up-prod down ps logs errors health migrate bootstrap setup-code backup restore upgrade \
        scale dev loadtest

help:            ## List targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

install:         ## First installation (builds, starts, prints the setup code)
	./infrastructure/scripts/install.sh

up:              ## Start / update the stack
	$(COMPOSE) up -d --build

up-prod:         ## Start with production sizing (replicas, pools)
	$(PROD_COMPOSE) up -d --build

down:            ## Stop (data volumes are kept)
	$(COMPOSE) down

ps:              ## Service status
	$(COMPOSE) ps

logs:            ## Follow logs (make logs s="api celery-worker")
	./infrastructure/scripts/logs.sh $(s)

errors:          ## Recent warnings and errors
	./infrastructure/scripts/logs.sh --errors

health:          ## Health checks through nginx
	./infrastructure/scripts/health.sh

migrate:         ## Apply database migrations (also automatic on API start)
	$(COMPOSE) exec api alembic upgrade head

bootstrap:       ## Synchronise roles, permissions and defaults (also automatic)
	$(COMPOSE) exec api python -m app.bootstrap

setup-code:      ## Show the first-run setup code
	$(COMPOSE) exec api python -m app.cli setup-code

backup:          ## Back up database + files to ./backups
	./infrastructure/scripts/backup.sh

restore:         ## Restore: make restore b=backups/<timestamp>
	./infrastructure/scripts/restore.sh $(b)

upgrade:         ## Backup, rebuild, restart, health check
	./infrastructure/scripts/upgrade.sh

scale:           ## Scale stateless services: make scale api=3 realtime=3
	$(COMPOSE) up -d --no-recreate --scale api=$(or $(api),1) --scale realtime=$(or $(realtime),1)

dev:             ## Development stack with hot reload + Mailpit
	$(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml --profile dev up --build


loadtest:        ## p95 load test: make loadtest email=... password=... [VUS=200 P95_MS=200]
	VUS=$(or $(VUS),200) P95_MS=$(or $(P95_MS),200) ./infrastructure/scripts/loadtest.sh "$(email)" "$(password)"
