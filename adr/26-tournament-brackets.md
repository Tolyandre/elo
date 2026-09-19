# Bracket tournaments

Revises ADR-04 (which ADR-27 supersedes: camps are arenas now, and
`tournaments` means brackets only). Backend first; the UI plan is part of
this document and ships after the backend phases. Depends on ADR-27
shipping first — the camp semantics must be out of `tournaments` before
the bracket lifecycle lands in it.

## Problem

ADR-04's `tournament` was a camp. With camps moved to arenas (ADR-27),
the `tournaments` entity is repurposed for real tournaments:

- strict participants who register in advance, into a game pool chosen by
  the organizer (each game with its table capacity — min/max players; a
  typical board game seats 3–4);
- to close the registration the organizer picks a **bracket shape** from
  all valid options the system enumerates for the participant count and
  pool; the bracket is a series of elimination rounds;
- two shape families: **single elimination**, and **WB + LB** — traditional
  double elimination: losing a WB round (except in the grand final) drops
  the player into the losers bracket, losing an LB round is elimination, and
  the LB's winner(s) join the WB finalists in the grand final. In the grand
  final WB players get **no advantage** over LB players — no bracket reset,
  no seeding privilege, one loss there eliminates everyone;
- exactly one champion at the end;
- matches are still entered through the normal match flow, and editing a
  match (including full replay of its history via the calculator, ADR-09)
  must stay possible — but editing must never silently change whether a
  match counts for the tournament, and the bracket invariant "the next
  round is played by whoever advanced" must hold at all times;
- accidental alterations (a wrong ruling, a bad edit) must be recoverable
  from a durable, queryable trail — recovery, not enterprise-grade
  monitoring.

Constraints inherited from the codebase:

- A match stores only a player→score map; places are always derived
  (`RANK() ... ORDER BY score DESC`), and ties for 1st place are normal.
- Matches are client-generated-id upserts (ADR-06/16), editable via
  `PUT /matches/:id`; there is no match delete.
- Every tournament auto-creates an arena via a `match_filters` row with
  `tournament_id` (ADR-24) — rating and medals for tournament matches come
  for free if matches get linked to the tournament.
- Permissions are global (`users.allow_editing`): **any editor can act as
  the organizer** of any tournament; users may have a linked player
  (`users.player_id`) for self-registration.
- Ids are typed (ADR-12); every new id-bearing API field must reference
  `#/Base58ID` in the spec and be regenerated.
- The audit trail is the append-only `audit_log` with versioned details
  documents (ADR-14); it covers matches/games/players/clubs today and
  gains `tournament` rows in this design.

## Decision

### Tournaments are brackets only

After ADR-27 the table carries no mode: every row is a bracket tournament
in one of the lifecycle states below. `mode = 'camp'` does not exist.

### Lifecycle

    registration ──organizer selects a shape & starts──▶ running ──▶ completed
        │                                                    │
        └────────────────────────────────────────────────────┴──▶ cancelled

- **registration** — the initial state, set at creation. The organizer
  maintains the game pool (per-game `min_players`/`max_players`), the
  optional grand-final deadline, and participants register/withdraw
  (editors directly; a signed-in user registers via their linked player
  through the existing `RequirePlayerID` middleware).
- **running** — set by the single start action: the organizer picks a
  bracket shape from the enumerated options; registration closes, the
  bracket (all rounds and slots) is generated, first-round seats are drawn
  at random from the stored seed.
- **completed** — the grand final promoted exactly one player;
  `winner_player_id` is set; the tournament is read-only.
- **cancelled** — the organizer aborted, **or the grand-final deadline
  passed** without a completed grand final (automatic; see below).

### Data model

