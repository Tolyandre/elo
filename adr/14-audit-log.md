# Audit log of user actions: append-only table, versioned details documents

## Problem

The service records *what* the data is but not *who changed it*: matches,
games, players, and clubs have no authorship columns anywhere (only
`markets.created_by` predates this). Two product needs:

1. on the match view page, show who added the match and who edited it, with
   the edit diff (date, players, score) expandable per edit;
2. on the Games/Players/Clubs admin pages, a tab with the full event log
   (created / renamed / deleted, latest first, rename showing old → new name).

Existing matches predate the log and have no author, so they must show
nothing — but the moment an old match is edited, its edit event appears.

## Decision

### Append-only `audit_log`, written in the audited transaction

Migration `042` adds `audit_log(id, created_at, actor_user_id → users(id),
entity_type ∈ {match, game, player, club}, entity_id, action ∈ {created,
updated, renamed, deleted}, details_kind, details_schema_version, details
JSONB)`. Rows are server-minted UUIDv7 (`id.New()`), never updated except by
the startup version migration, never deleted. `entity_id` deliberately has no
foreign key: audit history must outlive the entity (the name at delete time is
captured in the details document).

Every audited service method inserts its audit row **inside the same pgx
transaction as the write** (`runInTx` for the previously non-transactional
game/player/club services; the match service's existing tx), so the log can
never disagree with the data. Invariants:

- idempotent replays (offline sync re-POSTing the same client id; the
  `ON CONFLICT (id) DO UPDATE` upserts) don't emit duplicate `created`
  events — existence is checked in-tx first;
- an edit with an empty diff (identical PUT) emits nothing;
- a rename to the same name emits nothing;
- icon-only club patches and member add/remove are not audited (out of
  scope); tournaments, corrections, markets, and user renames likewise.

### Details documents follow ADR-09's versioned-JSON pattern

The details payload is not freeform JSON. `pkg/audit` mirrors the calculator
package's mechanics in miniature — embedded JSON Schemas (draft 2020-12) with
`schema_version`, a per-kind `CurrentVersion`, migrator slots, and the
`x-entity-id` walk that shortens canonical UUIDs to the Base58 wire form on
egress (ADR-12). Three kinds ship at v1:

| kind | stored shape | emitted by |
|---|---|---|
| `entity` | `{schema_version, name}` | game/player/club created & deleted |
| `rename` | `{schema_version, old_name, new_name}` | renames |
| `match-update` | `{schema_version, date?, game?, player_changes[], calculator_changed}` | match edits |

Documents are built server-side and validated against the schema before
insert; ids inside them are stored canonical (`player_id`, game ids marked
`x-entity-id` — never object keys, per the ADR-09 storage convention). The
startup data-migration runner (`pkg/db/migrate_data.go`) now walks both
families — calculator documents and audit details — so adding a v2 schema
later upgrades old rows at boot, exactly like calculator data. `match-update`
serializes untouched fields as `null`/`false` (not omitted) and
`player_changes` as `[]` (never `null`), so the schema stays strict.

### One public read endpoint

`GET /audit` (operationId `ListAuditEvents`, `openapi/audit.yaml`) serves both
UIs: filter by `entity_type` (admin tabs) or `entity_type` + `entity_id`
(match history). Public read — the user's call, consistent with `GET /users`
and `GET /matches` already exposing names and match data anonymously.
Cursor pagination copies the corrections pattern: base64-JSON token embedding
the filters plus the last row's `(created_at, id)` — the id tie-break keeps
ordering stable when one transaction writes multiple same-timestamp events.
Actor display names are joined from `users` at read time.

### Frontend

- `components/audit/audit-log.tsx` — paged feed (latest first, «Показать ещё»),
  rows show who · what · when; rename/match-edit rows expand (accordion) into
  `audit-entry-details.tsx` (old → new name; match diff with dates, game
  names from `useGames`, per-player score rows with names from
  PlayersContext, calculator flag). Pure diff→row mapping lives in
  `lib/audit-display.ts` and is unit-tested.
- `components/admin/admin-page-tabs.tsx` — the shared admin-page component
  («Основное» + «Журнал») wrapping the existing page content; audit mounts
  lazily so the feed is fetched only when the tab opens. Used by
  `/admin/games`, `/admin/players`, `/admin/clubs`, and `/admin/club`
  (that one narrowed to the single club, since rename/delete live there).
- Match view gets a «История» card: «Добавил: имя · дата» only when a
  `created` event exists (legacy matches show nothing), then expandable edit
  rows.

## Consequences

- The log is a durable, queryable record — unlike the SSE hub (ADR-13), which
  stays transient and is *not* the source of truth. No new SSE events: the
  existing `matches-changed`/`players-changed` signals already refresh the
  pages that display audited data; audit lists themselves refetch on visit.
- Storage grows monotonically (no retention); the log is tiny compared to
  settlements. Revisit only if it ever matters.
- `pkg/audit` duplicates ~200 lines of the calculator's registry mechanics.
  Unifying both into one generic versioned-JSON package is possible but was
  not worth coupling the two domains (the calculator package must stay free
  of db/pgx deps and its startup runner is table-specific).
- Widening a details document is additive: bump `CurrentVersion`, ship
  `v2.json` + a migrator, and old rows upgrade at boot. The DB CHECK on
  `details_kind` and the action/entity enums must be kept in sync with
  `pkg/audit` constants by hand.
- Player/game ids referenced by match-edit details always resolve in the UI:
  entities with matches can't be deleted (FK blocks it).
