# Repository Guidelines

## Project Structure & Module Organization

This repository contains a Go backend, Next.js frontend, OpenAPI specs, and deployment tooling.

- `elo-web-service/`: Go service, migrations, generated API code, config, and integration tests in `integration_test/`.
- `nextjs/`: Next.js app using the App Router. UI components live in `components/`, routes in `app/`, and Vitest tests in `__tests__/`.
- `openapi/`: source API specifications. Update these before regenerating API clients/server bindings.
- `nix/`, `flake.nix`, `flake.lock`: Nix development and deployment definitions.
- `recognition/`: Python/OpenCV card recognition tools and datasets.
- `adr/`: architecture decision records.

## Build, Test, and Development Commands

Use `direnv allow` from the repo root to enter the Nix dev shell.

- `make dev-up`: start Postgres and mock OAuth, run migrations, and seed local data.
- `make backend-run`: run the Go backend with Docker-oriented config.
- `make frontend-run`: run the Next.js dev server.
- `make dev-down`: stop local Docker Compose dependencies.
- `make generate-api`: regenerate Go and TypeScript API code after editing `openapi/`.
- `pnpm --dir ./nextjs lint`: lint frontend code.
- `pnpm --dir ./nextjs test`: run frontend Vitest tests.
- `go test -C elo-web-service ./...`: run regular Go tests.
- `make integration-test-podman` or `make integration-test-colima`: run backend integration tests.
- `nix flake check`: evaluate Nix outputs and integration checks.

## Coding Style & Naming Conventions

Format Go code with `gofmt`; keep packages lowercase and tests named `*_test.go`. TypeScript/React code uses ESLint, functional components, and kebab-case route folders under `nextjs/app/`. Prefer patterns from `nextjs/components/` and shared UI primitives in `nextjs/components/ui/`. Update generated files such as `nextjs/app/api-types.gen.ts` via generation commands, not by hand.

## Testing Guidelines

Add Vitest tests under `nextjs/__tests__/` using descriptive names like `offline-sync.test.ts`. Backend integration tests live in `elo-web-service/integration_test/` and require Docker, Podman, or Colima. When changing OpenAPI contracts, run generation plus relevant tests. For migrations, verify with `make dev-migrate` or `make dev-up`.

## Commit & Pull Request Guidelines

Recent commits follow concise Conventional Commit-style subjects, for example `feat(clubs): club icons` and `fix(pwa): update / reload`. Keep subjects imperative and scoped when useful. Pull requests should include a behavior summary, test commands run, linked issues, and screenshots for visible frontend changes. Mention migrations, OpenAPI regeneration, or Nix changes explicitly.

## Security & Configuration Tips

Do not commit secrets. Use `.env.sample`, `.env.docker`, and local untracked env files as references. Document OAuth credentials, database passwords, and required manual setup in the PR.
