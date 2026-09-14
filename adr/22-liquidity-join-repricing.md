# Liquidity joins reprice the market (q-rescale removal)

Supersedes the "Price-preserving injection" and "Price history" bullets of
ADR-20; everything else there stands.

## Problem

ADR-20 made a guarantee join preserve prices by rescaling the AMM state
vector together with the liquidity parameter: `q ← q·(b_new/b_old)`, which
keeps every probability `p_i` identical because it depends only on the `q/b`
ratios. The argument for why settlement is unaffected was that settlement
reads the `bets` rows, not `q`.

That is exactly the flaw. The LMSR guarantee "the maker loses at most
`b·ln(n)`" is proved over the cost **accumulated from the creation state
q=0**: `collected = C_b(q) − C_b(0)`. Scaling q by `k = b_new/b_old` silently
multiplies that implied cost function by `k` — `C_{kb}(kq) = k·C_b(q)` — while
the real collected elo and the shares stored in `bets` stay unscaled. After
the rescale the AMM prices new buys as if `k` times more money had entered
the market than actually did.

Concretely (dev market `01a09faa`): a 3-outcome market with one guarantor
risking 0.1 (`b₁ = 0.1/ln 3 ≈ 0.091`), three one-share buys of the favourite
(q ≈ 3.1, collected ≈ 3.0, favourite priced 1.00), then a second guarantor
risking 4 (`b₂ = 4.1/ln 3 ≈ 3.73`, rescale factor k = 41 → q ≈ 127). The
underdog's probability — unchanged by the rescale — is `e^{−q/b} ≈ 10^{−15}`,
so a 1-elo all-in buy delivered **122.59 shares**. Had the underdog won, the
payout (122.6) would have exceeded collected + guarantor risk (4.0 + 4.1) by
two orders of magnitude: the waterfall covers only Σrisk and the remainder
was parked on the largest-cap guarantor by a branch that assumed deficits
beyond Σrisk impossible.

## Decision

**A guarantee join changes only `b`.** q is never rescaled. Prices move toward
the uniform `1/n` vector — the honest repricing of the same order flow against
deeper backing (with `b` = 4.1/ln 3 the same q ≈ 3.1 favourite prices at
≈ 0.53, not 1.00). Open positions keep their stored shares and costs; only
the forward prices move. Clients holding a stale `expected_probability`
across a join get the normal 409 drift rejection and refetch.

With q fixed the accounting identity survives every b increase, and the bound
holds at the **new** liquidity for all futures:

```
loss_i = max_i Q_i − collected ≤ C_b(q) − collected ≤ (b_new − b_old)·ln n + b_old·ln n = b_new·ln n ≤ Σrisk
```

so a sole guarantor's worst case stays exactly their risked amount, however
many joins arrive. (The `sup` of `C_b(q) − C_b(0)` over reachable q is
`b·ln(n)`, attained in the uniform-saturation limit.)

**The first-loss waterfall is hard-capped.** If a deficit exceeds the combined
risk — impossible under the accounting above, but reachable from pre-repair
states — no wager is charged beyond its risk; the uncovered remainder is
dropped (bounded elo destruction) instead of bankrupting a guarantor.

**Startup repair (one-time, idempotent).** Without rescales
`q = Σ bets.shares` always holds, so divergence detects every affected
market. On boot the service:

1. recomputes every outcome's q from its stored bets;
2. keeps open markets whose repaired state is still solvent
   (`max_i Q_i − collected ≤ min(L, Σrisk)`) — they resume at the honestly
   repriced probabilities;
3. cancels the rest — the post-rescale shares are liabilities the backing
   cannot cover, and honouring them would create elo from nothing.
   Cancelling refunds every bet (cost + fee), making all participants whole.

## Consequences

- Prices move visibly when a guarantor joins a traded market; the market page
  receives the new probabilities over SSE at join time.
- Buy quotes always match what the AMM delivers: underdog exposure costs real
  elo proportional to the market's actual backing.
- The rescale SQL query was removed; the probability-history replay follows
  the same rule (wagers only step `b`).
