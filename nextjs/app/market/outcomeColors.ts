import { MarketOutcome } from "@/app/api";

// Deterministic per-outcome colors, stable for a market's lifetime: the win_streak
// Да/Нет pair keeps the historical green/red, "Ничья" is neutral gray, and player
// outcomes take palette colors in outcome order.
const PLAYER_PALETTE = [
    "#3b82f6", // blue
    "#f59e0b", // amber
    "#8b5cf6", // violet
    "#14b8a6", // teal
    "#ec4899", // pink
    "#6366f1", // indigo
    "#84cc16", // lime
    "#f97316", // orange
    "#06b6d4", // cyan
    "#f43f5e", // rose
    "#a855f7", // purple
    "#65a30d", // olive
] as const;

const FIXED_KIND_COLORS: Partial<Record<MarketOutcome["kind"], string>> = {
    yes: "#22c55e", // green
    no: "#ef4444", // red
    other: "#94a3b8", // slate
};

/** Returns the outcome id → color map for a market's outcomes. */
export function outcomeColors(outcomes: MarketOutcome[]): Map<string, string> {
    const colors = new Map<string, string>();
    let playerIdx = 0;
    for (const o of outcomes) {
        const fixed = FIXED_KIND_COLORS[o.kind];
        if (fixed) {
            colors.set(o.id, fixed);
        } else {
            colors.set(o.id, PLAYER_PALETTE[playerIdx % PLAYER_PALETTE.length]);
            playerIdx++;
        }
    }
    return colors;
}
