# Client generated ids

## Problem

1. Offline mode is complicated because of temporary identifiers that need to be replaced after saving to server. The frontend `rewriteMatchRefs` rewrites every pending match's `gameId` and `score` keys from client placeholders to server ids after each successful sync (`nextjs/lib/offline/sync.ts`).
2. We end up having 2 indices by id and by client id (idempotency key). `games`, `players` and `matches` each carry a `SERIAL PRIMARY KEY id` plus a nullable `UUID idempotency_key` with a unique index (`migrations/035_schema.up.sql`).
3. Inconsistent id typing across the API: `Player.id` and `Game.id` are exposed as `string`, but `Match.id`, `GameMatch.id`, `Correction.id` and tournament `player_ids` are exposed as `integer` (`openapi/matches.yaml`, `openapi/games.yaml`, `openapi/tournaments.yaml`).

## Decision

Replace `SERIAL` (int) primary keys with **UUIDv7** for all tables. UUIDv7 is a standard UUID format (36 characters, 8-4-4-4-4 hex with dashes) whose first 48 bits encode a unix-millisecond timestamp, making it lexicographically sortable and monotonically ordered. This satisfies the ordering invariant from ADR-01 §22: "События пользователя строго упорядочены в хронологическом порядке. Если два события имеют одну дату, то хронологический порядок определяется по возрастанию идентификатора события." — UUIDv7s sort lexicographically by generation time, so equal-date rows keep a stable chronological order.

The client generates the UUIDv7 and sends it on create. The id IS the idempotency key: a repeated POST with the same id is a no-op (`INSERT ... ON CONFLICT (id) DO NOTHING`). The separate `idempotency_key` columns and their unique indices are dropped.

### Format and storage

- Wire format: standard 36-character UUID string (e.g. `018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f`).
- PostgreSQL storage: native `UUID` type (16 bytes). UUIDv7 strings are valid UUID format, so Postgres accepts them directly — no ULID↔UUID conversion needed.
- URL encoding: the 36-char UUID string is used directly in query params (`/player?id=018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f`).
- Go: `github.com/google/uuid` — `uuid.NewV7()` for server-generated ids (users, bets, corrections, settlements).
- TypeScript: the `uuidv7` npm package — `uuidv7()` for client-generated ids (players, games, matches, clubs, tournaments, markets, skull king tables).
- `skull_king_tables.id` was already a server-generated `UUID`; it now also accepts client-generated UUIDv7.

### Scope

All tables with `SERIAL` primary keys migrate to `UUID` (ULID-backed):

`clubs`, `games`, `players`, `matches`, `users`, `tournaments`, `markets`, `bets`, `corrections`, `global_arena_settlement`, `game_arena_settlement`, `skull_king_tables`.

All foreign-key columns referencing these tables change from `INT` to `UUID`:

- `player_club_membership.club_id`, `.player_id`
- `match_scores.match_id`, `.player_id`
- `users.player_id`
- `match_tournament.match_id`, `.tournament_id`
- `tournament_player_membership.tournament_id`, `.player_id`
- `markets.created_by`, `.resolution_match_id`
- `bets.market_id`, `.player_id`
- `corrections.player_id`
- `global_arena_settlement.player_id`, `.match_id`, `.market_id`, `.correction_id`
- `game_arena_settlement.game_id`, `.player_id`, `.match_id`
- `skull_king_tables.host_user_id`

`INT[]` array columns become `UUID[]`:

- `market_match_winner_params.required_player_ids`, `.game_ids`
- `market_win_streak_params.required_player_ids`, `.game_ids`
- `skull_king_tables.connected_player_ids`

### Id requirement on create

Every create endpoint (`POST /players`, `POST /games`, `POST /matches`, and other create endpoints for clubs/tournaments/markets/bets/corrections) MUST accept an `id` (ULID string) in the request body and use it as the primary key. The server returns 400 if `id` is missing. The `idempotency_key` request field and the `idempotency_key` DB columns are removed. A repeat request with the same `id` returns the existing row (idempotent).

For entities that are not created offline by the client (e.g. `users` via Google OAuth, server-side settlements), the server generates the ULID. For these, id remains opaque to the client.

### Ordering policy

