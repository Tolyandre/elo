# Generalization and extension of arenas

Revises ADR-02. Arenas stop being two hard-coded special cases (the global
arena and per-game arenas) and become one entity type: named instances with
their own settings and a *match filter* deciding which matches belong to them.

## Problem

- Per-game arenas are not configurable, and an arena spanning several games
  (a series like "Кланк!") or a tournament's matches is impossible.
- Some games are played little: their arenas need neither leagues nor the
  elo/rating distinction, but both are hard-coded per arena type.
- Arena-like medal statistics (places 1–4, matches count) exist only for
  tournaments, computed at read time; arenas have no such stats.
- The two arena types live in two tables (`global_arena_settlement`,
  `game_arena_settlement`) with two code paths; every new arena type would
  add another one.

## Decision

### One arena entity

    arenas(id, name, match_filter_id → match_filters,
           settings JSONB, settings_schema_version INT,
           game_id NULL → games, tournament_id NULL → tournaments,
           recalc_from TIMESTAMPTZ NULL, stale_at TIMESTAMPTZ NULL)

**Arenas own their ids.** `arenas.id` is an independent keyspace: ids are
never derived from `games.id` or `tournaments.id`. Games and tournaments
created in the int-identifier era were migrated to UUIDs following the
`00000000-0000-0000-0000-0000000000NN` pattern (ADR-07); reusing those ids
would couple arena identity to migration history and conflate two entity
namespaces.

- The **global arena** is pinned by the well-known constant
  `a2ea0000-0000-0000-0000-000000000001` (`ArenaIDGlobal`). The value is
  deliberately outside the legacy migration pattern and outside random-UUID
  space, so it can never be mistaken for a migrated entity id. The row is
  created by schema migration in every environment; backend code pins the
  constant wherever the global arena is implied (`/players`, market
  settlements, corrections).
- **Auto-managed arenas** (one per game, one per tournament) get fresh UUIDs
  and are tied to their entity in two ways: the *match filter* (matching
  semantics) and the nullable **anchor columns** `game_id` / `tournament_id`
  (lifecycle: ON DELETE CASCADE; naming: arena name follows entity renames;
  lookup: "the game's arena" without parsing filters). User-created arenas
  have both anchors NULL.
- All membership lookups are scans over the (tiny) `arenas` table evaluating
  the filter, or anchor joins — no id-equality tricks.

### Match filter

A new reusable concept, stored in its own table so arenas, tournaments and
markets can share the shape:

    match_filters(id, date_from NULL, date_to NULL,
                  game_ids UUID[] NULL, tag_ids UUID[] NULL,
                  tournament_id NULL → tournaments)

A match meets the filter iff it satisfies **all** present conditions; NULL
means the condition is absent:

- date range: `date_from ≤ m.date ≤ date_to` (each bound optional);
- game list **or** game tag list, boolean OR: `m.game_id ∈ game_ids` OR the
  game carries one of `tag_ids`; both empty/NULL ⇒ any game;
- tournament relation: the match is attached to `tournament_id` via
  `match_tournament`.

Future extensions (filters by players or clubs) add columns here. The global
arena's filter has all conditions NULL and therefore allows all matches.

### Arena settings: a schema-versioned document

Settings are **not affected by dates** (unlike `elo_settings`, which is a
time series and affects only matches after its effective date): changing
arena settings affects *all* matches of the arena, hence a full arena
recalculation. Formula constants — K, D, `starting_elo`, `win_reward` —
remain date-based `elo_settings` read per match date for every arena.

Settings are stored as a JSONB document governed by an embedded, versioned
JSON Schema — the ADR-09 mechanics, third family after calculator data and
audit details (`arenas.settings_schema_version`, migrators applied at
startup by `MigrateDataRunner`, validation on every write; new leaf package
`pkg/arenasettings`). v1 shape:

```json
{
  "starting_rating": 900,
  "leagues": [
    {"kind": "newbie", "goal_gap": 500, "earned_min": 1, "earned_max": 64, "tau": 100},
    {"kind": "amateur"},
    {"kind": "elite", "matches_6m": 20, "matches_2m": 3}
  ]
}
```

- `leagues` lists the leagues that exist in the arena, in promotion order.
  The global arena keeps all three; per-game arenas keep newbie + amateur
  (current behavior); tournament arenas are seeded with `leagues: []` and
  `starting_rating = starting_elo`.
- The newbie league is what creates the elo/rating distinction (ADR-03): an
  arena without a newbie league has rating ≡ elo. `leagues: []` means no
  leagues at all: `league` is NULL on settlements and players form a single
  ranking list. Small-game arenas therefore need no special code.
- After validation, the domain parses the document into a typed struct; the
  schema is the contract, the struct the view. `x-entity-id` marking applies
  if a future version introduces id-bearing properties.

### One settlement table

`arena_settlements` replaces `global_arena_settlement` and
`game_arena_settlement` (same columns) plus `arena_id`; unique per
`(arena_id, match_id, player_id)` / `(arena_id, market_id, player_id,
discriminator)` / `(arena_id, correction_id, player_id)`. The discriminator
keeps its kinds (`match`, `market`, `market_guarantor`, `correction`);
markets and corrections continue to write **only to the global arena**.

