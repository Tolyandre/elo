# ADR-24 implementation: agent session notes

Read this before touching arenas code. It compresses the investigations of
the implementation sessions (commits be0fd31 → 21951f0) so a fresh agent does
not have to re-derive them. Pair it with `adr/24-arena-rework.md` (decisions)
and `AGENTS.md` (repo tooling).

## Prompt for a fresh agent

> You are continuing the ADR-24 arena feature in this repo. Read
> `adr/24-arena-rework.md` for decisions and `adr/24-arena-rework-notes.md`
> for the implementation map, testing setup and known traps. Enter devenv for
> every command. Verify with: `go test -C elo-web-service ./...`,
> `make integration-test-podman`, and in `nextjs`: `pnpm exec tsc --noEmit`,
> `pnpm exec eslint .`, `pnpm test`, `pnpm build` (build runs the
> check-precache guard). Do not reintroduce the patterns listed in "Traps".

## Implementation map

Backend (`elo-web-service/`):

- `migrations/051_arenas.up.sql` — `match_filters`, `arenas` (anchors
  `game_id`/`tournament_id`, dirty queue `stale_at`/`recalc_from`),
  unified `arena_settlements` (replaces the two old settlement tables),
  `arena_player_stats`. Seeds: global arena `a2ea0000-0000-0000-0000-000000000001`
  (name `Главная`, leagues newbie+amateur+elite), per-game arenas
  (newbie+amateur, starting rating 900), per-tournament arenas (no leagues).
  **Edited in place while unreleased** — already-migrated dev/stage DBs need
  manual `UPDATE`s (renames of `Главная` and the dropped `Арена: ` prefix).
- `pkg/arenasettings/` — third schema-versioned JSON document family
  (after calculator ADR-09 and audit ADR-14): embedded `arena-settings.v1.json`,
  200-only validation on write, migrator wired into
  `pkg/db/migrate_data.go::runDataMigrations`. The settings document is the
  single source for league parameters; the `elo_settings` league columns are
  dead configuration kept only for API shape.
- `pkg/elo/arena.go` — `Arena`/`MatchFilter`/`ArenaPlayer` types,
  `IArenaService` (CRUD, players with `GetArenaPlayersAt` point-in-time
  standings, matches, marks, drains, worker `ScheduleNextUpdate`),
  `GlobalArenaID` constant. All full-row sqlc arena queries share one column
  list — converters delegate to `arenaFromParts`.
- `pkg/elo/arena_calc.go` — arena-generic league progression
  (`determineArenaLeague`, `initialArenaLeague`, `effectiveArenaLeague`,
  `determineCorrectionLeague`), `arenaLeaguePriority` (elite first —
  priority INVERTS the promotion-order settings list), `buildArenaResults`,
  `lockAndGetPrevArenaState`, `storeArenaMatchSettlements` (players written in
  sorted id order for replay stability).
- `pkg/elo/arena_update.go` — `updateArenaWithinTx` (FOR UPDATE on the arena
  row → delete settlements ≥ recalc_from → replay filtered matches → recompute
  stats → conditional stale clear = staleness cancellation), `diffArenaState`,
  `PlayerStateChange`, debounce/poll constants.
- `pkg/elo/matches.go` — `MatchService` owns `Arenas *ArenaService`;
  `lockAndGetPrevElos` is the global-arena wrapper; AddMatch/UpdateMatch end
  with `ListArenasMatchingMatch` + `MarkAndDrainAfterMatchWrite` (synchronous
  drain in the same tx; it also recomputes global `arena_player_stats`).
  `EventProcessor.RecalculateFrom` is the global-arena-only engine (markets,
  corrections, bet limits).
- Well-known ids: `GlobalArenaID = a2ea0000-0000-0000-0000-000000000001`
  (Go: `pkg/elo/arena.go`; SQL literals: `matches.sql`, `players.sql`,
  `player_ranks.sql`, `corrections.sql`, `markets.sql`, `testdata/seed.sql`,
  migration 051 — keep in sync). Per-game/per-tournament arena ids are fresh
  UUIDs; their identity lives in `match_filters` + anchor columns.
- Markets/corrections/bet limits write **only to the global arena**
  (`elo.GlobalArenaID`); other arenas replay matches only.
