# Guarantor risk fully converts to liquidity (the L cap removal)

## Problem

ADR-20 gave every market an explicit `max_guarantor_loss` (L): the cap on the
combined guarantor risk that wagers could turn into liquidity,
`b = min(L, Σrisk)/ln(n)`, set at market creation with a settings default
(`elo_settings.market_default_max_guarantor_loss` = 16). In practice:

- **The cap threw backing away.** Once Σrisk passed L, late guarantors still
  reserved their full risk against their betting limit (and bore losses
  pro-rata) but added no depth — a guarantee that costs the same and buys
  less than nothing.
- **The knob had no audience.** The creator had no basis to pick L per market;
  every market just ran at the default until wagers over-subscribed it, which
  is precisely the case the cap punishes.
- **The envelope drifted from the reservation.** The ADR-23 standby floor used
  `min(L, Σrisk)` — an envelope smaller than the risk guarantors actually
  reserved — and the UI had to display "обеспечили X из L" with an
  over-subscription footnote to explain the mismatch.

The invariant that matters — no guarantor loses more than the amount they
wagered — never needed L: the combined worst case of the LMSR is `b·ln(n)`,
and with `b = Σrisk/ln(n)` it equals Σrisk exactly, with the settlement
waterfall capping each wager at its own risk on top (ADR-22's hard caps).

## Decision

**Every wagered elo converts to depth: `b = Σrisk/ln(n)`.** The L cap is
removed whole:

- `CreateMarket` no longer takes `max_guarantor_loss`; the settings column
  `elo_settings.market_default_max_guarantor_loss` and the per-market
  `markets.max_guarantor_loss` are dropped (migration 067).
- `liquidityBForRisk(totalRisk, n) = totalRisk/ln(n)`; the standby envelope of
  the ADR-23 exposure accrual becomes plain `Σrisk_active` (the standby rate ρ
  = 0.1 is unchanged).
- Settlement, the fee pool, the first-loss waterfall, the maker fee, the
  reserved-against-bet-limit rule and the untradable b = 0 state are all
  unchanged.

## Consequences

- Over-subscription is no longer a state: wagers always deepen the market, and
  prices always move toward the uniform 1/n vector on a join (ADR-22
  mechanics, no rescale).
- A guarantor's maximum loss is still the amount they risked — now enforced
  solely by `b·ln(n) = Σrisk` plus the per-wager waterfall caps, instead of an
  independently set cap.
- The creation form loses the L field; the market page shows the guaranteed
  total (no "из L" ceiling); the help page and the playground drop the L
  slider and the `min(L, …)` term of the liquidity and standby formulas.
- Historical rows replay consistently: the probability history recomputes b
  from the wager stream alone, and a re-settled market derives everything from
  the immutable bets and wagers — the dropped column was never an input to
  either beyond the cap this ADR removes.
