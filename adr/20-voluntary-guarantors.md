# Voluntary guarantors as liquidity providers (with maker fees)

## Problem

ADR-10 made the market creator designate guarantors at creation time and split
the settlement residual equally among them. Two problems with that:

- **No consent.** Designating someone a guarantor without their agreement is an
  awkward social situation — they are exposed to a loss they never accepted.
- **No reward.** Guarantors carried the whole market risk for nothing in return,
  and their exposure was deliberately *not* reserved against the betting limit
  (ADR-10), so it was also invisible in the UI.

We want guarantee to be **voluntary and the risk rewarding**: any player can
back an open market with a wager of {risk amount, maker fee}, the market's
liquidity grows with the wagers, and the guarantors earn the trading fees their
capital makes possible.

## Decision

### Markets are created without guarantors

`CreateMarket` no longer takes guarantors. It takes `max_guarantor_loss` (L,
defaulting to `elo_settings.market_default_max_guarantor_loss` = 16): the cap on
the combined risk that wagers can turn into liquidity. New markets start with
`liquidity_b = 0`.

### Guarantees: immutable wagers {risk, fee}

A new table `market_guarantees(id, market_id, player_id, risk_amount, fee_rate,
created_at)` holds the wagers (client-generated id — idempotency key,
offline-queue compatible). `POST /markets/{id}/guarantees` places one on an open
market; a player may hold several; wagers cannot be withdrawn. The risk amount
is the guarantor's **honest maximum loss** and is reserved against the betting
limit (supersedes the ADR-10 exemption).

### Dynamic liquidity, honest units, preserved prices

- `b = min(L, Σrisk) / ln(n)` — recomputed as wagers arrive. The `min` keeps
  each guarantor's worst-case loss at their risked amount (combined worst case
  `b·ln(n)`). Wagers over-subscribing L are accepted in full (they still earn
  fees and bear losses, proportional to risk) but add no liquidity.
- **b = 0 is untradable.** In the b→0 limit the LMSR degenerates to
  `C(q) = max(q)`: favorites cost exactly 1 (pointless) and underdogs cost 0 —
  free lottery tickets with nobody to pay the winners. Bets on a guarantor-less
  market are rejected (409); the UI shows the uniform 1/n prices (the exact
  q=0 limit) and "ждёт поручителей".
- **Price-preserving injection.** Raising b with q fixed snaps prices toward
  1/n — a phantom chart move and an arbitrage against the new guarantor. Instead
  every join rescales `q ← q·(b_new/b_old)`, which preserves all probabilities
  exactly (`p_i` depends only on `q/b` ratios). Shares live in `bets` and
  payouts read them, so settlement is untouched by rescales; a join also cannot
  trigger a spurious "probability changed" 409.
- **Price history** is replayed from the merged timeline of bets and wagers
  (ordered `(at, kind, id)`, guarantee before bet at equal time): wagers change
  b and rescale q in the replay. Nothing price-shaped is persisted.

### Maker fee: variance-proportional (Kalshi-style)

The market's fee `c` is the **risk-weighted mean** of the wagers' fee rates,
each capped at 0.25 (the schema enforces it, so the mean is capped too). The
buyer's marginal price becomes

```
p_u = p + 4c·p(1−p)
```

— the same shape Kalshi charges in production (fee ∝ price·(1−price), the
Bernoulli variance): the surcharge peaks at exactly c for p = 0.5 and vanishes
at p → 0/1, and `c ≤ 0.25` is exactly the bound that keeps `p_u ≤ 1`.
Alternatives rejected: ad-valorem `p(1+c)` relatively overcharges longshots; a
flat per-share fee overcharges favorites. Because a buy moves only one q
component, the total fee for a buy has the closed form `fee = 4c·b·Δp_i`
(`BuyFeeN`, mirrored client-side in `app/markets/lmsr.ts`) — no numeric
integration, exact for any outcome count. The fee is snapshotted on the bet row
(`bets.fee`), keeping settlement a pure function of immutable rows.

### Settlement: two pots, first-loss waterfall

- **Fee pool** (Σ `bets.fee`), attributed time-windowed: each bet's fee is
  shared only among wagers placed no later than the bet, weighted `fee·risk` —
  a late joiner cannot free-ride on fees charged before they joined.
- **Equity residual** (Σ costs − Σ winning shares, fees excluded):
  - surplus → pro-rata by risk over all wagers;
  - deficit → first-loss waterfall: fee-charging wagers pay first (weighted
    `fee·risk`, each capped at their risk), everyone else backs them up
    pro-rata by remaining risk. Zero-fee guarantors are the senior tranche.

The combined worst case is `b·ln(n) = min(L, Σrisk) ≤ Σrisk`, so the waterfall
always fully allocates. Buyers' stakes include the fee; cancelled markets refund
cost + fee. Each distribution assigns the FP remainder deterministically
(sorted-by-id last), so the per-wager results sum to the pots exactly and elo
stays strictly conserved — and settlement remains replay-safe
(`unsettle → re-settle` is byte-identical) because it is a pure function of the
immutable `bets` and `market_guarantees` rows. The resolved market shows the
total commission it generated (`fee_collected = Σ bets.fee`).

### Migration (046)

Existing markets' designated guarantors become equal, zero-fee wagers:
`risk = L / guarantor_count` (Σrisk = L), `created_at` backdated to market
creation. `max_guarantor_loss` is recovered as `liquidity_b·ln(n)` (b was fixed
at creation as L/ln(n), migration 043). Equal zero-fee risks reproduce the old
equal residual split *identically* (empty fee pool + pro-rata equity = equal
shares), so old settlements replay unchanged.

### Concurrency

`PlaceBet` and guarantee joins lock the market row (`SELECT … FOR UPDATE`),
serializing read-compute-write cycles on the AMM state (this also closes a
pre-existing lost-update window on concurrent same-outcome bets).

## Consequences

- The creator no longer picks guarantors; the market page carries a
  "Поручители" section (wagers with fees and risks, a join form, an explainer
  with the 5%-at-0.5 fee example) and shows the current market fee; buys quote
  all-in prices ("в т.ч. комиссия").
- Guarantor exposure consumes the betting limit, so the reserved line on the
  market page and the 422 checks now include wager risk.
- Over-subscription beyond L is accepted but announced as such ("риск сверх L
  не увеличивает ликвидность") — accepted trade-off: simple writes, allocations
  stay risk-proportional.
- Known edge (documented, harmless): through a timestamp inversion of
  concurrently committed rows a bet's fee could be attributed by the
  conservation fallback (all wagers) instead of its strict time window; the
  attribution stays a pure function of stored rows either way.
