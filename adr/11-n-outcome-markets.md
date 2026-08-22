# N-outcome markets with per-outcome identifiers

## Problem

Markets were strictly binary (YES/NO, ADR-10): the AMM state was two scalars
(`markets.q_yes`/`q_no`), bets carried the literal strings `yes`/`no`, the API
exposed flat `yes_*`/`no_*` field pairs, and the charts drew a single price
line. The `match_winner` market type framed each market as "does target player
T win a match that includes required players R…", which forced users to create
one market per candidate winner and treated ties at first place as a target
win.

We want markets with **any number of mutually-exclusive outcomes** — one
"player wins" outcome per target player plus a catch-all "other" outcome —
with GUID outcome identifiers used by all business logic and display names
derived on the fly.

## Decision

### Outcome model

Every market owns a set of outcomes stored in `market_outcomes`
(`id UUID PK, market_id, kind, player_id NULL, q FLOAT`):

- `kind = 'player'` (`player_id` set) — this target player is the **sole**
  first-place holder of the resolving match;
- `kind = 'other'` — tie at first place or a non-target winner (match_winner);
- `kind = 'yes' | 'no'` — the two fixed outcomes of a win_streak market
  (Да/Нет).

`bets.outcome` and `markets.resolution_outcome` reference outcome ids (both
`UUID` with FKs to `market_outcomes(id)`). Outcome **names are never stored**:
they are derived on the fly (player outcome → `players.name`, other →
Ничья, yes/no → «Да»/«Нет»), so player renames propagate everywhere
automatically. The identifier is the only thing business logic touches.

**Cancelled markets store `resolution_outcome = NULL`** — cancellation is
already carried by `markets.status`, and this keeps the invariant "every
non-null resolution_outcome is a real outcome id". The Go `OutcomeCancelled`
sentinel remains an in-process signal for the refund settlement path.

### match_winner semantics

`market_match_winner_params` becomes `(target_player_ids UUID[],
allow_other_players BOOL, game_ids UUID[])`:

- One `player` outcome per target plus the `other` outcome.
- A match resolves the market when it falls in `[starts_at, closes_at]`, matches
  the game filter, and **all targets participate**; when
  `allow_other_players = false` the match must consist of **exactly** the
  target players.
- A player outcome wins only when that player is the **sole** player holding
  the strict maximum score. Ties at first place — and non-target sole winners —
  resolve `other`. (Historically a tie counted as a win for every tied player;
  exclusive outcomes require a single winner.)
- Resolved markets' windows are pinned to the resolution match date (see
  Migration).

win_streak is unchanged semantically (ties still count as wins for streak
stats); it simply carries yes/no outcome rows like every other market type.

### Pricing: n-outcome LMSR

The binary LMSR generalizes to the outstanding-shares vector
`q ∈ ℝⁿ` (one component per outcome, stored in `market_outcomes.q`):

```
C(q)    = b · ln(Σᵢ e^(qᵢ/b))            // market cost
price_i = e^(qᵢ/b) / Σⱼ e^(qⱼ/b)          // Σ price_i = 1
```

Buying `shares` of outcome i costs `C(q + shares·eᵢ) − C(q)`. A fresh market
starts at q = 0, i.e. uniform prices 1/n. Guarantor worst-case loss grows from
`b·ln 2` to `b·ln n` — still bounded; `liquidity_b` is set at creation as
before. Settlement (winning share pays 1, guarantor residual split) was
already outcome-agnostic and carries over unchanged.

The price history endpoint replays the bet stream through the n-outcome LMSR
and returns the full price vector per bet; the market page draws one line per
outcome and a donut of the live probability split instead of the binary bar.

### API shape

`Market` replaces the flat `yes_*`/`no_*` pairs with
`outcomes: [{id, kind, player_id?, name, price, shares, pool}]` and adds
`resolution_match_id`. `MarketDetail` replaces `my_yes_*`/`my_no_*` with
`my_positions: [{outcome_id, staked, shares}]`. `PlaceBet.outcome` is an
outcome id. `CreateMarket` takes `target_player_ids` (1..12, deduplicated) +
`allow_other_players` for match_winner. Outcome collections are always
**arrays of objects**, never id-keyed maps (the idcodec middleware rewrites
`*_id` values, not map keys).

### Migration (SQL migration 041)

Deploy precondition, same style as ADR-10: **no open/betting_closed markets
exist** (the migration refuses to run otherwise — live yes/no bets cannot be
remapped to outcome ids). The backfill lives in SQL, not the Go data
migration, because sqlc compiles queries against the post-migration schema:
legacy columns (`target_player_id`, `required_player_ids`, `q_yes`, `q_no`)
must be dropped and `bets.outcome`/`resolution_outcome` retyped to UUID within
the migration itself.

**Payout preservation.** `bets.cost`, `bets.shares` and
`global_arena_settlement` are never touched. Each historical bet is remapped
so its win/lose status is preserved:

- the new winning outcome is derived from the resolution match itself (sole
  first-place player's outcome when that player is a target, else `other`);
- bets on the historically winning side map to the new winning outcome;
- losing-side bets map to `other` when a player outcome won, and to the old
  target player's outcome when `other` won (tie) — mapping them to `other`
  would flip losers into winners.

This matters for ties (old rule: tie = target wins = "yes") and for markets
whose required player was the sole winner (old "no" winners follow that
player's new outcome). Resolved match_winner markets get
`starts_at = closes_at = resolution match date` so a recalculation re-links
exactly the same match and reproduces the settlements byte-for-byte.
`market_outcomes.q` is seeded to the outstanding share sum per outcome (the
invariant every market satisfies).

Params restructure: `target_player_ids = required_player_ids + target`
(deduplicated), `allow_other_players = true` (preserves the old "extra players
allowed" semantics; the set of resolving matches is unchanged for historical
markets).

The completed pre-LMSR share backfill (ADR-10's `migrateMarketShares`) was
removed along with its tests; the calculator data migrations (ADR-09) are
permanent machinery and stay.

## Consequences

- `market_outcomes` is the outcome registry; per-outcome `q` is the AMM state.
- `bets.outcome`/`markets.resolution_outcome` are UUIDs with FKs; cancelled ⇒
  NULL outcome.
- The `Market`/`MarketDetail`/`PlaceBet`/`CreateMarket`/price-history API
  shapes changed incompatibly (single frontend client, regenerated together).
- The SSE prices event carries `outcomes: [{id, price, shares, pool}]`.
- Outcome names derive from players on the fly; the UI resolves player
  outcomes through its player context for club icons etc., falling back to the
  API-provided name.
- Guarantor exposure per market is `b·ln n`; creation caps match_winner
  targets at 12.
- Migration rehearsal against the prod copy verified settlements are
  byte-identical and every resolved market's winning bets still win (including
  the five markets whose required player was the sole winner).
