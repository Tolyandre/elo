# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Elo rating tracker for board games with a Go backend, Next.js frontend, and PostgreSQL database. The app tracks players across different games and clubs, calculating Elo ratings for match results. Google Sheets is used for legacy data access, and Google OAuth2 handles authentication.

**Monorepo Structure:**
- `elo-web-service/`: Go backend (REST API)
- `nextjs/`: Next.js frontend application
- `nix/`: NixOS module and deployment configuration

## Development Setup

This project uses Nix with direnv for reproducible development environments. After initial setup (`direnv allow`), all tools (Go, pnpm, Node.js, etc.) are automatically available.

Each application (backend and frontend) has its own directory and can be developed independently.

## Common Commands

### Frontend (Next.js)
```bash
pnpm --dir ./nextjs dev          # Run dev server on localhost:3000
pnpm --dir ./nextjs build        # Build for production
pnpm --dir ./nextjs lint         # Run linter
pnpm --dir ./nextjs test         # Run tests with vitest
```

### Backend (Go)
```bash
# Run with config file
cd elo-web-service
go run . --config-path ./config/config.dev.yaml

# Apply database migrations
cd elo-web-service
set -a && source .env && set +a && go run . --config-path ./config/config.dev.yaml --migrate-db

# Run tests
cd elo-web-service
go test ./...

# Generate type-safe DB code from SQL queries
cd elo-web-service
sqlc generate
```

### Database (PostgreSQL)
The backend expects a PostgreSQL database. Connection details are in `elo-web-service/config/config.dev.yaml` and can be overridden with environment variables (see `.env.sample`).

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
- **pkg/google-sheet/**: Google Sheets integration for legacy data access
- **pkg/configuration/**: Configuration parsing from YAML and environment variables
- **migrations/**: Database migrations (numbered, up/down pairs)

Database code is generated from SQL queries using sqlc. Edit `.sql` files in `pkg/db/query/`, then run `sqlc generate`.

### Frontend Structure (Next.js)
- **app/**: Next.js App Router pages and layouts
  - **page.tsx**: Home page with player rankings
  - **matches/**: Match history view
  - **game/**: Add new match with game-specific calculators (Skull King, St. Patrick)
  - **players/**: Player management
  - **games/**: Game list
  - **admin/**: User administration
  - **oauth2-callback/**: OAuth2 callback handler
- **app/*Context.tsx**: React Context providers for global state (settings, players, matches, games, auth)
- **app/api.ts**: Centralized API client with typed functions for all backend endpoints
- **components/**: Reusable React components (mostly shadcn/ui)

Frontend uses React Context for state management. Key contexts:
- `SettingsProvider`: Elo constants (K, D) and Google Sheet link
- `PlayersProvider`: Player data and rankings
- `MatchesProvider`: Match history
- `GamesProvider`: Available games
- `MeProvider`: Current authenticated user

### Database Schema
Key tables:
- **clubs**: Game clubs/groups
- **players**: Players with optional Google Sheet mapping
- **player_club_membership**: Many-to-many club membership
- **games**: Available board games
- **matches**: Match records with date and game
- **match_scores**: Player scores per match (many-to-many)
- **player_ratings**: Historical Elo ratings (time series)
- **users**: OAuth2 users with editing permissions

### Elo Calculation
The custom Elo algorithm (pkg/elo/elo.go:59) handles multi-player matches:
1. Normalizes scores relative to the lowest score
2. Calculates win expectation for each player against all others
3. Adjusts ratings using constants K (volatility) and D (scale factor)

## Configuration

Backend configuration is in `elo-web-service/config/config.dev.yaml` and can be overridden with environment variables prefixed with `ELO_WEB_SERVICE_`. Required secrets:
- `ELO_WEB_SERVICE_OAUTH2_CLIENT_ID`: Google OAuth2 client ID
- `ELO_WEB_SERVICE_OAUTH2_CLIENT_SECRET`: Google OAuth2 client secret
- `ELO_WEB_SERVICE_COOKIE_JWT_SECRET`: JWT secret for session cookies
- `ELO_WEB_SERVICE_POSTGRES_PASSWORD`: Database password
- Service account key file path for Google Sheets access

Frontend requires `NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL` in `nextjs/.env.local` to point to the backend API.

## VSCode/Cursor Integration

The `.vscode/launch.json` includes configurations for:
- "Launch Elo web service": Run backend with debugger
- "Run migrations": Apply database migrations
- "Next.js: debug full stack": Debug frontend
- "Run both": Launch backend and frontend together
