# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Elo rating tracker for board games with a Go backend, Next.js frontend, and PostgreSQL database. The app tracks players across different games, calculating Elo ratings for match results. Google OAuth2 handles authentication.

**Monorepo Structure:**
- `elo-web-service/`: Go backend (REST API)
- `nextjs/`: Next.js frontend application
- `nix/`: NixOS module and deployment configuration

## Development Setup

This project uses Nix with direnv for reproducible development environments. After initial setup (`direnv allow`), all tools (Go, pnpm, Node.js, etc.) are automatically available.

Each application (backend and frontend) has its own directory and can be developed independently.

## Common Commands

### Full dev stack (Makefile + Docker Compose)
The `Makefile` orchestrates a local stack (postgres on host port **5433**, `mock-oauth2`, migrations, seed). Containers run via Docker or Podman.
```bash
make dev-up          # Start postgres + mock-oauth2, run migrations, seed data
make dev-seed        # Re-apply idempotent seed data (elo-web-service/testdata/seed.sql)
make dev-migrate     # Re-apply migrations against the dev DB
make backend-run     # Run backend with -tags opencv, loads secrets from .env.docker
make frontend-run    # Run the Next.js dev server
make dev-down        # Stop all dev dependencies
```

### Frontend (Next.js)
```bash
pnpm --dir ./nextjs dev          # Run dev server on localhost:3000
pnpm --dir ./nextjs build        # Build for production
pnpm --dir ./nextjs test         # Run tests with vitest
pnpm --dir ./nextjs lint         # Lint with next lint
```

### Backend (Go)
```bash
# Run with config file
cd elo-web-service
go run . --config-path ./config/config.dev.yaml

# Run with OpenCV-backed Skull King card recognition (see Card Recognition below)
go run -tags opencv . --config-path ./config/config.dev.yaml

# Apply database migrations (config-based)
set -a && source .env && set +a && go run . --config-path ./config/config.dev.yaml --migrate-db
# ...or against an explicit DSN, no config required (used by the Makefile)
go run . --migrate-db-dsn=postgres://elo:devpassword@localhost:5433/elo?sslmode=disable

# Run tests
go test ./...

# Run a single test
go test ./pkg/elo/ -run TestCalculateNewElo

# Integration tests (testcontainers; needs a Docker/Podman socket)
make integration-test-podman    # or: make integration-test-colima

# Generate type-safe DB code from SQL queries
sqlc generate
```

### Database (PostgreSQL)
The backend expects a PostgreSQL database. Connection details are in `elo-web-service/config/config.dev.yaml` and can be overridden with environment variables (see `.env.sample`).

**Migrations are up-only.** Do not create down migration files. To roll back, write a new forward migration.

### Nix Dependencies (gomod2nix)

The Nix build uses `gomod2nix` instead of a vendor directory. After adding or updating Go dependencies (`go get`, `go mod tidy`), regenerate the lockfile:

```bash
cd elo-web-service
gomod2nix generate
```

Commit the updated `gomod2nix.toml` alongside `go.mod` and `go.sum`. **Do not commit a `vendor/` directory** — it is not needed and conflicts with the gomod2nix approach.

### NixOS Module Testing
```bash
# Check syntax
cd nix
nix-instantiate --strict test-syntax.nix

# Run integration test in VM
nix-build test-integration.nix
```

## Architecture