```
ALTER TABLE tournaments
    ADD COLUMN status               TEXT NOT NULL
                                    CHECK (status IN ('registration','running','completed','cancelled')),
    ADD COLUMN elimination          TEXT NULL
                                    CHECK (elimination IN ('single','double')),
                                    -- the chosen plan's family, stamped at start;
                                    -- NULL during registration (migration 060)
    ADD COLUMN winner_player_id     UUID NULL REFERENCES players(id),
    ADD COLUMN seed                 BIGINT NULL,         -- PRNG seed; reproducible draws
    ADD COLUMN grand_final_deadline TIMESTAMPTZ NULL,    -- optional; auto-cancel
    ADD COLUMN plan                 JSONB NULL,          -- chosen shape, verbatim (set at start)
    ADD COLUMN plan_schema_version  INT  NOT NULL DEFAULT 1;
-- ADR-27 drops start_date/end_date, tournament_player_membership and
-- match_tournament; name + client-supplied id stay as they are.

CREATE TABLE tournament_games (            -- the game pool with table capacity
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    game_id       UUID NOT NULL REFERENCES games(id),
    min_players   INT  NOT NULL CHECK (min_players >= 2),
    max_players   INT  NOT NULL CHECK (max_players >= min_players),
    PRIMARY KEY (tournament_id, game_id)
);

CREATE TABLE tournament_rounds (
    id            UUID PRIMARY KEY,
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    track         TEXT NOT NULL CHECK (track IN ('winners','losers','final')),
    index         INT  NOT NULL,           -- 1-based within the track
    UNIQUE (tournament_id, track, index)
);

CREATE TABLE tournament_slots (            -- one table + its match series
    id        UUID PRIMARY KEY,
    round_id  UUID NOT NULL REFERENCES tournament_rounds(id) ON DELETE CASCADE,
    position  INT  NOT NULL,               -- table number within the round
    game_id   UUID NOT NULL REFERENCES games(id),
    promote   INT  NOT NULL CHECK (promote >= 1),   -- uniform per round; < seat count
    status    TEXT NOT NULL CHECK (status IN ('waiting','playing','completed')),
    UNIQUE (round_id, position)
);

CREATE TABLE tournament_seats (            -- who sits at a slot's table
    id             UUID PRIMARY KEY,
    slot_id        UUID NOT NULL REFERENCES tournament_slots(id) ON DELETE CASCADE,
    position       INT  NOT NULL,
    player_id      UUID NULL,              -- direct seed (round 1 / byes) …
    source_slot_id UUID NULL REFERENCES tournament_slots(id),
    source_place   INT  NULL,              -- … or "place i of that slot" (1-based)
    UNIQUE (slot_id, position),
    CHECK ((player_id IS NULL) <> (source_slot_id IS NULL))
);

CREATE TABLE tournament_slot_matches (     -- matches counted for a slot
    slot_id   UUID NOT NULL REFERENCES tournament_slots(id) ON DELETE CASCADE,
    match_id  UUID NOT NULL REFERENCES matches(id),
    PRIMARY KEY (slot_id, match_id)
);

CREATE TABLE tournament_slot_promotions (  -- recorded at slot completion
    slot_id   UUID NOT NULL REFERENCES tournament_slots(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES players(id),
    place     INT  NOT NULL,               -- 1..promote; drives downstream seats
    PRIMARY KEY (slot_id, player_id),
    UNIQUE (slot_id, place)
);
```

Notes:

- Round display names ("Round 2", "Losers round 1", "Grand final") are
  derived client-side from `track` + `index`.
- Seats carry provenance (`source_slot_id` + `source_place`) instead of
  copied names; `player_id` on a seat is a *cache* filled when the source
  completes. Consistency is always re-derived from sources.
- Slot standings are **never stored**: they are derived at read/completion
  time from the linked matches' scores (below), consistent with the
  "places are never stored" rule of the whole codebase.
- `plan` stores the chosen shape verbatim at start. The rounds/slots/seats
  tables are its materialization; the plan document is the authoritative
  definition — it is what "start" validated, what the audit references,
  and the fastest path to rebuild the materialization if it is ever
  corrupted (see Audit and recovery).

### Bracket shape enumeration (plans)

A **plan** is a complete, pre-computed bracket structure: every round,
every slot with its seat count, promotion count and game, and every
promote relation between slots. The organizer must see and pick the whole
shape up front — nothing is generated lazily later.

For a round with `n` players the enumerator lists candidate slot sets —
multisets of seat sizes drawn from the pool's capacities:

- `⌊n/k⌋` slots of `k` players for every pool size `k`, remainder as bye;
- mixed variants: `⌊n/k⌋` slots of `k` plus combinations of smaller pool
  sizes (e.g. `n = 8`, pool `{2,3}`: `3+3+2`; `n = 11`, pool `{3,4}`:
  `4+4+3`);
