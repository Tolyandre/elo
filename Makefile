.PHONY: dev-up dev-down dev-seed dev-migrate dev-logs backend-run frontend-run integration-test

## Start all dev dependencies (postgres, dex, migrations, seed)
# dev-up:
# 	docker compose up -d --wait postgres dex
# 	cd elo-web-service && go run . --migrate-db-dsn=postgres://elo:devpassword@localhost:5433/elo?sslmode=disable
# 	docker compose run --rm seed
dev-up:
	docker compose up -d postgres dex && podman wait --condition=healthy postgres
	cd elo-web-service && go run . --migrate-db-dsn=postgres://elo:devpassword@localhost:5433/elo?sslmode=disable
	docker compose run --rm seed

## Stop all dev dependencies
dev-down:
	docker compose down

## Re-apply seed data (idempotent — safe to run multiple times)
dev-seed:
	docker compose run --rm seed

## Re-apply migrations (same code path as production)
dev-migrate:
	cd elo-web-service && go run . --migrate-db-dsn=postgres://elo:devpassword@localhost:5433/elo?sslmode=disable

## Run the backend (loads secrets from .env.docker)
backend-run:
	cd elo-web-service && set -a && . .env.docker && set +a && \
	  go run . --config-path ./config/config.docker.yaml

## Run the frontend dev server
frontend-run:
	pnpm --dir ./nextjs dev

## Run integration tests (requires colima or Docker with socket at ~/.colima/default/docker.sock)
integration-test:
	DOCKER_HOST="unix://$$HOME/.colima/default/docker.sock" \
	TESTCONTAINERS_RYUK_DISABLED=true \
	go test -C elo-web-service -tags integration ./integration_test/ -v