### Backend Structure (Go)
- **main.go**: Entry point, sets up Gin router with CORS, initializes database pool and services
- **pkg/api/**: HTTP handlers for REST endpoints (matches, players, games, users, OAuth2)
- **pkg/db/**: Database layer with sqlc-generated type-safe queries
  - `pkg/db/query/*.sql`: SQL queries for sqlc
  - `pkg/db/*.sql.go`: Generated Go code (do not edit manually)
- **pkg/elo/**: Core Elo rating calculation logic
- **pkg/cardrecognition/skull-king/**: OpenCV-based recognition of Skull King cards from images (card location, corner/special/number matching against `templates/`)
- **pkg/configuration/**: Configuration parsing from YAML and environment variables
- **elo-web-service/migrations/**: Database migrations, embedded via `embed_migrations.go`. **Up-only** — files are named `NNN_description.up.sql` (no down files).

Database code is generated from SQL queries using sqlc. Edit `.sql` files in `pkg/db/query/`, then run `sqlc generate`.

### Card Recognition (OpenCV build tag)
The card-recognition feature depends on OpenCV and is gated behind the `opencv` build tag. `pkg/api/recognizer_opencv.go` (`//go:build opencv`) wires the real recognizer; `pkg/api/recognizer_noop.go` (`//go:build !opencv`) is a stub used by default. Build/run with `-tags opencv` to enable it (the Makefile's `backend-run` does this).

### Frontend Structure (Next.js)
- **app/**: Next.js App Router pages and layouts
  - **page.tsx**: Home page with player rankings
  - **add-match/**, **match/**, **matches/**: Add a match and view match history
  - **game/**, **games/**: Game detail and game list
  - **calculators/**, **skull-king-game/**, **its-a-wonderful-world/**: Game-specific score calculators
  - **player/**, **players/**: Player detail and management
  - **market/**, **markets/**: Market features
  - **admin/**: User administration
  - **settings/**, **help/**: Settings and help pages
  - **oauth2-callback/**: OAuth2 callback handler
- **app/*Context.tsx**: React Context providers for global state (settings, players, matches, games, auth)
- **app/api.ts**: Centralized API client built on `openapi-fetch` — type-safe HTTP calls generated from the OpenAPI contract
- **app/api-types.gen.ts**: Auto-generated TypeScript types from `openapi/openapi.yaml` — do not edit manually
- **components/**: Reusable React components (mostly shadcn/ui)

### Frontend Conventions
- **Use shadcn/ui components** for UI elements: `Button`, `Badge`, `Card`/`CardHeader`/`CardTitle`/`CardContent`, `Label`, `Slider`, `Dialog`, etc. (available in `nextjs/components/ui/`). Prefer these over raw HTML elements like `<button>` or `<label>`.
- **Mobile-first responsive design**: All pages must work on small screens without horizontal scrollbars. For wide tables, use `hidden sm:block` for the desktop table and `sm:hidden` for a mobile card/list layout. Use `flex-col sm:flex-row` and `grid-cols-1 sm:grid-cols-2` patterns.

Frontend uses React Context for state management. Key contexts:
- `SettingsProvider`: Elo constants (K, D)
- `PlayersProvider`: Player data and rankings
- `MatchesProvider`: Match history
- `GamesProvider`: Available games
- `MeProvider`: Current authenticated user (caches identity in localStorage so `canEdit` gating works offline)
- `OfflineProvider` (`app/offline/OfflineContext.tsx`): pending offline-created matches/players/games + auto-sync

### Offline Mode (PWA)
The app works offline for previously authenticated users with edit rights:
- **Pending store**: offline-created matches/players/games live in localStorage (`offline-pending-v1`), types in `nextjs/lib/offline/types.ts`. Temp ids are `"offline:<uuid>"`; the uuid is sent as `idempotency_key` on sync so retries never create duplicates.
- **Sync engine** (`nextjs/lib/offline/sync.ts`, pure/DI, vitest-covered): on reconnect pushes games → players → matches in creation order, rewriting temp ids to server ids. HTTP errors mark the item `error` (user can edit/delete it); network errors abort the run; 401 sets `authRequired`.
- **Match submission**: pages and calculators call `useOffline().submitMatch(...)` instead of `addMatchPromise` directly — it queues offline when there is no network OR when the request fails at the network level (API server down but network up).
- **API reachability**: `OfflineContext` probes `/ping` (`pingApiPromise`, raw fetch with an 8s timeout) with exponential backoff (30s→15min, reset on focus/online/navigation/new pending). `apiReachable === false` (network up, server off) shows the crossed-cloud indicator (`components/sync-status.tsx`) and, when the server returns, auto-triggers a resync (also resyncs on window focus/visibility). There is no separate ping banner anymore.
- **Backend support**: `POST /matches` accepts optional `date` (≤30 days in the past, Elo replayed from that date via `RecalculateFrom`) and `idempotency_key`; `POST /players` and `POST /games` accept `idempotency_key` (unique nullable column, `ON CONFLICT DO UPDATE ... RETURNING *`).
- **Service worker**: Serwist (`@serwist/next`), source `nextjs/app/sw.ts`, generated `public/sw.js` (gitignored). Precaches **both** each page's HTML and its RSC `.txt` payload (client-side `<Link>` navigation fetches `<route>.txt`, so without it unvisited pages don't open offline). API GETs use NetworkFirst (`elo-api` cache); `/ping`, `/auth/*`, SSE and all writes are NetworkOnly (never cached). **When adding a page, add its route to `nextjs/lib/offline/routes.ts`** — `scripts/check-precache.mjs` (runs after `pnpm build`) fails if a `PAGES` route is missing from the export and warns about exported routes not in `PAGES`. Production build uses webpack (`next build --webpack`) because `@serwist/next` hooks into webpack; `next dev` stays on Turbopack with the SW disabled. New-deploy detection: precache `revision` = `GITHUB_SHA`, with `skipWaiting`/`clientsClaim`/`cleanupOutdatedCaches`.
- **basePath**: set via `NEXT_PUBLIC_BASE_PATH` (`/elo` on GitHub Pages, configured in `.github/workflows/nextjs.yml`).

### Database Schema
Key tables:
- **clubs**: Game clubs/groups
- **players**: Players
- **player_club_membership**: Many-to-many club membership
- **games**: Available board games
- **matches**: Match records with date and game
- **match_scores**: Player scores per match (many-to-many)
- **player_ratings**: Historical Elo ratings (time series)
- **users**: OAuth2 users with editing permissions

### Elo Calculation
The custom Elo algorithm (`CalculateNewElo` in pkg/elo/elo.go) handles multi-player matches:
1. Normalizes scores relative to the lowest score
2. Calculates win expectation for each player against all others
3. Adjusts ratings using constants K (volatility) and D (scale factor)

### API Contract (OpenAPI)

The contract lives in `openapi/` as domain-specific files:
- `openapi/openapi.yaml` — entry point with `$ref` to all domain files
- `openapi/common.yaml`, `players.yaml`, `games.yaml`, `matches.yaml`, `clubs.yaml`, `settings.yaml`, `users.yaml`, `markets.yaml`, `auth.yaml`, `admin.yaml`, `voice.yaml`, `skull-king.yaml`, `analytics.yaml`

`openapi/bundled.json` is a generated intermediate artifact (gitignored); do not edit it manually.

To regenerate clients after editing the spec:

```bash
# Regenerate TypeScript types (frontend)
pnpm --dir ./nextjs run generate:api

# Regenerate Go server interfaces (backend)
cd elo-web-service && go generate ./pkg/api/
# or from the repo root:
make generate-go-api
```

**Go codegen is a two-step process** (both steps run automatically via `go generate ./pkg/api/`):
1. `tools/bundle-openapi` — resolves all cross-file `$ref` into a single `openapi/bundled.json` using kin-openapi's `InternalizeRefs`. A custom resolver preserves the short alias names from `openapi.yaml` (e.g. `Club`, not `clubs_Club`).
2. `oapi-codegen` — reads `bundled.json` and writes `pkg/api/generated.go` with Go types, Gin server interface, and strict handler scaffolding.

After `generate:api`, `nextjs/app/api-types.gen.ts` is updated. The frontend uses the `client` export from `app/api.ts` (an `openapi-fetch` instance) for type-safe HTTP calls. SSE endpoints are not in the spec and use manual fetch in `hooks/useSkullKingSSE.ts`.

## Configuration

Backend configuration is in `elo-web-service/config/config.dev.yaml` and can be overridden with environment variables prefixed with `ELO_WEB_SERVICE_`. Required secrets:
- `ELO_WEB_SERVICE_OAUTH2_CLIENT_ID`: Google OAuth2 client ID
- `ELO_WEB_SERVICE_OAUTH2_CLIENT_SECRET`: Google OAuth2 client secret
- `ELO_WEB_SERVICE_COOKIE_JWT_SECRET`: JWT secret for session cookies
- `ELO_WEB_SERVICE_POSTGRES_PASSWORD`: Database password

Frontend requires `NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL` in `nextjs/.env.local` to point to the backend API.

## VSCode/Cursor Integration

The `.vscode/launch.json` includes configurations for:
- "Launch Elo web service": Run backend with debugger
- "Run migrations": Apply database migrations
- "Next.js: debug full stack": Debug frontend
- "Run both": Launch backend and frontend together