- Background worker: `go apiHandler.ArenaService.ScheduleNextUpdate(ctx)` in
  `main.go`; match writes drain synchronously instead.

API (`openapi/arenas.yaml` + `pkg/api/server_arenas.go`):
`GET/POST /arenas` (`?kind=games|tournaments`, `?game_id=`, `?tournament_id=`),
`GET/PATCH/DELETE /arenas/{id}` (writes editor-gated; auto-managed arenas
reject PATCH/DELETE with 409), `GET /arenas/{id}/players` (rank_history:
day_ago/week_ago, same snapshot offsets as the old /players: −12h,
−7d+12h), `GET /arenas/{id}/matches?player_id&club_id&game_id&next&limit`
(filters travel inside the base64-JSON cursor token),
`POST /admin/update-arenas` (replaces recalculate-global-elo).

Frontend (`nextjs/`):

- `app/arenas/page.tsx` — По играм / Турниры tabs (kind param), game filter.
- `app/arenas/view/page.tsx` — id-less → global arena (`GLOBAL_ARENA_ID` from
  `lib/id.ts`, computed via `encodeId`); missing arena → self-heal via the
  unconditional-arena list lookup, else friendly not-found state;
  URL query mirrored through `window.history.replaceState` (NOT
  `router.replace` — see Traps); tab in local state.
- `components/arena-players-table.tsx` — league sections reversed
  (elite→amateur→newbie), club icons, `computeDisplayRanks` for the club
  filter, `LeagueFooter` promotion descriptions from arena settings.
- `components/rank-change-indicator.tsx` — old-/players-style plain arrows +
  pale gray rating diff in reserved-width slots.
- `app/arenas/view/use-arena-matches.ts` — `mergeTimelineItems` (matches +
  corrections for the global arena), `appendUnique` dedupe, `allMatches`
  separate from paginated `matches` (leaders tab pulls all pages there).
- `app/arenas/view/arena-matches-tab.tsx` — filter card (game input hidden
  when the arena pins one game), MatchWithMarkets, CorrectionCard (global
  only), RunningTables + PendingMatchCard (global only).
- `app/error.tsx` — the ONLY error boundary; without it a production render
  exception leaves a dead painted page (no dev overlay).
- Deleted pages: `/players`, `/matches` (list pages only — `/players/view`,
  `/matches/new|edit|view` stay; `PlayersContext`/`MatchesContext` stay as
  infrastructure for comboboxes/offline sync).
- `app/sw.ts` — `elo-api-v2` runtime cache, `CacheableResponsePlugin
  ({statuses:[200]})`; `lib/offline/routes.ts` must list every exported page
  (`check-precache` fails the nix build otherwise; `/debug` deliberately
  uncovered → benign warning).

## Traps (each one cost a debugging session)

1. **Static export: same-route query-only navigation is a silent no-op.**
   `router.replace('/arenas/view?tab=x')` from `/arenas/view` and a
   `<Link href="/arenas/view">` (query removed) do nothing on stage, while
   cross-route navigation works and dev (SSR) works. Never drive UI from
   `useSearchParams` after a same-route replace — keep local state and mirror
   the URL with `window.history.replaceState`. Fixed in
   `app/arenas/view/page.tsx` + `components/navigation-bar.tsx` (Главная link
   falls back to `window.location.assign` when already on `/arenas/view`).
1b. **`usePathname()` excludes the deployment basePath.** Any hand-built URL
   (`history.replaceState`, `router.push`) must prepend
   `process.env.NEXT_PUBLIC_BASE_PATH` or stage strips `/elo-stage` from the
   address bar and a refresh 404s. Next `<Link>` prepends it automatically —
   only hand-built URLs are affected.
2. **SW runtime cache cached error responses.** `elo-api` NetworkFirst had no
   status filter: a 404 from before a DB migration was served as fallback for
   up to 7 days ("stale id" symptom). Now 200-only + cache renamed
   `elo-api-v2`. If you ever add runtime rules, add a status filter.
3. **Perl bulk edits eat `${…}`.** A `perl -e 's/.../href={...${game.id}...}/'`
   interpolation replaced `${game.id}` with an empty string (Perl variable
   interpolation) — committed a broken `?id=` href. Never bulk-edit
   template-literal or Go code containing `$` with perl one-liners; use the
   Edit tool.