`elo_settings` keeps its columns for API compatibility but the league
parameter columns are no longer read for calculations — the arena settings
document is the single source for league parameters.

### Precalculated player stats

    arena_player_stats(arena_id, player_id, matches_count,
                       first_count, second_count, third_count, fourth_count)

Places are `RANK()` per match over the arena's filtered matches (the
tournament stats query pattern). Recomputed at the end of every arena
recalculation, in the same transaction.

### Update pipeline

Everything that changes an arena's match set or settings marks the arena
stale: `stale_at = now()` plus `recalc_from` — the minimum date from which
settlements must be replayed, or NULL for a full recalc. Marks are coalesced
(`least` over pending dates; NULL wins as "full").

- **Match writes** (add/update): the global arena is replayed from the
  affected date inside the request transaction exactly as today (markets,
  corrections, bet limits, user-event validation — the existing
  `EventProcessor.RecalculateFrom` path, now persisting with
  `arena_id = ArenaIDGlobal`). Then the remaining affected arenas — those
  whose filter matches the match's new state, those that contained it before
  an update, and arenas of tournaments the match was auto-attached to — are
  drained **synchronously in the same transaction** with
  `recalc_from = min affected date`. A single match adds tiny overhead per
  arena; a date shift may replay several history rows per arena — accepted.
- **Other events** (game tag add/remove, arena create/update, tournament
  create): arenas are marked stale and drained by a background worker
  (`ScheduleNextUpdate`, pattern of `ScheduleNextExpiry`): a short debounce
  (~10 s) coalesces bursts of admin tag toggles, then each stale arena is
  recalculated in its own transaction, single-flight.
- The updater replays one arena: lock the arena row (`SELECT … FOR UPDATE`),
  delete its settlements from `recalc_from` (or all), replay the filtered
  matches in `(date, id)` order computing settlements, recompute stats,
  clear the stale mark. A mark landing after the read keeps the row stale —
  the state that became stale during recalculation is simply recalculated
  again (cancellation by staleness, no aborted work).
- Lifecycle: creating a tournament/game creates its arena in the same
  transaction (stale, filled by the worker); renaming syncs the arena name;
  deletion cascades.

### Seeding

The schema migration creates the global arena, one arena per existing game
and one per existing tournament, seeds settings from the latest
`elo_settings` row (behavior-preserving values), remaps existing settlement
rows (global rows keep their settlement ids; game rows are re-keyed to the
new per-game arena ids via the anchor join) and backfills stats for global
and per-game arenas. Tournament arenas start stale; the worker fills them
after deployment, or `POST /admin/update-arenas` does it on demand — the
manual "update all arenas to the actual state" invoked after deployments
(replaces `POST /admin/recalculate-global-elo`, keeping its exact-replay
diff report for the global arena).

### API

- `GET /arenas` — list; `?game_id=` returns arenas whose filter includes the
  game or its tags (the global arena included); `?tournament_id=` returns
  that tournament's arena.
- `POST /arenas`, `PATCH/DELETE /arenas/{id}` — editor-gated CRUD (settings
  validated against the schema). No admin UI in this iteration.
- `GET /arenas/{id}/players` — latest settlement state joined with
  precalculated stats (rating, league, rank, matches count, places 1–4).
- `GET /arenas/{id}/matches` — paginated, same envelope as `/matches` but
  with the arena's settlement data.
- `POST /admin/update-arenas` — full recalculation of every arena with a
  per-arena report (replayed counts + changed-player diff).
- `/players`, `/players/{id}/stats`, `/matches` keep their response shapes;
  they are served from the global arena. `GET /games/{id}` slims to basic
  info and `GET /games/{id}/matches` is removed — the game page becomes an
  arena list.

### UI

- New `/arenas` list page and `/arenas/view?id=` with tabs: Игроки (in the
  style of `/players`; a single table when the arena has no leagues),
  Партии (in the style of `/matches`), Медали (in the style of tournament
  stats), Лидеры по очкам (reusing the games page leaders tab).
- `/games/view` shows the arenas filtered by this game or its tags instead
  of the per-game rating/history/leaders tabs.
- `/tournaments/view` embeds the tournament's arena below its stats.
- `/players`, `/players/view`, `/matches` render unchanged — now fed by the
  global arena.
- `/debug` triggers `POST /admin/update-arenas` ("Обновить арены").

## Consequences

- New arena kinds (series over several games, date-ranged seasons, custom
  filters) are data, not code: CRUD API exists from day one.
- `/games/view` loses its own rating tab — the game's arena page replaces
  it; the tournament page gains an arena block.
- Game-arena data becomes eventually consistent for the moment between a
  match save and the synchronous drain completing — within one request, so
  clients never observe a stale game arena after the save returns.
- Migration `051` is one-way; `elo_settings` league columns become dead
  configuration kept only for the settings API shape.
- Rank hints (`matches_left_for_elite`, `wins_needed_for_amateur`) stay a
  global-arena concern (only the global arena has elite).

## Migration plan

`051_arenas.up.sql`: create the four tables; seed arenas; copy settlement
rows; backfill stats; drop the two old tables. The `pkg/arenasettings`
startup migration handles future settings-document upgrades; at v1 it is a
no-op. Tournament arenas left stale are filled by the worker after deploy or
manually via `/debug`.
