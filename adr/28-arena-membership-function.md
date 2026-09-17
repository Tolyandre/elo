# Arena membership as one SQL function

Revises ADR-24 (arena rework) and ADR-27 (camp arenas).

## Problem

The "does this match belong to this arena" condition — the filter evaluation
(date range, game OR tag) for filter arenas plus the `camp_matches` link check
for camps (ADR-27) — was copy-pasted across eight queries in
`pkg/db/query/arenas.sql` (three wrapped in the camp-vs-filter disjunction,
five filter-only). The file's own header warned "do not change one copy
without the others", and ADR-24's notes list the duplication as a known trap.
Adding the camp flavor proved the point: the disjunction had to be threaded
into every copy, and the next arena flavor (ADR-26 tournament arenas) would
pay the same tax — in SQL that the compiler cannot check.

## Decision

The membership rule lives in one place, a scalar function created by migration
`054_arena_contains_match.up.sql`:

```sql
arena_contains_match(p_arena_id uuid, p_match_id uuid) returns boolean
```

- a camp arena contains the match iff a `camp_matches` link row exists;
- every other kind evaluates the filter (date range, game OR tag) exactly as
  before;
- unknown arena or match → NULL, which every caller's `WHERE` treats as
  "not a member".

All eight call sites now call the function:

| Query | Change |
|---|---|
| `ListArenas` (matches_count subquery) | predicate → function call |
| `InsertArenaStats` | drops the `arenas`/`match_filters` joins |
| `ListArenaMatchesPaginated` | CTE selects from `matches` only |
| `ListArenasMatchingMatch` | also returns camps now (see below) |
| `CountPlayerMatchesInArenaInPeriod` | drops both joins |
| `ListMatchesForArenaReplay` | camp-linked matches included |
| `ListArenaPlayersAt` (cnt60/cnt180) | drops both joins |

### Deliberate behavior consequences

- **One replay source.** `ListMatchesForArenaReplay` covers camps via the
  function's link branch, so `ListMatchesForCampReplay` is deleted and the
  updater's camp dispatch branch is gone (supersedes the ADR-27 statement that
  camp arenas replay from a separate query).
- **`ListArenasMatchingMatch` includes camps.** The callers in `matches.go`
  no longer append camp ids from their in-memory link sets — the query is the
  authority. Ordering makes this safe: on create, the links are written before
  the query; on edit, the "before" capture reads the old links and the "after"
  capture runs after the link diff, so both old and new camps are drained
  exactly as before.
- **Camp arenas now get real match counts** in
  `CountPlayerMatchesInArenaInPeriod` and `ListArenaPlayersAt` (previously 0
  via the inner-join drops). Invisible in practice: camps have no leagues, and
  every league consumer short-circuits on a nil league.

## Notes

- The function lives in a migration because sqlc compiles queries against the
  migrations directory only; sqlc v1.31 resolves the argument types from the
  function signature. (Do not mix `sqlc.arg` and positional `$n` in one query
  — sqlc rejects that; and a named arg inside a function call needs an
  explicit `::uuid` cast or a positional form.)
- `LANGUAGE sql STABLE` so the planner can inline the body; no `SET
  search_path` clause — a SET clause disables inlining, and the service uses
  the default search path. Cost is a handful of PK/index probes per candidate
  row, immaterial at this data scale.
- The next arena flavor is a one-line change to the function body.
- The seven arena read queries also share one 15-column SELECT projection;
  `pkg/elo/arena_rows_test.go` keeps the generated row structs
  field-identical so the `arenaFrom*Row` adapters cannot silently mis-map a
  swapped column.
