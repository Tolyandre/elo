// Liquidity derivation for the new-market form. The UI asks for the
// guarantors' worst-case combined loss L; the market maker takes the LMSR
// parameter b = L/ln(n), since b·ln(n) bounds that loss for n outcomes
// (see elo-web-service/pkg/elo/amm.go and elo_settings.market_default_max_guarantor_loss).

export type MarketType = "match_winner" | "win_streak";

/** Default max guarantor loss, mirroring elo_settings.market_default_max_guarantor_loss. */
export const DEFAULT_MAX_GUARANTOR_LOSS = 16;

/**
 * Number of LMSR outcomes the market will get: one per target player plus the
 * shared "Ничья/другие" outcome for match_winner (always created, even with
 * allow_other_players=false), Да/Нет for win_streak.
 */
export function outcomeCount(marketType: MarketType, targetCount: number): number {
    if (marketType === "match_winner") {
        return Math.max(targetCount, 0) + 1;
    }
    return 2;
}

/** Market-maker parameter b for a max guarantor loss L and outcome count n; null when the inputs cannot produce a sane market (L <= 0 or n < 2). */
export function bFromRisk(risk: number, n: number): number | null {
    if (!(risk > 0) || !(n >= 2)) {
        return null;
    }
    return risk / Math.log(n);
}