The client-supplied ULID timestamp is trusted as authoritative for the equal-date ordering tie-break (ADR-01 §22). This mirrors the current behavior where the client supplies the match `date`. Residual risk: a skewed or adversarial client clock could craft a ULID that sorts before other same-date matches, influencing Elo recalculation order. This risk is accepted — it is no worse than the client's existing ability to lie about the match `date` itself.

### User authentication transition

Breaking change accepted. The JWT `sub` claim changes from a stringified int (`oauth2/createJwt.go`) to a ULID string. On deploy, all existing JWTs become invalid and active users must re-authenticate via Google OAuth once. No dual-numeric/ULID lookup path is maintained. `MustGetCurrentUserId` and `renewCookieIfNeeded` parse ULIDs only.

### Migration

Single up-only migration `036_client_ulid_ids.up.sql` (no down migration). Steps performed in dependency order (parents before children):

1. For each table, `ALTER TABLE ... ALTER COLUMN id TYPE UUID USING ...`. Existing rows are backfilled with a deterministic int→ULID mapping that preserves the current ordering: for matches specifically, the mapping is monotonic in the old int id so that equal-date rows retain their relative order (required by ADR-01 §22). Seeded rows (clubs 1/2, testdata rows) use fixed, documented ULIDs.
2. Drop `idempotency_key` columns and their unique indices on `games`, `players`, `matches`.
3. `ALTER COLUMN ... TYPE UUID` on all FK columns listed above, with `USING` clauses that map via the same int→ULID mapping.
4. `ALTER COLUMN ... TYPE UUID[]` on the array columns, with element-wise `USING` clauses.
5. Drop all `*_id_seq` sequences.
6. Recreate any indices that were implicitly tied to the SERIAL type.

`testdata/seed.sql` is rewritten with the same fixed ULIDs so integration tests remain deterministic. The squashed schema file `035_schema.up.sql` is left as the historical baseline; the club seed ids (1, 2) are transformed by migration 036.

### Generated code

After editing `openapi/*.yaml` and the SQL schema/queries, run `make generate-api` to regenerate:

- `elo-web-service/pkg/api/generated.go` (oapi-codegen)
- `nextjs/app/api-types.gen.ts` (openapi-typescript)

and re-run sqlc to regenerate:

- `elo-web-service/pkg/db/models.go`
- `elo-web-service/pkg/db/*.sql.go`
- `elo-web-service/pkg/db/querier.go`

### Domain changes

The `UserEvent` interface (`pkg/elo/event_processor.go`) changes `UserEventID() int32` to `UserEventID() string`. The `map[int32]float64` maps in `MatchPrevState` (`pkg/elo/value_objects.go`) and throughout `buildEloResults` (`pkg/elo/matches.go`) become `map[string]float64`. `EloCalcFunc` signature changes from `int32` id parameters to `string`. `parseMatchScores` (`pkg/api/matches.go`) keeps score-map keys as strings instead of parsing them to `int32`. All `strconv.ParseInt(request.Id, 10, 32)` and `strconv.Atoi(...)` call sites in handlers are removed; ids flow as strings end-to-end.

### Offline mode simplification

- `nextjs/lib/offline/types.ts`: `newOfflineId()` returns `ulid()`. The `OFFLINE_ID_PREFIX` and `idempotencyKeyOf` helpers are deleted — the offline id IS the final id.
- `nextjs/lib/offline/sync.ts`: `rewriteMatchRefs` is deleted. `SyncApi.addMatch` returns `{ id: string }`. `syncOffline` sends `id: match.clientId` directly; no rewriting of references is needed because pending games/players already carry their final ULIDs.
- `nextjs/app/offline/OfflineContext.tsx`: `SubmitMatchResult` becomes `{ id: string }`. `submitMatch` mints the ULID up front and reuses it for both the online attempt and any later offline retry.

## Notes

Links to pages (https://tolyandre.github.io/elo/player?id=1) are affected. The 26-char ULID is used directly in the URL (URL-safe base32), compact and readable, similar to how YouTube does https://www.youtube.com/watch?v=qFYeJXKYj_E.

Some identifiers are hardcoded in the code (seed data, club ids 1/2, test fixtures, `INT[]` array literals). These all migrate to fixed ULIDs.

This is a breaking API change: existing clients must send `id` on create and handle `id` as a string everywhere. A short deployment window where the server returns errors while the database is updating is accepted.
