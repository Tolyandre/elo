# Camp arenas: Кэмпы leave the tournaments entity

Supersedes ADR-04. Revises ADR-24. Ships **before** ADR-26 (bracket
tournaments): after this refactor `tournaments` means brackets only.

## Problem

The `tournament` entity has carried two unrelated things: camps (Кемп —
players gather for a few days and play whatever they want) and, planned in
ADR-26, real bracket tournaments. The two share almost nothing:

- a camp needs a date window and an opt-in per match; a tournament needs
  registration, a bracket, slots, rulings;
- camp "results" (medals per player) are exactly what arenas already
  compute (`arena_player_stats`), duplicated today by the camp-only
  `GET /tournaments/:id/stats`;
- camp membership (`tournament_player_membership`) is a maintained table
  that only exists to power the player-picker sections and the "active
  tournaments" checkbox — while arena settlements already record who
  played in an arena;
- production data contains exactly one camp («Челябинский игровой кэмп
  2026») and no real tournaments.

A camp is naturally a **kind of arena**: a named rating space bounded by
dates, where a match belongs if the user opts in. Arenas already bring
settlements, recalculation, medal stats, and UI pages. So: delete the camp
semantics from `tournaments` entirely and express camps as an arena flavor.

## Decision

### Camp = an arena flag + required dates

```
ALTER TABLE arenas
    ADD COLUMN camp      BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN starts_at TIMESTAMPTZ NULL,
    ADD COLUMN ends_at   TIMESTAMPTZ NULL,
    ALTER COLUMN match_filter_id DROP NOT NULL,
    CHECK (camp = (match_filter_id IS NULL)),          -- camps have no filter
    CHECK (NOT camp OR (starts_at IS NOT NULL AND ends_at IS NOT NULL)),
    CHECK (camp OR (starts_at IS NULL AND ends_at IS NULL));

CREATE TABLE camp_matches (                 -- explicit match ↔ camp arena link
    arena_id  UUID NOT NULL REFERENCES arenas(id) ON DELETE CASCADE,
    match_id  UUID NOT NULL REFERENCES matches(id),
    PRIMARY KEY (arena_id, match_id)
);
```

> **Amended by ADR-28 (migration 059):** `camp_matches` and ADR-26's
> `tournament_matches` merged into one `arena_matches` table anchored at the
> arena. Camp membership semantics are unchanged — the link rows just live in
> the unified table now.

- Camp arenas have **no `match_filter`**: membership is the explicit
  `camp_matches` link, not a predicate. All other arena kinds keep filters
  unchanged (ADR-24).
- **Dates are required** and live on the arena. A match is *eligible* for a
  camp arena iff `starts_at ≤ match.date ≤ ends_at`. (This plan assumes
  both bounds; if only the end bound is wanted, it is one predicate —
  `ends_at ≥ date` — and nothing else changes.)
- **Participants are never stored.** "Players of the camp" are derived on
  the fly from `arena_settlements` (any player with a settlement row in
  the arena). `tournament_player_membership` is dropped.
- Camp stats are arena stats: medals, matches count, standings — already
  computed and rendered by the arena pages. The camp-only
  `GET /tournaments/:id/stats` endpoint is removed.

### The camp checkbox on the match form

A user adding a match may now meet two kinds of checkbox: **camp arenas**
(this ADR) and **tournaments** (ADR-26). Camp semantics:

- The form shows a checkbox per camp arena whose window contains the match
  date (the list of camp arenas is preloaded like tournaments are today,
  so it works offline, per ADR-16).
- The checkbox is **checked by default iff any of the match's players
  already participates** in that camp (i.e. has a settlement row there) —
  a deliberate loosening of ADR-04, where the checkbox was locked when
  *all* players were members. The user may uncheck or check freely at
  creation.
- On `POST /matches` the checked arenas are sent as `camp_arena_ids`; the
  server verifies each arena exists, is a camp, and the match date is in
  its window, then writes `camp_matches` rows and marks the arenas stale.
- **Editing may change the links** (revised from the original freeze): the
  edit form renders the same checkboxes, pre-checked with the match's camps.
  `PUT /matches/:id` takes the **desired** `camp_arena_ids` set — the server
  diffs it against the stored links, attaching and detaching as needed (each
  change audited as `camp-link`), validates every requested arena (exists, is
  a camp, its window contains the new date — 400 otherwise), stale-marks both
  the old and the new camps, and the replay rewrites their settlements and
  medal stats. Editing exists to fix mistakes (a missed or accidental
  checkbox), and the recalculation machinery exists exactly for that. A body
  without the key keeps the links untouched; moving the date outside a linked
  camp without detaching it in the same request is still a 409, not an
  automatic unlink.

### Camp arena administration

Camp arenas are user-created arenas (ADR-24 lifecycle: create/rename/
delete from the arena UI) plus the camp fields:

- create/update takes `name`, `starts_at`, `ends_at` (and the usual
  settings: `starting_rating`, no leagues — camps behave like today's
  tournament arenas);
- dates cannot be narrowed past a linked match (409), mirroring the old
  tournament rule — otherwise the checkbox criterion and stored links
  would disagree;
- deleting a camp arena cascades its links and settlements; matches
  survive as ordinary matches.

Recalculation needs no new machinery: camp arenas join the existing dirty
queue; the recalculation query for a camp arena selects its matches from
`camp_matches` instead of evaluating a filter. Link changes (create,
detach, arena delete) mark the arena stale; the synchronous drain after
match writes keeps settlements fresh, which is what the default-check
heuristic reads.

