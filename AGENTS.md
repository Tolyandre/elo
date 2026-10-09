# Repository Guidelines

## Project Structure & Module Organization

Elo rating tracker for board games: a Go backend, a Next.js (Serwist PWA) frontend, PostgreSQL, OpenAPI-specified REST API, Google OAuth2 auth. This file is the single source of guidance for agents and contributors (CLAUDE.md points here).

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
- `adr/`: architecture decision records; `adr/README.md` indexes them. When a change contradicts an ADR, update the ADR in the same change.

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

- `make dev-up`: start Postgres and mock OAuth, run migrations. The dev DB is meant to be a prod copy (`make copy-prod-db-to-dev`) — there is no seed data.
- `make dev-migrate`: re-apply migrations against the dev DB.
- `make backend-run`: run the Go backend with Docker-oriented config.
- `make frontend-run`: run the Next.js dev server.
- `make dev-down`: stop local Docker Compose dependencies.
- `make generate-api`: regenerate Go and TypeScript API code after editing `openapi/`.
- `sqlc generate` (inside `elo-web-service/`): regenerate `pkg/db` after editing `pkg/db/query/*.sql`.
- `go test -C elo-web-service ./pkg/elo/ -run TestName`: run a single Go test.
- Backend without make (inside `elo-web-service/`): `go run . --config-path ./config/config.dev.yaml`; migrations against an explicit DSN: `go run . --migrate-db-dsn=postgres://... --migrate-db`.
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
- Generated files (`elo-web-service/pkg/api/generated.go`, `pkg/db/*.sql.go` + `models.go` + `querier.go`) are excluded from the agent workspace sync (`.zcodeignore`) to keep context small — `cat`/`grep` them through the shell when a task needs their exact contents. `nextjs/app/api-types.gen.ts` stays synced (it is the frontend's type reference).
- Make recipes run under POSIX-mode `/bin/sh`, where `.` does **not** fall back to the current directory: source env files with a slash (`. ./.env.docker`), never `. .env.docker`.
- The frontend is a Serwist PWA. A browser that has visited the app before serves its cached precache and RSC-prefetch caches even against `next dev`, so fresh frontend changes look like they never applied. When that happens, unregister the service worker and clear caches (DevTools → Application, or `navigator.serviceWorker.getRegistrations()` → `unregister()` plus `caches.keys()` → `delete`) and reload.

## Coding Style & Naming Conventions

Format Go code with `gofmt`; keep packages lowercase and tests named `*_test.go`. TypeScript/React code uses ESLint, functional components, and kebab-case route folders under `nextjs/app/`. Prefer patterns from `nextjs/components/` and shared UI primitives in `nextjs/components/ui/`. Update generated files such as `nextjs/app/api-types.gen.ts` via generation commands, not by hand.

**Frontend UI recipe (enforced by ESLint — see `nextjs/eslint.config.mjs`):** use shadcn/ui primitives from `nextjs/components/ui/` (`Button`, `Card`, `Dialog`, `Label`, …) instead of raw HTML elements. Every page follows the same skeleton, so pages differ in content, not style:

- **Container:** wrap page content in `<PageContainer width=...>` (`components/page-container.tsx`) — `narrow` (default: lists/details), `form` (create/edit forms), `wide` (stat tables, formula, debug), `full` (dense admin CRUD tables). The root shell already supplies the outer inset (`app/layout.tsx`) — never add `p-4` or hand-rolled `max-w-*`/`mx-auto` on a page.
- **Title:** every page sets declarative `<PageHeader title icon? action?>` (renders into the site header via `app/pageHeaderContext.tsx`). A navigable page without one is a bug (exceptions: fullscreen tools like chess-clock). Create/edit actions go in the header, not above the list.
- **Fetch triad:** any fetched content renders `ErrorAlert` + `<LoadingRows count={N}/>` + `<EmptyState icon title action?/>` — never «Загрузка...» paragraphs, never a missing empty state.
- **Sections/tables:** section headings use `<SectionHeader>`; tabular data uses `<ResponsiveTable mobile desktop>` (card list on phones, real table from `sm`). Mobile-first: no horizontal scroll on small screens; prefer `flex-col sm:flex-row`, `grid-cols-1 sm:grid-cols-2`.
- **Forms:** hand-rolled `useState` + `Label`/`Input` (`components/ui/input.tsx`) + toast; raw `<input>/<select>/<textarea>` are ESLint-banned outside `components/ui|vendor`. react-hook-form remains only in the existing calculator components — don't add new ones.
- **Colors:** semantic tokens only (`text-destructive`, `text-success`, `text-warning`, `text-info`, `text-muted-foreground`, `chart-1..10`). Raw palette classes (`text-red-600`, `bg-emerald-500`, …) are ESLint-banned outside `components/ui|vendor`. New colors are OKLCH CSS variables in `app/globals.css` (light + `.dark`), never one-off classes. SVG illustration art (`rank-icon`, `iaww-icons`) keeps its own palette.
- **Language & registration:** UI language is Russian, including aria-labels; every new route is added to `nextjs/lib/offline/routes.ts` (the precache check fails otherwise).
- **Reference:** `nextjs/app/styleguide/page.tsx` renders every primitive and token — copy patterns from there and extend it when adding primitives.

**Identifiers (ADR-12):** entity ids are `id.ID` (canonical UUID) in Go and a branded `Base58ID` in TypeScript; the Base58 wire conversion is structural — never hand-encode/decode ids in business code. In Go, take/return `id.ID` (DB and DTO fields are typed); parse raw path/query params with `api.parseIDParam`. In TypeScript, ids from URLs or untyped JSON go through `toBase58ID`; plain strings do not typecheck as ids. Adding an id field means referencing `#/Base58ID` in the spec and regenerating (`make generate-api`) — the openapilint test catches omissions.

## Architecture Notes

**Backend (Go).** `main.go` wires the Gin router (CORS, auth middleware, explicit route registrations), the DB pool, and the services. `pkg/api/` holds the HTTP handlers; `pkg/api/generated.go` and `pkg/db/*.sql.go` are generated — do not edit. `pkg/elo/` is the domain core: the Elo math (`CalculateNewElo` normalizes multi-player scores relative to the lowest, computes win expectations, adjusts ratings via K and D) plus the feature services (arenas, markets, tournaments, game tables). Go codegen is two steps, both automatic via `make generate-go-api` → `go generate ./pkg/api/`: (1) `tools/bundle-openapi` resolves cross-file `$ref`s into `openapi/bundled.json` (gitignored intermediate — never edit), preserving the short alias type names; (2) `oapi-codegen` writes `pkg/api/generated.go` (types, Gin server interface, strict handlers).

**Schema migrations are up-only**: `elo-web-service/migrations/NNN_description.up.sql`, embedded via `embed_migrations.go`. No down files — to roll back, write a new forward migration.

**OpenAPI contract.** `openapi/openapi.yaml` is the entry point with `$ref`s into per-domain files: `common`, `admin`, `arenas`, `audit`, `auth`, `clubs`, `games`, `markets`, `matches`, `players`, `settings`, `tables`, `tags`, `tournaments`, `users` (all `.yaml`). SSE endpoints are intentionally not in the spec — `nextjs/hooks/useTableSSE.ts` uses manual fetch.

**Frontend state.** Pages are client components; global state lives in React contexts: `SettingsProvider` (Elo K/D), `PlayersProvider`, `MatchesProvider`, `GamesProvider`, `MeProvider` (identity; caches in localStorage so `canEdit` gating works offline), `OfflineProvider` (`app/offline/OfflineContext.tsx` — pending offline writes + auto-sync). `app/api.ts` is the central `openapi-fetch` client; `app/api-types.gen.ts` is generated from the spec.

**Offline mode (PWA).** Offline-created matches/players/games live in localStorage (`offline-pending-v1`; types in `nextjs/lib/offline/types.ts`). Temp ids are `"offline:<uuid>"`, sent as `idempotency_key` on sync so retries never create duplicates. The sync engine (`nextjs/lib/offline/sync.ts`, pure/DI, vitest-covered) pushes games → players → matches in creation order, rewriting temp ids to server ids; HTTP errors mark the item `error` (user-editable), network errors abort the run, 401 sets `authRequired`. Pages and calculators submit matches via `useOffline().submitMatch(...)` — never `addMatchPromise` directly: it queues offline when there is no network OR the request fails at the network level. `OfflineContext` probes `/ping` with exponential backoff (30s→15min, reset on focus/online/navigation/new pending); `apiReachable === false` shows the crossed-cloud indicator (`components/sync-status.tsx`) and recovery auto-triggers a resync. Service worker: Serwist (`app/sw.ts`), precaching each page's HTML **and** RSC `.txt` payload; API GETs are NetworkFirst (`elo-api` cache); `/ping`, `/auth/*`, SSE, and all writes are NetworkOnly. **When adding a page, add its route to `nextjs/lib/offline/routes.ts`** — `scripts/check-precache.mjs` (runs after `pnpm build`) fails otherwise. Production builds use webpack (`next build --webpack`) because `@serwist/next` hooks webpack; `next dev` stays on Turbopack with the SW disabled. basePath comes from `NEXT_PUBLIC_BASE_PATH` (`/elo` on GitHub Pages).

**Database.** Key tables: `clubs`, `players`, `player_club_membership`, `games`, `matches`, `match_scores` (per-player scores), `player_ratings` (Elo time series), `users` (OAuth2 users with edit permissions), plus the arena/market/tournament tables introduced by later ADRs.

## Adding a game kind (checklist)

Backend (all document/versioned mechanics come from the shared registries — see ADR-09/16):

1. `elo-web-service/pkg/elo/game_ids.go`: well-known game UUID + `Games` map entry (title).
2. `elo-web-service/pkg/elo/table_game_<kind>.go`: a `tableGame` implementation — typed state struct + `normalize`/`applySubmit`/`playerIDs` — and a `tableGames` entry in `table_service.go`. The game owns its submit shape (decoded with `decodeSubmit`, which rejects unknown fields); no shared input union to extend.
3. `elo-web-service/pkg/calculator/<kind>.go` + `<kind>.v1.json`: register the calculator kind (`reg.Register` in init) for history-mode match editing. Mark id properties `"x-entity-id": true`; never key a player by object key.
4. `openapi/tables.yaml`: submit request-body union + game-state schema variants, then `make generate-api` (openapilint must pass).

Frontend:

5. `components/calculators/<kind>/`: `scoring.ts(x)` (pure scoring + types), `storage.ts` (`STORAGE_VERSION`, `toStorage`/`fromStorage`, `player_id` key convention), `merge.ts` (three-way merge on the shared `threeWay`), and the table/edit UI.
6. `components/calculators/registry.ts`: `CalculatorAdapter` entry (editTitle, scoreFromState, toStorage, History).
7. `components/tables/<kind>/game-view.tsx` + `components/tables/registry.tsx`: live view implementing `TableGameViewProps`, plus the `TABLE_GAMES` entry.
8. `lib/game-apps.ts`: `GAME_ID_<KIND>` constant and the `GAME_APPS` entry — including `createInitialState`, `statusText`, and `mergeStates` (a game without `mergeStates` fails loudly at conflict time, by design).
9. `app/matches/edit/<kind>-history.tsx`: saved-match history editor (pattern: `skull-king-history.tsx`).
10. Tests mirroring `skull-king.test.ts`, `skull-king-merge.test.ts`, `calculator-registry.test.ts`, `calculator-storage.test.ts`; table fixtures live in `__tests__/test-utils.ts`.

## Testing Guidelines

Add Vitest tests under `nextjs/__tests__/` using descriptive names like `offline-sync.test.ts`. Backend integration tests live in `elo-web-service/integration_test/` and require Docker, Podman, or Colima. When changing OpenAPI contracts, run generation plus relevant tests. For migrations, verify with `make dev-migrate` or `make dev-up`.

## Commit & Pull Request Guidelines

Recent commits follow concise Conventional Commit-style subjects, for example `feat(clubs): club icons` and `fix(pwa): update / reload`. Keep subjects imperative and scoped when useful. Pull requests should include a behavior summary, test commands run, linked issues, and screenshots for visible frontend changes. Mention migrations, OpenAPI regeneration, or Nix changes explicitly.

## Security & Configuration Tips

Do not commit secrets. Use `.env.sample`, `.env.docker`, and local untracked env files as references. Document OAuth credentials, database passwords, and required manual setup in the PR.

Backend config is `elo-web-service/config/config.dev.yaml`, overridable with `ELO_WEB_SERVICE_`-prefixed env vars. Required secrets: `ELO_WEB_SERVICE_OAUTH2_CLIENT_ID`, `ELO_WEB_SERVICE_OAUTH2_CLIENT_SECRET`, `ELO_WEB_SERVICE_COOKIE_JWT_SECRET`, `ELO_WEB_SERVICE_POSTGRES_PASSWORD`. Frontend needs `NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL` (and `NEXT_PUBLIC_BASE_PATH` for static-export deploys) in `nextjs/.env.local`.
