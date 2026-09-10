# Repository Guidelines

## Project Structure & Module Organization

This repository contains a Go backend, Next.js frontend, OpenAPI specs, and deployment tooling.

- `elo-web-service/`: Go service, migrations, generated API code, config, and integration tests in `integration_test/`.
  - `pkg/id/`: the identifier types — `ID` (canonical UUID, used inside Go and Postgres) and `Base58ID` (wire form). Their JSON hooks convert every typed field automatically; see ADR-12.
  - `pkg/calculator/`: registry of game calculators (Skull King, IAWW). Each kind has an embedded JSON Schema, a `schema_version`, and a set of Go migrators for upgrading older stored documents. `MigrateData` and the startup step `pkg/db.MigrateCalculatorData` keep stored `matches.calculator_data` at the current version. Id-bearing properties are marked `"x-entity-id": true` in the schema so `CanonicalizeIDs`/`ShortenIDs` convert them at the boundary. See ADR-09, ADR-12.
  - `pkg/db/`: sqlc-generated queries + `migrations.go` (schema migrations) and `migrate_data.go` (in-process data migrations run on startup).
  - `internal/openapilint/`: a Go test that enforces the id conventions on `openapi/*.yaml` (id-named fields must `$ref` the shared `Base58ID` schema, etc.) — runs as part of `go test ./...`.
- `nextjs/`: Next.js app using the App Router. UI components live in `components/`, routes in `app/`, and Vitest tests in `__tests__/`.
  - `lib/id.ts`: the branded `Base58ID` type plus `newId`/`encodeId`/`toBase58ID` — the only places that mint or accept ids from untyped strings.
  - `components/calculators/<kind>/`: reusable calculator UI for both the live calculator pages and the saved-match calculator editor (the `/matches/edit` route dispatches to it when the match has `calculator_kind`). Each kind ships `scoring.tsx` (pure scoring + types), `storage.ts` (normalized stored shape + `toStorage`/`fromStorage`), and presentational components. Storage shape convention: every player reference lives under a `player_id` key (never as an object key) and the backend schema marks it `x-entity-id`, so ids convert at the boundary. See ADR-09, ADR-12.
- `openapi/`: source API specifications. Update these before regenerating API clients/server bindings. Every id-bearing property MUST reference the shared `Base58ID` schema (`openapi/common.yaml`) — the openapilint test fails the build otherwise. Path/query params with id values stay plain `type: string` (parsed via `id.ParseTolerant` in handlers).
- `nix/`, `flake.nix`, `flake.lock`: Nix development and deployment definitions.
- `mock-oauth2/`: minimal OAuth2/OIDC mock for local dev (started by `make dev-up`). Its login page lists every user from the dev database (`DB_DSN`) and lets you log in as any of them or as a new display name (sub derived from the name; the backend creates the user on first login) — handy for debugging multi-user flows or after `make copy-prod-db-to-dev`.
- `adr/`: architecture decision records.

## Build, Test, and Development Commands

### Entering the dev environment (read first)

The project's reproducible toolchain comes from the Nix flake devShell, defined in `flake.nix` (`devShells.<system>.default`). `direnv allow` loads it in an interactive shell, but **agents have no direnv hook** — enter it explicitly by wrapping every project command:

```bash
# Run any project command wrapped like this:
nix develop .# --command bash -lc '<command>'
# Example:
nix develop .# --command bash -lc 'make integration-test-podman'
```

**Use the dev shell in every mode, including plan mode.** Plan mode restricts mutations of the repo and system — it does not forbid entering the dev shell. `nix develop` only materializes the pinned toolchain into the Nix store (a per-user cache); it modifies nothing in the repository or system configuration, so running it in plan mode is fine even when it needs to download or build packages first. Never dodge it in favor of an ambient `python3`/`go`/etc. to avoid a Nix download — read-only work (running tests, linters, python analysis) must still go through the wrapper so results come from the pinned toolchain.

What's where:

