# Settlement rows are per-row checkpoints (plus indexing and growth policy)

## Problem

The settlement tables (`global_arena_settlement`, `game_arena_settlement`) mix
two roles in one row: a **ledger entry** (`elo_staked`/`elo_earned`,
`rating_staked`/`rating_earned`) and a **balance checkpoint**
(`elo_after`/`rating_after`). For most events those coincide — a match or a
correction writes one row per player — but a market settlement writes up to two
rows per player (`'market'` for the buy P&L, `'market_guarantor'` for the
residual share), and both carried the same event-total `*_after`. So the
per-row invariant

    after(row) = after(previous row of the player) + staked + earned

silently broke for buyer∩guarantor players, and the reader of a single row
could not tell which granularity the checkpoint had.

Separately, every settlement read is per-player (history, latest/at-date/
before-match lookups, the leaderboard's latest-per-player LATERAL), but no
index led with `player_id` — each probe scanned the whole table.

## Decision

### Rows are per-row checkpoints

Each settlement row's `*_after` is the player's balance after applying **that
row's** deltas; the invariant above now holds for every row. In
`SettleMarket` the role rows accumulate: the `'market'` row applies its P&L to
the pre-event balance, the `'market_guarantor'` row (written second, higher
client-generated ULID) adds the residual on top. The pre-event balances are
still read **once per player before any of their rows are written** — a second
read would observe the row just written (all rows share the settlement date).

The event-final balance lives on the last-written row, which is exactly the row
the `ORDER BY date DESC, id DESC` tie-break already picked, so every
latest/at-date/before-match read keeps returning the same values. Final
balances are mathematically unchanged; only intermediate checkpoint values of
dual-role rows moved, and the full-history replay (`POST
/admin/recalculate-global-elo`) rewrites stored history to the new semantics.
Column comments (migration 049) document the granularity in-schema.

### Index set (migration 048)

- `global_arena_settlement (player_id, date DESC, id DESC)` and
  `game_arena_settlement (player_id, game_id, date DESC, match_id DESC)` — the
  tie-break columns mirror the reads' ORDER BY, turning the per-player probes
  into index seeks.
- `match_scores (player_id, match_id)` — per-player match counts (league
  thresholds); the `(match_id, player_id)` PK only serves match-side lookups.
- `markets (resolution_match_id) WHERE resolution_match_id IS NOT NULL` — the
  match list probes "is any market resolved by this match?" per row.
- `player_club_membership (player_id)` — player-side club lookups.
- `bets (market_id, placed_at)` — price-history replay in placement order.

### Growth policy: append-only, no partitioning, no retention

The settlement tables grow with events (~400–600 rows/month at the time of
writing, linear). Partitions never approach the size where they pay off;
history is core product data (rating graphs, zero-sum auditing, replays), bets
are needed for price-history replay, and `audit_log` is deliberately permanent
(ADR-14). The only ephemeral table is `game_tables`, which already TTL-cleans
itself (ADR-18). No retention policy is deliberately adopted.

### No derived current-state table

A `player_rating_state` fast-fetch table would make leaderboard and prev-elo
reads single-row lookups, but at the indexed cost of O(log n) they are not a
bottleneck, and a derived cache would add a drift risk to every settlement
write path (match, market, correction, replay). Revisit only if the leaderboard
measurably regresses.
