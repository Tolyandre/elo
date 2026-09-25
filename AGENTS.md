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
- `nix/`, `flake.nix`, `flake.lock`: Nix packaging and deployment definitions (backend, frontend, NixOS modules, VM integration test). The dev environment lives in `devenv.nix`/`devenv.yaml`/`devenv.lock` instead.
- `mock-oauth2/`: minimal OAuth2/OIDC mock for local dev (started by `make dev-up`). Its login page lists every user from the dev database (`DB_DSN`) and lets you log in as any of them or as a new display name (sub derived from the name; the backend creates the user on first login) — handy for debugging multi-user flows or after `make copy-prod-db-to-dev`.
- `adr/`: architecture decision records.

## Build, Test, and Development Commands

### Entering the dev environment (read first)

The project's reproducible toolchain comes from [devenv](https://devenv.sh), defined in `devenv.nix` + `devenv.yaml` with versions pinned in `devenv.lock` (`flake.nix` is for packaging/deployment only, not the dev shell). There is no auto-activation hook for agents — enter the environment explicitly by wrapping every project command:

```bash
# Run any project command wrapped like this (the repo-root `dev` script quiets
# devenv's setup output):
./dev shell -- bash -lc '<command>'
# Example:
./dev shell -- bash -lc 'make integration-test-podman'
# Run the unit suite + gofmt gate (the make target self-wraps into devenv,
# but wrap it like any other command — ambient `make` is not guaranteed):
./dev shell -- bash -lc 'make test'
# DEVENV_VERBOSE=1 ./dev ... restores devenv's full progress output.
# A bare `devenv shell -- ...` works too — nothing re-runs per command.
```

**Use the devenv shell in every mode, including plan mode.** Plan mode restricts mutations of the repo and system — it does not forbid entering the devenv shell. `devenv shell` only materializes the pinned toolchain into the Nix store (a per-user cache); it modifies nothing in the repository or system configuration, so running it in plan mode is fine even when it needs to download or build packages first. Never dodge the wrapper in favor of an ambient tool to avoid a Nix download — read-only work (running tests, linters, python analysis) must still go through it so results come from the pinned toolchain. `python3` is part of the pinned shell: plain-stdlib python analysis is expected and runs fine under the wrapper (there is no system-wide python on this host — a bare `python3` outside the shell just fails with command-not-found; that is a cue to use the wrapper, not to abandon python). Run it from the repo root — devenv does not search parent directories for `devenv.nix`.

What's where:

- **Provided by devenv** (absent or version-different on ambient PATH): the pinned `go`, `sqlc`, `python3`, `gomod2nix`, and `gopls`. `make` is also reachable inside the shell (pulled in transitively, not declared in `packages`). The shell exports `CGO_ENABLED=0` (the service is pure Go) and recreates the `.nix-tools/delve` + `.nix-tools/gopls` repo-root symlinks used by `.vscode/settings.json`.
- **Anything else** — `jq`, `ffmpeg`, python libraries beyond the stdlib, a different `node`, ...: pull it ad hoc from nixpkgs — `./dev -O packages:pkgs` (lands inside the pinned shell) or plain `nix shell` (standalone). See "Ad-hoc tools" below.
- **From the ambient system PATH, not devenv**: `nix`, `podman`, `docker`, `node`, `pnpm`. They work but versions are whatever the host NixOS profile provides; `devenv.yaml` does not pin them. `make generate-ts-api` (which calls `pnpm`) and frontend lint/test therefore depend on the host having `node`/`pnpm` — if it does not, pull them ad hoc: `nix shell nixpkgs#nodejs nixpkgs#pnpm -c pnpm --dir ./nextjs lint`.
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
- `make test`: the backend unit suite (includes the openapilint test) plus a gofmt gate, run inside the devenv shell via `./dev` — the one place formatting is enforced, so run it before finishing a change instead of interleaving `gofmt` mid-edit. It deliberately bypasses devenv's test runner: `devenv test` runs the `devenv:enterTest` tasks, which per upstream semantics validate the environment (and re-run on every shell entry), so they stay a cheap self-check in `devenv.nix`.
- `make integration-test-podman` or `make integration-test-colima`: run backend integration tests. These spin up Postgres via testcontainers; see "Entering the dev environment" above for the `DOCKER_HOST`/socket details and the `devenv shell` wrapping.
- `make integration-test-one T=TestName`: run a single integration test (much faster than the full suite while iterating).
- `pnpm --dir ./nextjs exec tsc --noEmit`: type-check the frontend. Lint and Vitest do **not** type-check, but the Nix frontend build (`next build`) does — run this before finishing any TypeScript change.
- `nix flake check`: evaluate Nix outputs and integration checks.