### What is removed from tournaments

- Tables: `tournament_player_membership`, `match_tournament`;
  `tournaments.start_date` / `tournaments.end_date` columns (brackets do
  not want a date range; they get a grand-final deadline in ADR-26).
- Behaviour: date-window auto-association (`mergeWithActiveTournaments`),
  auto-enrollment on match save (`applyMatchTournaments`), "member played
  a match ⇒ cannot be removed", date-narrowing protection on tournaments.
- API: `GET/POST/PUT/DELETE /tournaments*` including
  `/tournaments/:id/stats` and the `tournament_ids` match payload field —
  removed in this refactor and re-introduced for brackets by ADR-26. The
  match response's `tournaments` list is replaced by `camps`
  (`[{id, name}]`), which is what the match card renders.
- Until ADR-26 phase 1 ships, `tournaments` is an empty shell (id, name)
  and the `/tournaments` page shows an empty list; this is acceptable for
  the short gap and avoids shipping half of both designs.

### Migration (production has one camp)

Generic over all rows; today that is the single seeded tournament:

1. For each `tournaments` row: take its auto-created arena
   (`arenas.tournament_id`, ADR-24/051) → `SET camp = true,
   starts_at = tournaments.start_date, ends_at = tournaments.end_date,
   tournament_id = NULL, match_filter_id = NULL`; delete the now-orphan
   `match_filters` row. (Arena rows must be detached **before** deleting
   the tournament: the anchor FK is `ON DELETE CASCADE` and would take the
   arena with it.)
2. `INSERT INTO camp_matches SELECT arena_id, match_id` — from the old
   `match_tournament` rows joined to the arena.
3. Drop `tournament_player_membership`, `match_tournament`, and the two
   date columns.

The camp keeps its name («Челябинский игровой кэмп 2026»), window,
settings and — via settlements, which 051 already backfilled — its
participants and medal stats. `SyncArenaName` loses its tournament hook;
camp arenas are named directly.

### Audit

Camp-domain mutations join the append-only `audit_log` (ADR-14; today
tournaments and arenas are not audited at all): `entity_type` gains
`'arena'`, with versioned details documents in the established
`pkg/audit` pattern — `arena-camp-config` (name/dates before → after),
`camp-link` (attach/detach of a match, actor). Written in the same
transaction as the change. The full audit design (principles, event
catalog, recovery runbook) is elaborated in ADR-26's "Audit and recovery"
section and applies here verbatim.

### API surface

    GET    /arenas?kind=camps                     public — list (tab + offline preload)
    POST   /arenas                               editor — + camp, starts_at, ends_at
    PUT    /arenas/:id                            editor — name/dates (narrowing guarded)
    DELETE /arenas/:id                            editor
    POST   /matches                               camp_arena_ids replaces tournament_ids
    PUT    /matches/:id                           camp_arena_ids is the desired set
                                                 (attach/detach, audited); date edits
                                                 validated against linked camps

`kind` gains the value `camps` next to `games`/`tournaments` (bracket
tournament arenas keep `kind=tournaments`). OpenAPI changes regenerate
`api-types.gen.ts`; new id-bearing fields reference `#/Base58ID`.

## UI plan

- **`/arenas`**: `ARENAS_TABS` becomes `["games", "camps"]` — the
  `tournaments` tab is renamed and now lists camp arenas
  (`GET /arenas?kind=camps`), split open/ended by `ends_at`. Camp arena
  create/edit gets name + date-range fields (reuse the arena form; a
  «Создать кэмп» action on the camps tab).
- **`/tournaments`**: camps disappear from the list; the page stays empty
  until the ADR-26 UI phases fill it with bracket tournaments. The nav
  item («Кемпы и турниры», `navigation-bar.tsx`) becomes «Турниры».
- **Match form** (`MatchForm.tsx`, `tournament-checkboxes.tsx`,
  `useTournamentSelection.ts`): a «Кэмпы» checkbox group driven by the
  preloaded camp arenas — visible when the (edited) date falls in a
  window, default-checked when any selected player has a settlement in
  the arena, pre-checked with the match's camps on edit (freely
  editable — see the revised editing rule above). The players dropdown
  (`lib/player-groups.ts`) gains camp sections (checked camps) replacing
  the old tournament sections. Offline: `PendingMatch` carries
  `campArenaIds` (`lib/offline/types.ts`, `OfflineContext.tsx`).
- **Match card** (`match-card.tsx`): the tournament-name badges after the
  player list become camp-arena badges (`match.camps`).
- **Main page** (`app/page.tsx`): above the global arena, a compact
  «Сейчас» block of plain links to active camps (window contains today;
  from the preloaded camp list) — the tournaments links are appended here
  by ADR-26's UI phase.

## Rollout

1. **Schema + migration.** Arena columns, `camp_matches`, data conversion
   (the production camp), drops. Integration test over a seeded
   camp-tournament fixture: arena converted, links preserved, settlements
   and medal stats unchanged after recalc.
2. **Backend.** Camp arena CRUD (dates guard), `camp_arena_ids` on match
   create, desired-set attach/detach + window validation on edit,
   stale-marking on link changes, removal of the camp tournament code paths
   and endpoints, OpenAPI regeneration.
3. **Frontend.** The UI plan above; `pnpm exec tsc --noEmit` + Vitest for
   the touched form/checkbox logic (default-check rule, frozen edit).