- a **bye** (the unseated remainder) is allowed **only in the first round**
  of the winners track; every later round and both other tracks must seat
  everyone exactly (`⌊n/k⌋·k = n`);
- a seat size is only usable if some pool game fits it; if the pool has no
  game for a candidate set, that candidate is not offered.

For each candidate slot set the promotion count `p` is uniform across the
round — it cannot differ between slots of the same round — with
`p ∈ 1 .. (min seat size − 1)`: a 2-seat slot promotes exactly 1, a 3-seat
slot 1 or 2, a k-seat slot any of `1..k−1`. A bye promotes all bye players.
The round's output is `n' = p · (#slots) + byes`; the enumerator recurses
while `n' > 1` and keeps only plans that terminate with a round promoting
exactly one player. Dead-ending branches are simply not offered.

**WB + LB plans** extend the search with a second track: every WB round's
non-promoted players fall to the LB pool (LB is their last chance — LB
non-promoted players are out). The enumerator steps through states
`(n_winners, n_losers)`: run a winners round, run a losers round (when the
LB pool seats exactly), or — once both tracks are exhausted — merge into
the `'final'` track and play it out to a single champion. The merge is the
traditional grand final and is offered only when the WB is finished (its
survivors can no longer form a valid round alone) **and** the LB is down to
its winner set: every LB pool member has won at least one LB round, or the
pool is a single player (the LB winner by waiting — the n=2 rematch, where
no LB round can exist). An unplayed WB drop never skips the losers bracket
into the grand final: if the LB could never seat its drops, the branch
dead-ends and no plan is offered for that shape. In the final track WB and
LB players are ordinary participants; there is no bracket reset and no WB
privilege — one loss eliminates everyone. Because LB rounds may pause and
wait for the next WB drop, both "run LB now" and "run WB next" branches are
explored.

The plan list is a pure function of `(participant count, game pool, families
+ chip filters)` — nothing is stored per plan. **Both families are offered
side by side** in one list; the elimination type is not a creation field but
a property of the chosen plan (the family chips just narrow the list). The
endpoint takes the chip selection as query parameters — the families to
explore plus the display filters (round counts, byes, first-round shapes) —
and the cap applies **after** them, so the response is always the first `cap`
plans of the current condition; a family chip can never hide behind the
other family's plans. The response also carries **facets** — the option
space of the explored families ignoring the display filters — so the chip
options never shrink because another chip is active. Plans come ordered
deterministically (fewer rounds first, then fewer tables, then larger
slots), truncated for pathological explosions (wide pools, large n; the cap
and truncation flag are part of the response). The organizer can tweak the
pool and refetch.

**Start.** `POST /tournaments/{id}/start` takes the chosen plan, validates
it against a fresh enumeration of the plan's own family (the submitted plan
must be one the server would have offered — no hand-forged structures),
stores it verbatim in `plan`, stamps the plan's family onto
`tournaments.elimination` (NULL until then), generates all rounds, slots and
seats in one transaction, assigns a pool-fitting game to every slot, and
seeds first-round players (and byes) randomly from the stored `seed`. From
here the whole bracket exists; slots start as `waiting` (upstream not
resolved) or `playing` (first round).

### Slot play: points, replays, completion

A slot is not one match — it is a small series played by the same seated
players until the promoted set is beyond doubt.

- Every linked match scores **placement points** inside the slot: with
  `s` = seat count, the match's place-1 player(s) gain `s` points, place 2
  gains `s − 1`, place 3 `s − 2`, … the last place gains 1 (place from the
  usual derived `RANK()`, so tied game scores share points). Points
  accumulate across the slot's matches; every place scores, so they are
  relative only. Cumulative standings share a rank on equal points
  (competition ranking: 1, 1, 3).
- After each linked match the slot re-evaluates: if the top-`promote` set
  of the **cumulative** standings is strictly separated from the rest
  (place `promote` has strictly more points than place `promote + 1`),
  the slot **completes**; otherwise the players simply play the same slot
  again — every match counts, nothing is discarded, and a later match can
  overturn an earlier leader.
