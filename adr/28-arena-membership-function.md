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

The membership rule lives in one place, a scalar function created by
migrations `054` + `055`:

```sql
arena_contains_match(
    p_camp boolean,             -- a.camp
    p_camp_link boolean,        -- EXISTS(camp_matches link for this arena+match)
    p_has_filtered_tag boolean, -- EXISTS(game_tag row matching f.tag_ids)
    p_match_date timestamptz, p_match_game_id uuid,
    p_filter_date_from timestamptz, p_filter_date_to timestamptz,
    p_filter_game_ids uuid[], p_filter_tag_ids uuid[]
) returns boolean
```

- a camp arena contains the match iff the link probe is true;
- every other kind evaluates the filter (date range, game OR tag) exactly as
  before — the two EXISTS probes are passed in by the caller;
- unknown arena or match never yields true.

All eight call sites in `arenas.sql` call the function, passing the columns
and probes they already hold:

| Query | Change vs the copy-pasted form |
|---|---|
| `ListArenas` (matches_count subquery) | predicate → function call |
| `InsertArenaStats` | same shape, function call |
| `ListArenaMatchesPaginated` | same shape, function call |
| `ListArenasMatchingMatch` | also returns camps now (see below) |
| `CountPlayerMatchesInArenaInPeriod` | camp arenas count linked matches |
| `ListMatchesForArenaReplay` | camp-linked matches included |
| `ListArenaPlayersAt` (cnt60/cnt180) | camp arenas count linked matches |

### Deliberate behavior consequences

- **One replay source.** `ListMatchesForArenaReplay` covers camps via the
  link probe, so `ListMatchesForCampReplay` is deleted and the updater's
  camp dispatch branch is gone (supersedes the ADR-27 statement that camp
  arenas replay from a separate query).
- **`ListArenasMatchingMatch` includes camps.** The callers in `matches.go`
  no longer append camp ids from their in-memory link sets — the query is the
  authority. Ordering makes this safe: on create, the links are written before
  the query; on edit, the "before" capture reads the old links and the
  "after" capture runs after the link diff, so both old and new camps are
  drained exactly as before.
- **Camp arenas now get real match counts** in
  `CountPlayerMatchesInArenaInPeriod` and `ListArenaPlayersAt` (previously 0
  via the inner-join drops). Invisible in practice: camps have no leagues, and
  every league consumer short-circuits on a nil league.

## Performance: why the function takes columns, not ids

Measured on a 2026-09 production copy (228 arenas × 1431 matches), arenas
list request:

| Form | Time |
|---|---|
| Inline predicate (pre-refactor) | ~350 ms |
| `arena_contains_match(arena_id, match_id)` querying tables per call | ~24 s |
| column-arg form but with EXISTS in the body (opaque call) | ~3.3 s |
| pure-expression body (shipped) | ~358 ms |

Rules learned, and enforced by the header comment in `arenas.sql`:

- A function body containing a sub-SELECT is **never inlined**; an opaque
  call re-executes its subplans per (arena, match) pair. With id arguments
  the function also re-fetched three tables per call (2.5M buffer touches).
- A **pure-expression** body inlines completely — even when an *argument*
  contains an EXISTS — and the planner then optimizes the whole membership
  condition as if written inline (hashed subplans, built once per query).
- Hence the convention: the function owns the structure of the rule; callers
  pass the two EXISTS probes (camp link, filtered tag) as booleans next to
  the columns. The probes are one-liners; the evolving logic stays
  single-sourced.
- The `p_camp` flag keeps the kinds mutually exclusive: a camp arena's filter
  columns are NULL, and a NULL filter would match everything if the link
  probe alone gated membership (an integration test caught exactly this).

## Notes

- The functions live in migrations because sqlc compiles queries against the
  migrations directory only. 054 created the original id-based version; 055
  replaced it (never edit an applied migration — stage already ran 054).
- sqlc gotchas: don't mix `sqlc.arg` and positional `$n` in one query; a
  named arg inside a function call needs an explicit `::uuid` cast.
- The function is `LANGUAGE sql IMMUTABLE` (no table access left in the
  body). Run `ANALYZE` after restoring a prod copy anyway — plan quality
  depends on stats, not on this function.
- The next arena flavor is a one-line change to the function body.
- The seven arena read queries also share one 15-column SELECT projection;
  `pkg/elo/arena_rows_test.go` keeps the generated row structs
  field-identical so the `arenaFrom*Row` adapters cannot silently mis-map a
  swapped column.
