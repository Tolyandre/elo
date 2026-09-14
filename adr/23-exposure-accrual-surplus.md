# Exposure-accrual surplus split for guarantors

Revises the surplus half of ADR-20's settlement section ("a surplus is split
pro-rata by risk"). The fee pool, the deficit waterfall and the fee mechanics
are unchanged.

## Problem

Splitting the settlement surplus pro-rata by final risk ignores *when* and
*for what* a guarantor's capital was actually at stake:

- A guarantor joining after all the trading — with the book already
  collateralized by the collected costs — took essentially no risk, yet
  collected a full risk-proportional share of the surplus (dev market
  `01a09ff0`: the late 4-risk guarantor took 97.6% of a 13.0 pot his capital
  never backed, while the early thin guarantor who stood alone during the
  market's only volatile window got 2.4%).
- Wall-clock duration leaked into nothing; there was no way to reward the
  guarantor who backed a market through its busy window versus one who joined
  for the quiet tail.

## Decision

The surplus is split by **exposure accrual**, computed by replaying the
market's bet stream in `placed_at` order (the same replay style as the
price history and the ADR-22 solvency analysis — a pure function of the
immutable `bets` and `market_guarantees` rows, byte-identical on
unsettle → re-settle):

- Maintain `q` (outstanding shares per outcome) and `collected` (Σ bet costs)
  while replaying. At every **bet** — and only at bets, making the split
  sequence-only: identical event sequences yield identical splits regardless
  of wall-clock spacing — sample the house's live worst-case liability

  ```
  V = max( max_i Q_i − collected , ρ · min(L, Σrisk_active) )
  ```

  i.e. the currently uncovered outstanding shares, floored at the **standby
  rate** ρ = 0.1 (hardcoded) of the current liquidity envelope. `V` is
  credited to the wagers **active at that bet** (`created_at ≤ bet time` —
  the fee pool's window; on a timestamp inversion, all wagers, as
  `activeFeeWeights` does) in proportion to their risk.

- The surplus is then split ∝ the accrued totals. If no event was ever
  sampled (degenerate), the split falls back to the plain risk-proportional
  split.
- The fee pool and the deficit waterfall keep their ADR-20 rules: fees stay
  attributed time-windowed weighted `fee·risk`, and on a deficit fee-charging
  wagers pay first, capped at their risk. Guarantors still never lose more
  than their risk (ADR-22's hard cap).

## Properties

- **Join moment matters through the sequence.** Joining before the trading
  means backing more events; joining a safe, post-trading book earns only the
  standby floor on whatever trades still follow.
- **Created liability earns more than idle capital.** A mid-price buy raises
  `max_i Q_i` by more than it raises `collected` — the trades that genuinely
  endanger the house pay the biggest samples to whoever stood behind them.
  ≈1.00 favourite buys are self-financing (`ΔmaxQ ≈ Δcollected`) and accrue
  only the floor.
- **Standby floor** (`ρ = 0.1`, hardcoded — not expected to be tuned per
  deployment): idle capital earns a per-trade royalty in proportion to the
  trading it enabled, keeping the split well-defined (Σ accruals > 0 whenever
  a bet was backed) without rewarding pure wall-clock idleness.
- Zero-sum conservation is preserved exactly: the accruals only *weight* the
  split of a fixed pot; the deterministic remainder assignment in `allocate`
  keeps the per-wager shares summing to the pot.

## Consequences

- `settleGuarantors` takes the market's `max_guarantor_loss` (immutable after
  creation) to evaluate the envelope, and settlement now replays the bet
  stream a second time (it already did for the fee pool's windows).
- Equal-risk guarantors no longer split a surplus equally when their backing
  windows differed — that is the point.
- No schema or API changes: payouts surface through the existing settlement
  rows and guarantor-payout rollup.