### Ad-hoc tools: anything not in the pinned shell

No tool needs a global install. Anything missing from the devenv shell — a `jq`, an `ffmpeg`, a newer `node` — is fetched ad hoc from nixpkgs; the first use downloads into the per-user Nix store cache (fine in plan mode, same as the devenv shell).

The devenv way — `-O packages:pkgs` **appends to this repo's pinned shell**, so the new tool lands right next to `go`, `sqlc`, and `make`. The `./dev` wrapper passes `-O` through with its usual quieting. Use this whenever the work touches the repo (the usual case):

```bash
./dev -O packages:pkgs "jq ncdu" shell -- bash -lc 'jq --version && ncdu --version'
# Find the nixpkgs attribute name:
devenv search <name>
```

The nix-shell way — a standalone environment containing just that tool: no repo evaluation, no tasks, works from any directory. Prefer it for one-offs outside repo context, and it is the only way to hand python its libraries (a `-O packages:pkgs "python312Packages.requests"` would put a library on PATH, which does nothing):

```bash
nix shell nixpkgs#jq -c jq --version
```

Python: the pinned shell `python3` covers stdlib scripts (run it under `./dev shell`). For third-party libraries, bake them into an ad-hoc interpreter or make a throwaway venv — both verified working:

```bash
# Interpreter with the libraries included, one-off:
nix shell --impure --expr '(import <nixpkgs> {}).python3.withPackages (ps: with ps; [ requests ])' -c python3 script.py
# Or a venv; pip works on the Nix python inside the devenv shell:
./dev shell -- bash -lc 'python3 -m venv /tmp/venv && /tmp/venv/bin/pip install pyyaml && /tmp/venv/bin/python ...'
```

Keep one-off tools out of `devenv.nix` — pinning them there is a deliberate decision for the whole team, made only when a tool is routinely needed.

### Gotchas

- The Go module lives in `elo-web-service/`, so from the repo root `go build ./...` fails with "directory prefix . does not contain main module" — always pass `-C elo-web-service` (or `cd` first).
- Make recipes run under POSIX-mode `/bin/sh`, where `.` does **not** fall back to the current directory: source env files with a slash (`. ./.env.docker`), never `. .env.docker`.
- The frontend is a Serwist PWA. A browser that has visited the app before serves its cached precache and RSC-prefetch caches even against `next dev`, so fresh frontend changes look like they never applied. When that happens, unregister the service worker and clear caches (DevTools → Application, or `navigator.serviceWorker.getRegistrations()` → `unregister()` plus `caches.keys()` → `delete`) and reload.

## Coding Style & Naming Conventions

Format Go code with `gofmt`; keep packages lowercase and tests named `*_test.go`. TypeScript/React code uses ESLint, functional components, and kebab-case route folders under `nextjs/app/`. Prefer patterns from `nextjs/components/` and shared UI primitives in `nextjs/components/ui/`. Update generated files such as `nextjs/app/api-types.gen.ts` via generation commands, not by hand.

**Identifiers (ADR-12):** entity ids are `id.ID` (canonical UUID) in Go and a branded `Base58ID` in TypeScript; the Base58 wire conversion is structural — never hand-encode/decode ids in business code. In Go, take/return `id.ID` (DB and DTO fields are typed); parse raw path/query params with `api.parseIDParam`. In TypeScript, ids from URLs or untyped JSON go through `toBase58ID`; plain strings do not typecheck as ids. Adding an id field means referencing `#/Base58ID` in the spec and regenerating (`make generate-api`) — the openapilint test catches omissions.

## Testing Guidelines

Add Vitest tests under `nextjs/__tests__/` using descriptive names like `offline-sync.test.ts`. Backend integration tests live in `elo-web-service/integration_test/` and require Docker, Podman, or Colima. When changing OpenAPI contracts, run generation plus relevant tests. For migrations, verify with `make dev-migrate` or `make dev-up`.

## Commit & Pull Request Guidelines

Recent commits follow concise Conventional Commit-style subjects, for example `feat(clubs): club icons` and `fix(pwa): update / reload`. Keep subjects imperative and scoped when useful. Pull requests should include a behavior summary, test commands run, linked issues, and screenshots for visible frontend changes. Mention migrations, OpenAPI regeneration, or Nix changes explicitly.

## Security & Configuration Tips

Do not commit secrets. Use `.env.sample`, `.env.docker`, and local untracked env files as references. Document OAuth credentials, database passwords, and required manual setup in the PR.
