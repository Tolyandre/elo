# Share markets (Polymarket-style) with LMSR + guarantors

## Problem

Markets were pure pari-mutuel: a bet stored only `(outcome, amount)`, and the
coefficient shown to users was `totalPool / pool` recomputed live on every read.
The actual payout was fixed at **resolution** time inside `SettleMarket`, where
each winner got `(stake / winningPool) * totalPool`. Bettors never knew their
odds at placement time — the number they saw moved under them as others bet.

We want a **Polymarket-style share market**: users **buy** YES/NO shares at a
**price ∈ (0,1)** that reprices after every purchase; at resolution every winning
share pays **1**. On top of that:

- **strict elo conservation** — rating must not appear or disappear; the sum of
  wins equals the sum of losses across all participants;
- **lossless migration** of historical bets so a historical match edit and the
  subsequent recalculation reproduce identical rating outcomes;
- **live prices on the buying page** — the price ticks as others buy;
- an **automatic market maker** that reprices after every purchase.

## Decision

### Pricing: LMSR (Logarithmic Market Scoring Rule)

A binary-outcome LMSR is the pricing engine (pure math in `pkg/elo/amm.go`):

```
C(q_yes, q_no) = b · ln(e^(q_yes/b) + e^(q_no/b))      // market cost
price_i        = e^(q_i/b) / (e^(q_yes/b) + e^(q_no/b)) // p_yes + p_no = 1
```

A purchase is **shares-driven**: the buyer asks for `shares` winning tokens (the UI
always buys 1 share per click) and pays the AMM cost
`amount = C(q_i+shares, q_k) - C(q_i, q_k)` directly. The displayed price is the
marginal `price_i` (it moves with every purchase, and approximates the cost of the
next share); the buyer's effective price is `amount / shares`. Buying shifts `q_i`,
so the next buyer sees a new price. The AMM state (`q_yes`, `q_no`, `b`) lives on
the market.

At resolution each **winning share pays 1**; losers get nothing.

Chosen over **pool-ratio** (`1 + opposite/current`, the old `calcCoefficient`):
simplest, but the first buy on an empty side is infinite (needs clamping) and
guarantor exposure is unbounded. LMSR gives smooth, bounded prices and a
**bounded guarantor worst-case loss of `b · ln 2`** per market, where
`b = markets.liquidity_b` is set at creation (default
`elo_settings.market_default_liquidity_b`).

### Data model

`bets` stores `outcome`, `amount` (the elo cost the AMM charged), and `shares`
(the tokens bought — the input of the purchase). `amount` is derived from `shares`
at placement time and is what is reserved against the buyer's `bet_limit`, so the
existing spend-limit cap applies unchanged (with 1-share buys the cost is bounded
by the price ∈ (0,1)). The displayed coefficient/odds concept is gone — the UI
shows **prices** (`Market.yes_price` / `no_price`) and, per user, **shares held**
and **elo spent** (`my_yes_shares` / `my_yes_staked`).

### Conservation: guarantors as the zero-sum counterparty

Share payouts do not, in general, balance: `Σ winningShares` need not equal the
total spent. The residual

```
residual = Σ amount (all buys) − Σ shares (winning side)
```

is split equally across the market's **guarantors** — players selected at market
creation (the creator's player is prefilled). Guarantors are the symmetric house:
they pay deficits (`residual < 0`) and keep surpluses (`residual > 0`). This
keeps elo strictly conserved:

```
Σ (elo_staked + elo_earned) over {buyers ∪ guarantors} = 0
```

A market with buys but no guarantors cannot conserve elo, so `CreateMarket`
rejects it (`ErrMarketNeedsGuarantor`). A player who is both buyer and guarantor
(e.g. the creator) gets **two separate settlement rows**: a `market` row carrying
the buy P&L and a `market_guarantor` row carrying their residual share — so the
value change per bet and the guarantor payout/surcharge are individually visible.
The `UNIQUE (market_id, player_id)` index is widened to
`UNIQUE (market_id, player_id, discriminator)` to allow both. Because the
rating/elo chain reads the "latest" settlement at a date (tie-break `id DESC`,
effectively random within one instant), **both rows store the player's correct
post-market balance** (`*_after = base + total delta across both roles`), while
their `elo_staked`/`elo_earned` columns keep the per-role split that feeds the
display and the zero-sum invariant. The residual split assigns the floating-point
remainder to the last guarantor so the shares sum to the residual exactly.

Guarantors live in `market_guarantors(market_id, player_id)`. Their exposure is
**not** reserved against `bet_limit` (uncapped by design, but bounded by `b·ln 2`).

### Settlement replay-safety

`bets.shares` is immutable once written. The recalculation engine
(`EventProcessor.RecalculateFrom`) wipes `global_arena_settlement` and re-runs
`SettleMarket` over the **existing bets**, so re-settlement is byte-for-byte
identical — historical rating is preserved across match edits.

### Migration (resolved/cancelled markets only)

Deploy precondition: the migration runs when **no open/betting_closed markets
exist**, so every historical market is resolved or cancelled. The in-process data
migration (`pkg/db/migrate_data.go`) backfills `bets.shares` only for markets with
`q_yes = 0 AND q_no = 0` — the signature of pre-LMSR markets (any LMSR buy writes
non-zero `q_*` via `UpdateMarketAMMState`, so real LMSR shares are never
overwritten). For each resolved market the winning side gets
`shares = amount × totalPool/winningPool`, which makes `shares × 1` reproduce the
historical pari-mutuel payout exactly; the losing side gets the symmetric
`amount × totalPool/losingPool`. The resulting residual is 0, so **no guarantor
rows** are produced and historical elo is unchanged. The backfill is deterministic
and idempotent.

### Live prices over SSE

A new in-process `MarketsHub` (mirroring `SkullKingHub`) fans price/pool updates
to `GET /markets/:id/events` after every purchase, and a `GET /markets/lobby/events`
signal lets the markets-list page refetch. The frontend reuses the self-healing
`EventSource` pattern from the Skull King live game
(`nextjs/hooks/useMarketsSSE.ts`). Like Skull King, this is **single-backend-instance
only** (no Redis pub/sub). Prices are always recomputed server-side from AMM state
and never trusted from the client.

## Consequences

- `bets.shares` (FLOAT) is a new required column; historical rows are backfilled
  by the data migration. `bets.amount` is the AMM-derived cost of `bets.shares`.
- `markets` gains `liquidity_b`, `q_yes`, `q_no`; `elo_settings` gains
  `market_default_liquidity_b`; new `market_guarantors` table; the settlement
  uniqueness widens to `(market_id, player_id, discriminator)` (migration `039`).
- `Market.yes_coefficient/no_coefficient` are replaced by `yes_price/no_price`
  (∈ [0,1]); `MarketDetail.projected_*_reward` by `my_*_shares`.
- `PlaceBet` takes `shares` (the UI always sends 1 — the amount input is gone)
  and returns `{shares, price}`; `CreateMarket` requires and stores guarantors.
- Each market card shows buyers (`settlement`) and guarantors
  (`guarantor_settlement`, role-specific rows) separately; the match result page
  lists the linked market cards only — no extra aggregated guarantor rollup.
- N-outcome markets remain possible at the type level (`MarketOutcome` allows
  free-text), but the AMM and UI ship for binary YES/NO only.