- Slot statuses: **waiting** — seats not all determined yet; **playing** —
  seated, accepting matches; **completed** — promotion decided (by points
  or by organizer ruling).

Example: slot of 4 promoting 2. Match 1 ends with a shared top game score
→ both leaders take 4 points, 4–4–2–1; no strict cut, so the slot replays.
Match 2: 3–4–2–1 → cumulative 7–8–4–2 → strict top-2 {B, A} → completed.

The grand final is the plan's last round; when its slot completes with
exactly one promoted player, the tournament completes and
`winner_player_id` is set.

**Organizer ruling.** The organizer may complete any `playing` slot by
hand — an ordered promotion set of exactly `promote` players (covers
abandoned matches, no-shows, disputes). A ruling replaces and can be
replaced by the standings-based result; every ruling and reversion is
audit-logged (see Audit and recovery).

### Match acceptance: the checkbox

Players add matches through the normal flow. The match form shows a
tournament checkbox — **default checked** — when the match fits the
requirements of a `playing` slot (same game, exactly the seated players),
right next to the camp-arena checkboxes of ADR-27: two checkbox kinds, one
form.

- On `POST /matches` the server links the match to a slot when the match
  exactly fits one (unique candidate; deterministic
  `(track, index, position)` ordering as a safeguard). An unchecked
  checkbox is sent as an explicit `skip_tournament_link` flag — the match
  then never enters the bracket. Fitting is always verified server-side;
  the client checkbox only drives the default. (Camp links, by contrast,
  are client-listed — `camp_arena_ids` — because camp membership is an
  opt-in tag, not a structural fit.)
- **Association changes on edit are explicit and safe only** (history
  playback): `PUT /matches/:id` on a linked match may fix scores, date,
  calculator data — but must keep the exact player set and game, otherwise it
  is rejected with 409. The checkbox itself stays editable on edit (like the
  camp checkboxes): sending `skip_tournament_link: true` detaches a stored
  link, sending `false` attaches the match to the unique fitting `playing`
  slot — each audited. A link change is accepted only while it cannot void
  played results: attaching targets a `playing` slot (no recorded promotions
  yet, so nothing downstream exists to invalidate), and detaching is refused
  with 409 while any downstream slot still holds linked matches — un-counting
  a match whose outcome fed played rounds goes through the organizer's
  explicit detach instead. A desired state that already holds is a no-op.
  What editing *does* do: scores change → points recompute → completion
  re-evaluates → possibly a different promotion set (see consistency below).
- Acceptance, points, completion and audit rows all happen in the
  match-write transaction. Offline-sync replays (ADR-16) behave the same:
  association is decided once, at the server write — a queued match may
  gain its slot link during sync, and the UI reflects that on refetch.

### Editing without paradoxes

Scores of linked matches are freely editable, and a promoted set may
legitimately change because of it. The invariant is kept by re-derivation
plus cascade invalidation:

1. Points recompute for the affected slot; its strict top-`promote` set is
   re-evaluated.
2. If the set (or its order) changed, the slot's `tournament_slot_promotions`
   are rewritten and every downstream seat cache fed by this slot is
   refilled.
3. Any downstream slot that already has linked matches or recorded
   promotions is **invalidated recursively**: its links and promotions are
   deleted (audit-logged with the triggering edit), its status returns to
   `waiting`/`playing`, and it must be played again with the correct
   participants. Re-acceptance is deliberately not automatic — voided
   results are consciously re-played or re-attached by the organizer.

The bracket therefore never lies: at any moment each seat's player is the
current advancement product of its source slot, and every linked match's
player set equals its slot's seated set. "The next round is played by
whoever advanced" holds by construction, not by prohibition.

### Organizer adjustments while running

While the tournament is running the organizer may change a slot's game, as
long as no already-added match is violated:

- game reassignment — only for slots with zero linked matches;
- everything else (seat-count changes, shape changes, promotion counts,
  completed slots) is out — cancel and re-create, or use a ruling. (The
  original design allowed first-round seat-count changes with a seeded
  re-deal; it was dropped: shrinking a table silently dropped players out
  of the tournament, growing one displaced plan-declared byes, and the
  materialization silently diverged from the stored plan.)

All adjustments are audit-logged.

### Explicit corrections (organizer)

