// New-market form constants. Since guarantees became voluntary (ADR-20), the
// form no longer derives the LMSR liquidity parameter: markets are created
// without liquidity, and it grows as guarantor wagers arrive, bounded by the
// requested max guarantor loss L (b = min(L, Σrisk)/ln(n), computed server
// side — see elo-web-service/pkg/elo).

export type MarketType = "match_winner" | "win_streak";

/** Default max guarantor loss, mirroring elo_settings.market_default_max_guarantor_loss. */
export const DEFAULT_MAX_GUARANTOR_LOSS = 16;
