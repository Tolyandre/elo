# 39. Offline replica v3: complete replay inputs + incremental re-mirroring

Date: 2026-11-13

## Context

ADR-38 shipped the offline settlement replay with deliberate gaps. Three of
them showed up in practice:

1. **Cold replicas crashed out of the replay with the console error
   `settlement replay failed: no elo settings history`.** The settings
   history mirror ran only inside `hydrateRatingsReplica`, which itself ran
   only after a sync that pushed at least one item — a fresh install, a user
   who only opened an arena view, or one failed `GET /settings/all` left the
   replay without its hard requirement.
2. **Degrade cases**: stint-based tenant openness modes (`any_member` /
   `members_only`), camp/tournament link-only arenas, and tag-filtered arenas
   all rendered replica values only, because club stints, match→arena links
   and game tag ids were never mirrored.
3. **Every successful push re-downloaded everything**: the full tenant match
   history (at 30-row pages — the drain asked for 2000 but the endpoint clamps
   to 100), the full settlement ledgers of the main arena and every viewed
   arena (wholesale replace), players, games, settings. No incremental fetch
   existed anywhere: no `updated_at` on matches, no `since` parameters, no
   ETags (ADR-37 had already named the missing primitives).

The audit log was ADR-38's candidate backbone for a change feed, but it does
not cover markets, settlements or recalculations, and its read endpoint scans
backwards only — it would need new parameters and still miss the hottest
data. Simpler per-entity change signals cover every mirror this design needs.

## Decision

### 1. Every Elo-participating entity mirrors into Dexie (version 6)

The replay's inputs are now complete. New tables:

- **`arenasList`** — the `GET /arenas?kind=…` responses (games, camps,
  tournaments), verbatim. Their settings documents back the camp and
  tournament arena replays; their fingerprint columns (below) gate the
  ledger drains; the list backs offline arenas browsing.
- **`clubStints`** — each club's `GET /clubs/{id}/members/history` stint
  rows. Mirrored only for stint-based tenants (`arena_membership_mode !=
  "all"`), whose modes actually consult them.
- **`tournaments`** — the tournaments list (small, wholesale replace).
- **`meta`** — the sync state: per-tenant match cursors, per-arena
  settlement fingerprints, the per-tenant last-hydration stamp.

Existing rows extend additively: `matchReplica` rows carry
`campArenaIds` (from `Match.camps`) and `tournamentId` (from
`Match.tournament`) — the `arena_matches` links the link-only flavors'
membership is; `entityGames` rows carry their tags — the tag filters'
`game_tag` probe. Old rows lacking the fields count as unlinked/untagged;
the first version-6 hydration rewrites the current tenant's rows in full.

### 2. Membership evaluated exactly like the server's predicates

`arenaMembership` (engine) now implements all three flavors:

- tenant arenas — `all` admits every competitive match;
  `any_member`/`members_only` evaluate stint coverage at the match date
  (`joined_at <= date`, open or `left_at > date`; a null `joined_at` is the
  -infinity backfill) over the tenant's `club_ids`, mirroring
  `tenant_arena_contains_match`. A tenant whose clubs lack the mirror
  degrades (a wrong exclusion would be worse than no overlay).
- camp/tournament arenas — the explicit match link
  (`arena_contains_match`'s `p_link`).
- filter arenas — unchanged, plus working tag filters via the games mirror.

### 3. Incremental re-mirroring without a change feed

Two cheap primitives, no new infrastructure:

- **`matches.updated_at`** (migration 086, the games-timestamps pattern):
  default at creation, a trigger keeps it on no-op saves, and child triggers
  on `match_scores` and `arena_matches` bump the parent stamp — scores and
  camp/tournament links are visible through `GET /matches` via joins, so
  they count as match changes. Settlement rewrites deliberately do **not**
  bump it: the replica carries no settlement columns.
  `GET /matches?updated_since=` returns only newer rows (the cursor token
  does not carry the value — continuation requests repeat it, like
  `?tenant=`). The client stores one cursor per tenant and upserts; matches
  are never deleted, so no tombstones are needed.
- **The arena settlements fingerprint** — a per-arena
  `(count, last_date, last_id)` triple on the `Arena` wire shape (list and
  detail). Every write path inserts fresh UUIDv7 settlement ids, so an
  append or a recalculation re-insert changes the triple, and backdated
  appends (offline matches) change the count. `ListArenas` embeds it via a
  `LIMIT 1` LATERAL; the detail read uses a dedicated single-arena query.
  The client skips a ledger drain while its stored triple matches, and
  stores the fingerprint after each full drain (the arena-view write-through
  stores it from the detail response).

Players/games keep their small wholesale replace; their incremental pull is
future work once catalogs grow.

### 4. Hydration triggers

`hydrateRatingsReplica` becomes the incremental refresh and runs:

- after every successful push (as before, now cheap when nothing changed);
- on app mount/navigation/tenant switch when online, throttled per tenant
  (15 minutes, `meta.hydrated-at:<tenantId>`) — a cold replica no longer
  waits for the first push;
- the arena-view write-through stays, now also storing the fingerprint and
  ensuring the settings history (`ensureSettingsHistory`).

Every step is isolated: a failure logs, keeps its own cursor/fingerprint,
and the remaining steps still run. A cold settings series is mirrored by the
ratings provider on mount when online, and the replay skips quietly
(`console.info`) instead of surfacing the wasm core's
`no elo settings history` error when the series is still absent.

## Consequences

- All arena flavors the server settles now recalculate offline; the
  remaining degrade cases are genuinely cold mirrors, healed by the first
  online refresh.
- An unchanged refresh costs the arenas lists, settings, tournaments and
  stint fetches — a handful of small calls; ledgers and match history come
  down only when they actually changed.
- The migration backfills `matches.updated_at` from the audit trail;
  matches created before ADR-14 keep the column default.
- The fingerprint's newest-row columns are absent on an empty ledger
  (`settlements_count: 0` only); the client normalizes missing to null.
- Not covered: deletions of players/games still reconcile via the next
  wholesale replace; offline player stats pages and snapshot+tail
  partitioning remain future work (ADR-38), as does the players/games
  incremental pull.

## References

- ADR-37 — the replica and its named future primitives (`updated_at`,
  `?updated_since=`, the matches replica); superseded in that section.
- ADR-38 — the replay and its named future work (club-stint replication,
  the change-feed cursor); superseded by §1–§3, with the audit log rejected
  as the backbone (no settlement/market coverage, backwards-only reads).
- ADR-24 / ADR-27 / ADR-28 / ADR-36 — the arena flavors and the membership
  predicates the client now mirrors.