- `POST /tournaments/{id}/slots/{sid}/matches` `{match_id}` — attach an
  existing, still-unlinked match to a `playing` slot (same equality
  rules); repairs a mistakenly unchecked checkbox.
- `DELETE /tournaments/{id}/slots/{sid}/matches/{mid}` — detach a wrongly
  linked match; same re-evaluation and cascade as an edit.
- `POST /tournaments/{id}/slots/{sid}/ruling` `{player_ids: [...]}` —
  manual promotion (see above).

### Grand-final deadline

`grand_final_deadline` (optional, set during registration) is enforced
lazily — on bracket reads, match writes and start of any write to the
tournament: if the deadline has passed and the grand final has not
completed, the tournament flips to `cancelled` with an audit record
(system actor, reason "deadline"). A background sweeper is unnecessary;
the worst case is a stale `running` status until the next touch, which
the read path corrects.

### Stats, arenas, rating

Starting a tournament creates its arena (ADR-24 anchor `tournament_id`,
no leagues) exactly as camps used to. Accepted matches get
`match_tournament`-equivalent linkage through slots and ordinary match
rows, so the arena's filter picks them up:

- rating, medals and the standings table come from the arena for free
  (`arena_player_stats`, recalculation pipeline — zero new code);
- the tournament view page embeds the arena standings, as the old camp
  page already did via `GET /arenas?tournament_id=`;
- arena membership follows the slot link: a match that leaves its slot
  (organizer detach, edit-form unlink, cascade void) leaves the arena too,
  and a re-attached match re-enters it. (The original design kept detached
  matches in the arena — "it counts what was played at the event" — but that
  made an unlinked, possibly erroneous match keep voting in the event's
  rating and medals; the bracket-facing detach is the correction tool, so
  the arena now corrects with it.)

### Audit and recovery

**Purpose.** Restore data after an accidental alteration (a wrong ruling,
a bad edit, a mistaken detach). Not enterprise monitoring: no alerting,
no dashboards, no retention policy — the log is tiny and kept forever.

**Mechanism — reuse, don't invent.** ADR-14's `audit_log` is already the
right tool: append-only, written inside the audited transaction (the log
can never disagree with the data), server-minted UUIDv7 ids, details
documents that follow ADR-09's versioned-JSON pattern (schema'd, migrated
at boot, ids stored canonical). No new tables. Two changes:

- `entity_type` CHECK widens: `match, game, player, club` + **`tournament`**
  (+ `arena` from ADR-27). Widening is a hand-synced migration, as ADR-14
  prescribes.
- New versioned details kinds in `pkg/audit`, each carrying **complete
  before/after data** so no other table is needed to reconstruct state:

| details kind | emitted by | payload |
|---|---|---|
| `tournament-config` | created / updated (name, pool, deadline) | full before → after config |
| `tournament-start` | start | the chosen `plan` document + seed + participant list |
| `tournament-state` | completed / cancelled (incl. deadline auto-cancel; `actor_user_id IS NULL` for system) | from-state, to-state, reason |
| `slot-ruling` | ruling set / replaced / reverted | slot, before (playing or prior promotions), after (ordered players) |
| `slot-link` | attach / detach / cascade-void | slot, match, action, and for voids the **origin chain** (the triggering match-edit event id, or the upstream slot whose change cascaded) |

Idempotent-replay and empty-diff rules carry over from ADR-14 (re-POSTing
the same client id emits nothing; a no-op PUT emits nothing).

**Why this is enough to restore.** Every mutation is either (a) a match
edit — already diffed by `match-update` details, (b) a slot outcome change
— `slot-ruling`/`slot-link` with full before/after, or (c) a structural
change — impossible while running except adjustments, which are
`slot-link`/config events. The `plan` column plus `tournament-start`
means the intended shape is never in doubt; the seats/promotions tables
are re-derivable from match scores (standings are derived by design), so
the audit only has to capture the *decisions*, which it does.

**Restoration is a runbook, not a feature.** No in-app undo is planned.
Recovery = query `GET /audit` (or SQL) for the affected entity, read the
versioned documents, apply the inverse change through the normal service
calls (or SQL for crashed-state repair), and let the normal re-derivation
+ recalculation pipeline settle the rest. Example: a wrong ruling is
reverted by re-issuing the correct ruling — the audit pair documents both;
a corrupted bracket is rebuilt by re-materializing from `plan` and
re-running acceptance over `matches` (deterministic: same inputs, same
bracket).

