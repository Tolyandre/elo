.PHONY: dev-up dev-down dev-seed dev-migrate dev-logs backend-run frontend-run integration-test copy-prod-db-to-test copy-prod-db-to-stage copy-prod-db-to-dev generate-api generate-go-api generate-ts-api

## Regenerate Go server code from openapi/openapi.yaml
generate-go-api:
	go generate -C elo-web-service ./pkg/api/...

## Regenerate TypeScript types from openapi/openapi.yaml
generate-ts-api:
	pnpm --dir ./nextjs run generate:api

## Regenerate all API code from openapi/ (run after editing the spec)
generate-api: generate-go-api generate-ts-api

## Start all dev dependencies (postgres, mock-oauth2, migrations, seed)
dev-up:
	docker compose up -d --wait postgres mock-oauth2
	cd elo-web-service && CGO_ENABLED=0 go run . --migrate-db-dsn=postgres://elo:devpassword@localhost:5433/elo?sslmode=disable
	docker compose run --rm seed

## Stop all dev dependencies
dev-down:
	docker compose down -v

## Re-apply seed data (idempotent — safe to run multiple times)
dev-seed:
	docker compose run --rm seed

## Re-apply migrations (same code path as production)
dev-migrate:
	cd elo-web-service && CGO_ENABLED=0 go run . --migrate-db-dsn=postgres://elo:devpassword@localhost:5433/elo?sslmode=disable

## Run the backend (loads secrets from .env.docker)
backend-run:
	cd elo-web-service && set -a && . .env.docker && set +a && \
	  go run . --config-path ./config/config.docker.yaml

## Run the frontend dev server
frontend-run:
	pnpm --dir ./nextjs dev

## Copy production DB (elo-web-service) to test DB (elo-web-service-test), preserving test DB privileges
copy-prod-db-to-test:
	set -a && . elo-web-service/.env && set +a && \
	  sudo -u postgres psql -f scripts/copy-prod-db-to-test.sql \
	    -v db_password="$$ELO_WEB_SERVICE_POSTGRES_PASSWORD"
	@echo ">>> Done. elo-web-service-test is now a copy of elo-web-service."

## Copy production DB (elo-web-service) to stage DB (elo-web-service-stage).
## Run on the server after the stage NixOS module created the role + database
## (stage uses Unix-socket peer auth, so no password is needed).
copy-prod-db-to-stage:
	sudo -u postgres psql -f scripts/copy-prod-db-to-stage.sql
	@echo ">>> Done. elo-web-service-stage is now a copy of elo-web-service."

## Copy the production DB into the local docker compose postgres. Prod runs on
## this machine (see copy-prod-db-to-test/stage — local postgres peer auth via
## sudo), so no SSH is involved. Wipes the local elo database first (seed data
## is not re-applied), restores the dump with objects owned by the local elo
## role, then re-applies migrations so the schema matches the local code.
## Override if the prod database is named differently:
##   make copy-prod-db-to-dev PROD_DB=elo-web-service
PROD_DB ?= elo-web-service
PROD_DUMP_CMD ?= sudo -u postgres pg_dump

copy-prod-db-to-dev:
	docker compose up -d --wait postgres
	docker compose exec -T postgres psql -U elo -d postgres -v ON_ERROR_STOP=1 \
	  -c "DROP DATABASE IF EXISTS elo WITH (FORCE)" -c "CREATE DATABASE elo OWNER elo"
	$(PROD_DUMP_CMD) --no-owner --no-privileges $(PROD_DB) | \
	  docker compose exec -T postgres psql -U elo -d elo -v ON_ERROR_STOP=1 -q
	$(MAKE) dev-migrate
	@echo ">>> Done. Local compose postgres now holds a copy of $(PROD_DB)."

## Run integration tests (requires colima or Docker with socket at ~/.colima/default/docker.sock)
integration-test-colima:
	DOCKER_HOST="unix://$$HOME/.colima/default/docker.sock" \
	TESTCONTAINERS_RYUK_DISABLED=true \
	CGO_ENABLED=0 \
	go test -C elo-web-service -tags integration ./integration_test/ -v

integration-test-podman:
	DOCKER_HOST=unix:///run/user/1000/podman/podman.sock \
	TESTCONTAINERS_RYUK_DISABLED=true \
	CGO_ENABLED=0 \
	go test -C elo-web-service -tags integration ./integration_test/ -v
