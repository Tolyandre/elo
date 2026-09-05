# Probability vs cost: distinct names for what a share pays and what a buy charges

## Problem

The LMSR marginal price and the elo a purchase actually charges were both
called "price", and the UI showed the wrong one where it mattered. The market
page's share-buy mode ("Цена голоса") displayed `outcomes[].price` — but that
field is the LMSR marginal price, i.e. the outcome **probability**. What the
"Купить 1 голос" click actually charges is the cost integral
`C(q + e_i) − C(q)`, which equals the probability only for an infinitesimal
share. With deep markets (default liquidity) the two are visually identical,
but with thin ones they diverge sharply: a 2-outcome market with max guarantor
loss `L = 1` has `b = L/ln 2 ≈ 1.44`, and while the opening probability is 0.5
(the donut says 50%), the first share costs `b·ln((e^{1/b}+1)/2) ≈ 0.585`.
Users saw "0.50" and paid "0.58" with no explanation.

The codebase compounded the confusion: `MarketOutcome.price` was a probability,
the `PlaceBet` response `price` was a per-share cost, and the price-history
endpoint replayed probabilities under a price name. DB naming was already
correct (`bets.cost` is elo spent, `market_outcomes.q` is the AMM state;
prices/probabilities were never persisted).

## Decision

**Probability and cost are two named quantities, never both "price":**

- **probability** — the LMSR marginal price `e^(q_i/b) / Σ_j e^(q_j/b)` in
  (0,1), summing to 1 across outcomes. This is what the donut segment sizes,
  what the (renamed) probability-history chart draws, and what the buy
  staleness check (409) compares against. Everywhere: `outcomes[].probability`,
  SSE `probabilities` event with `outcomes[].probability`,
  `GET /markets/{id}/probability-history` (`points[].probabilities[].probability`),
  `PlaceBet` request `expected_probability`, Go `MarginalProbabilitiesN`,
  `PriceTolerance` → `ProbabilityTolerance`.
- **cost** — elo spent. The buy response field is `cost_per_share`
  (amount/shares); a market's spent elo per outcome stays `pool`; stored elo
  cost stays `bets.cost`. The cost of buying `s` shares is always
  `C(q + s·e_i) − C(q)` — never derived from the probability.

**The outcome card shows cost where cost is what happens.** On an open market
in share mode the card headline is the live cost of the next 1-share buy
(computed client side by `costForShares` from the streamed AMM state `q` +
`liquidity_b`, exactly the server's formula), captioned «цена 1 голоса», so
the headline always matches the button's charge. The amount mode keeps its
`×N` multiplier (captioned «голосов за 1 рейтинг»). When the market is not
buyable, the card falls back to the probability — the next-share cost is
meaningless without a next buy. The donut and the probability chart are
untouched: they were and remain probabilities.

Renaming is a breaking API change (single frontend client, regenerated
together — the ADR-11 precedent).

## Consequences

- The displayed-cost/probability divergence is now visible and honest: a thin
  market shows «0.58 / цена 1 голоса» next to a 50% donut segment instead of
  silently charging more than the headline.
- `costForShares` (frontend, `app/markets/lmsr.ts`) mirrors the server's
  `ApplyBetN` cost; both derive from the streamed `q`, so the card reprices
  live over SSE with no extra endpoint.
- `PriceBet` (the replay step) keeps its name — it describes a bet, not a
  price; the output types are `ProbabilityPoint`/`OutcomeProbability`.
- No DB migration: `bets.cost`, `market_outcomes.q`, `markets.liquidity_b`
  already say what they mean.
- The client keeps a second copy of the LMSR cost math (alongside
  `sharesForAmount`); acceptable while the AMM is this small, and both copies
  are pinned by cross-checked tests (`market-buy.test.ts`,
  `pkg/elo/amm_test.go`).