4. **`createTestGame`/raw-DB seeds bypass arena hooks.** Integration tests
   needing a game arena must create the game via `newGameService(pool).AddGame`
   (the helper wires `ArenaService`). Test helpers: `newMatchService`,
   `newArenaService`, … at the end of `integration_test/testhelpers_test.go`.
5. **Global arena stats.** `MarkAndDrainAfterMatchWrite` recomputes
   `arena_player_stats` for the global arena on every match write — the
   global arena is deliberately skipped by the drain (its settlements are
   transactional), so stats would go stale without this.
6. **sqlc nullability through LATERAL/LEFT JOIN.** sqlc infers the column
   type (NOT NULL) even when the join yields NULL — use the
   `CASE WHEN x IS NULL THEN NULL ELSE x END AS y` trick (see
   `ListArenaPlayersAt`) and the `float64Or` helper.
7. **League params live in the arena settings document** (date-independent,
   full-arena recalc on change); `elo_settings` keeps K/D/starting_elo/
   win_reward per date. `useSettings()` on the frontend feeds only formula
   hints.
8. **Editing an applied migration is safe here** (golang-migrate checks the
   version, not a checksum) but already-migrated DBs keep the old values —
   ship a manual UPDATE note with such edits.

## Testing setup (stage replica on localhost)

- Backend: containers `postgres` + `mock-oauth2` (`make dev-up`), then run the
  backend so it serves the dev DB (it must allow the frontend origin:
  `ELO_WEB_SERVICE_FRONTEND_URI=http://<port>`; check with
  `curl -H "Origin: …" -D -` for `access-control-allow-origin`).
- Frontend static export: `pnpm build` (runs check-precache), then
  `npx serve out -l 3000`. `.env.local` bakes
  `NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL=http://localhost:8080/`.
- Reproduce with a real browser (Browser Use skill): load
  `/arenas/view?id=…&tab=…`, `reload()`, click tabs, click Главная; read SW
  state via
  `evaluate: navigator.serviceWorker.getRegistrations()/caches.keys()`
  (`controlled: true` only after a reload post-registration) and capture
  console errors with listeners injected via evaluate.
- Known local gap: the SW did not auto-register on a fresh `serve` profile —
  `navigator.serviceWorker.register('/sw.js')` manually; its activation
  triggers the `SwUpdateReloader` page reload (an in-flight evaluate will
  time out — that is the reload, not a hang).
- Leftover from the last session: `npx serve out` instances on ports 3000 and
  3311 (`pkill -f "serve out"` to stop).

## Open items / candidate follow-ups

- **Stage crash root cause**: the reported dead-page-after-reload was
  diagnosed as the missing error boundary + poisoned runtime cache (both
  fixed). If a dead page reappears, `app/error.tsx` now shows the real error
  message — get that text before investigating.
- **Market settlements on custom arenas** (open design question): settle
  path writes only to the global arena; making a market move a custom arena's
  rating needs per-arena settlement rules (market scope ∩ arena filter),
  per-arena pre-balance reads and replay integration. The display layer is
  already arena-scoped.
- `elo_settings` league columns (`newbie_*`, `elite_*`,
  `starting_rating_*`) are dead; dropping them means touching the settings
  API schema and `/settings` page.
- `pkg/elo/matches.go` is still the biggest file; the tournament-merge
  helpers (`mergeWithActiveTournaments`, `applyMatchTournaments`) could move
  next to tournaments.go.
- `nextjs/components/score-leaders-stats.ts` has unit tests
  (`__tests__/score-leaders-components.test.ts`); `mergeTimelineItems`
  (`app/arenas/view/use-arena-matches.ts`) and `computeDisplayRanks`
  (`components/arena-players-table.tsx`) are pure and untested — cheap wins.
- The `/admin/games` → `/games/view?id=` links and the auth redirect
  (`/arenas/view`) were the last link-structure changes; if new pages appear,
  update `lib/offline/routes.ts`, `public/sitemap.xml` and
  `components/navigation-bar.tsx` together.
- Same-route query-only navigation is broken in static export generally: any
  new page that needs it must copy the `use-arena-matches`/state+history
  pattern, never `router.replace`.