### API surface

All ids in payloads reference `#/Base58ID` (`openapi/common.yaml`);
`make generate-api` + openapilint as usual. `Tournament`/`TournamentInput`
gain `status`, `elimination` (read-only and nullable until start — the plan
decides), `games: [{game_id, min_players, max_players}]`,
`grand_final_deadline`, `winner_player_id` (read); `start_date`/`end_date`
are gone (ADR-27). `AdjustTournamentSlot` takes only `game_id`.

    POST   /tournaments                                      editor — create, status=registration
    PUT    /tournaments/{id}                                  editor — pool, deadline, name while registration
    GET    /tournaments/{id}/bracket-plans                    editor — valid shapes for current n & pool;
                                                              query: elimination, rounds, byes, first_shapes (chips)
    POST   /tournaments/{id}/start                            editor — body: chosen plan; closes registration
    POST   /tournaments/{id}/cancel                           editor (also automatic on deadline)
    GET    /tournaments/{id}/bracket                          public — full bracket DTO
    POST   /tournaments/{id}/registration                     auth + linked player, while registration
    DELETE /tournaments/{id}/registration                     auth + linked player, while registration
    POST   /tournaments/{id}/slots/{sid}/matches              editor — attach
    DELETE /tournaments/{id}/slots/{sid}/matches/{mid}        editor — detach
    POST   /tournaments/{id}/slots/{sid}/ruling               editor — manual promotion

`GET /bracket` DTO (designed for rendering):

    Bracket {
      tournament_id, status, elimination, winner_player_id,
      rounds: [ { track, index,
                  slots: [ { id, game_id, position, promote, status,
                             seats:   [ { position, player_id, source_slot_id, source_place } ],
                             matches: [ { match_id } ],
                             standings: [ { player_id, points, place, promoted } ] } ] } ] }

`GET /audit` gains `entity_type=tournament`; no new endpoints for audit.

## UI plan

Ships after the backend phases; pages are client components using the
generated API client (`app/api.ts`), URL-query state via
`lib/url-state.ts` (ADR-25).

**`/tournaments` — list.** Repurposed from the camp list: cards/rows with
name, status chip (регистрация / идёт / завершён / отменён), participants
count; sorted running/registration first. Editors get «Создать турнир».
Feeds from the tournaments context (already preloaded for the match form).

**`/tournaments/view?id=` — tournament page.**

- Header: name, status, elimination type (once started), grand-final
  deadline (when set), champion banner (`winner_player_id`) when completed.
- `registration`: participants list; a **«Записаться» / «Сняться»**
  button — visible with a linked player, calls the registration endpoints,
  hidden otherwise; editors also see participant management (link to
  edit).
- `running`/`completed`: the **bracket** — a column per round, grouped into
  stacked track bands (Победители over Проигравшие, the grand final to the
  right of both); promotion lines connect each seat's source slot (anchored
  at the standings row of its place) to the destination seat row. Lines
  into one destination column descend in per-connector lanes (parallel
  descents run side by side instead of merging); the WB→LB drops
  additionally render dashed in their own color with wide corners, allowed
  to pass beneath the cards. Clicking a player row (or an unfilled seat)
  spotlights that player's path — every row they occupy plus the lines
  between them; an unresolved seat spotlights its incoming line and source
  row — and dims the rest; a click past the rows clears it. Each slot
  renders as a card: game name, seated players (names resolved from players
  context; unresolved seats are placeholders whose provenance stays in the
  tooltip), status badge (ожидает / играет / завершён), live standings with
  points and the promoted set highlighted, linked match count. This is a
  pure rendering of the `GET /bracket` DTO — no client-side bracket logic.
- Rating/medals: embed the tournament's arena view (the page already
  locates it via `GET /arenas?tournament_id=`; reuse `ArenaView`
  components) instead of the old camp stats endpoint.

**`/tournaments/edit?id=` — organizer administration.** Editor-gated.