- **Provided by the devShell** (absent or version-different on ambient PATH): the pinned `go`, `sqlc`, `gomod2nix`, and `gopls`. `make` is also reachable inside the devShell (pulled in transitively, not declared in `buildInputs`).
- **From the ambient system PATH, not the flake**: `nix`, `podman`, `docker`, `node`, `pnpm`. They work but versions are whatever the host NixOS profile provides; the flake does not pin them. `make generate-ts-api` (which calls `pnpm`) and frontend lint/test therefore depend on the host having `node`/`pnpm`.
- **Not a standalone binary**: `oapi-codegen` runs via `go generate` (`make generate-go-api` → `go generate ./pkg/api/...`), so it's built on demand from `go.mod` — no binary needs to be on PATH.

The service is pure Go (`CGO_ENABLED=0` everywhere, including the Nix build) — no C toolchain is required.

Container runtimes for the integration tests: `DOCKER_HOST`/`CONTAINER_HOST` are unset in the ambient environment, but the Makefile targets set `DOCKER_HOST=unix:///run/user/1000/podman/podman.sock` explicitly. That user-scoped podman socket must exist and be reachable; `podman ps` is the quick reachability check.

- `make dev-up`: start Postgres and mock OAuth, run migrations, and seed local data.
- `make backend-run`: run the Go backend with Docker-oriented config.
- `make frontend-run`: run the Next.js dev server.
- `make dev-down`: stop local Docker Compose dependencies.
- `make generate-api`: regenerate Go and TypeScript API code after editing `openapi/`.
- `gomod2nix generate` (run inside `elo-web-service/`): regenerate `gomod2nix.toml` after **any** change to `go.mod` (adding/upgrading a dependency via `go get`). Nix builds the Go service with `-mod=vendor` from `gomod2nix.toml`, so an out-of-date manifest breaks `nix build` / `nix flake check` even though `go build ./...` works. Always commit `go.mod`, `go.sum`, and `gomod2nix.toml` together.
- `pnpm --dir ./nextjs lint`: lint frontend code.
- `pnpm --dir ./nextjs test`: run frontend Vitest tests.
- `go test -C elo-web-service ./...`: run regular Go tests.
- `make integration-test-podman` or `make integration-test-colima`: run backend integration tests. These spin up Postgres via testcontainers; see "Entering the dev environment" above for the `DOCKER_HOST`/socket details and the `nix develop` wrapping.
- `nix flake check`: evaluate Nix outputs and integration checks.

## Coding Style & Naming Conventions

Format Go code with `gofmt`; keep packages lowercase and tests named `*_test.go`. TypeScript/React code uses ESLint, functional components, and kebab-case route folders under `nextjs/app/`. Prefer patterns from `nextjs/components/` and shared UI primitives in `nextjs/components/ui/`. Update generated files such as `nextjs/app/api-types.gen.ts` via generation commands, not by hand.

**Identifiers (ADR-12):** entity ids are `id.ID` (canonical UUID) in Go and a branded `Base58ID` in TypeScript; the Base58 wire conversion is structural — never hand-encode/decode ids in business code. In Go, take/return `id.ID` (DB and DTO fields are typed); parse raw path/query params with `api.parseIDParam`. In TypeScript, ids from URLs or untyped JSON go through `toBase58ID`; plain strings do not typecheck as ids. Adding an id field means referencing `#/Base58ID` in the spec and regenerating (`make generate-api`) — the openapilint test catches omissions.

## Testing Guidelines

Add Vitest tests under `nextjs/__tests__/` using descriptive names like `offline-sync.test.ts`. Backend integration tests live in `elo-web-service/integration_test/` and require Docker, Podman, or Colima. When changing OpenAPI contracts, run generation plus relevant tests. For migrations, verify with `make dev-migrate` or `make dev-up`.

## Commit & Pull Request Guidelines

Recent commits follow concise Conventional Commit-style subjects, for example `feat(clubs): club icons` and `fix(pwa): update / reload`. Keep subjects imperative and scoped when useful. Pull requests should include a behavior summary, test commands run, linked issues, and screenshots for visible frontend changes. Mention migrations, OpenAPI regeneration, or Nix changes explicitly.

## Security & Configuration Tips

Do not commit secrets. Use `.env.sample`, `.env.docker`, and local untracked env files as references. Document OAuth credentials, database passwords, and required manual setup in the PR.