- `registration`: name/deadline fields, game-pool editor (games with
  min/max spinners), participant management, and the **shape picker**:
  fetch `GET /bracket-plans`, render each plan as a compact round-by-round
  preview (e.g. «одиночная сетка: Тур 1: 4+4 → 2; Финал: 4 → 1»), and show
  the selected plan as a visual mockup (the same column-per-round bracket
  skeleton with seat dots and promotion lines), select + confirm → `start`
  (which closes registration). Both families share the list; filter chips
  (Сетка / Раунды / Баи / Первый круг) travel as query parameters and the
  facets response drives the chip options. Pool edits refetch the plan
  list — the UI makes that dependency visible.
- `running`: slot adjustments (game dropdown where the server allows), the
  **ruling dialog** (ordered promotion pick from current standings),
  attach/detach match dialogs, «Отменить турнир» with confirmation.
- «Журнал» tab via the shared admin-page-tabs pattern: the audit feed
  filtered to the tournament (ADR-14 component reuse).

**Main page (`app/page.tsx`).** Above the global arena, the «Сейчас»
block of plain links: active camps (window contains today — ADR-27's
preloaded camp list) and tournaments with status `registration`/`running`.
Links only, no tables. The nav item becomes «Турниры» (camps live under
`/arenas?tab=camps`).

**Match form.** The tournament checkbox joins the camp checkbox group:
visible when the (edited) date/roster fits a `playing` slot, default
checked, editable on edit like the camp checkboxes (a linked match starts
checked, an unlinked one unchecked; changing it is the explicit
`skip_tournament_link` of the edit) — alongside ADR-27's camp checkboxes.
Offline: bracket acceptance is server-side at sync, so the queue carries no
tournament field (camp links do); the match card shows the slot/tournament
badge after refetch.

## Rollout

Phase 0 — **ADR-27 ships first** (camp arenas; `/tournaments` is
intentionally an empty page in the gap).

1. **Schema + registration API.** Migration (tournaments columns incl.
   `plan`, new tables, `audit_log` entity-type widening), pool CRUD,
   registration endpoints, OpenAPI regeneration.
2. **Plan enumerator.** Pure function + unit tests (seat multisets, uniform
   promotion bounds, bye-only-in-round-1, WB/LB state search, plan cap and
   ordering, the `n = 2` case needing a 2-seat game).
3. **Start + generation.** Plan validation against fresh enumeration,
   `plan` snapshot, eager generation of rounds/slots/seats, seeded draw,
   `GET /bracket`, tournament arena creation.
4. **Acceptance + points.** Slot matching in the match-write path
   (creation only), placement points, strict-cut completion, promotions,
   downstream seat filling; integration test: an 8-player single-elim run
   end-to-end on a 4-seat-only pool (4+4 promote-2 → final 4 promote-1),
   including a slot that needed a replay.
5. **Edit consistency.** 409 on association-breaking edits, points
   recompute, cascade invalidation, audit coverage; tests for overturning
   a promoted set and for ruling/reverting cascades.
6. **Organizer tooling + deadline.** Ruling, attach/detach, running
   adjustments, WB + LB plans with merge-to-final, grand-final deadline
   auto-cancel.
7. **UI: list + view.** `/tournaments` list, tournament page with
   registration button and bracket rendering, arena standings embed,
   main-page «Сейчас» links, nav rename.
8. **UI: organizer.** Edit page: pool editor, shape picker, ruling/
   adjustment/attach-detach dialogs, «Журнал» tab. Match form tournament
   checkbox (with camp checkboxes from ADR-27).
9. **Later:** rating-based seeding option, per-tournament organizer ACL.

Every frontend step: `pnpm --dir ./nextjs lint`, `pnpm --dir ./nextjs
test`, `pnpm --dir ./nextjs exec tsc --noEmit`. Backend: `go test -C
elo-web-service ./...` + integration tests via `make integration-test-one`.

Unit tests: enumerator cases above; points/completion (tie at cut, late
overturn, negative points); acceptance ordering. Integration tests
(testcontainers, `make integration-test-one`): full single-elim run, slot
replay, edit-cascade-void, WB+LB run with merge, deadline auto-cancel,
start rejection on infeasible configuration, self-registration flow, audit
documents round-trip (write → migrate → read).
