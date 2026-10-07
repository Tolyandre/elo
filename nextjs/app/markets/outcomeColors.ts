import { MarketOutcome } from "@/app/api";

// Deterministic per-outcome colors, stable for a market's lifetime: the win_streak
// Да/Нет pair keeps the historical green/red, "Ничья" is neutral gray, and player
// outcomes take palette colors in outcome order.
const PLAYER_PALETTE = [
    "var(--chart-8)", // blue
    "var(--chart-5)", // amber
    "var(--chart-6)", // violet
    "var(--chart-2)", // teal
    "var(--chart-9)", // pink
    "var(--chart-8)", // indigo
    "var(--chart-7)", // lime
    "var(--chart-1)", // orange
    "var(--chart-2)", // cyan
    "var(--chart-1)", // rose
    "var(--chart-6)", // purple
    "var(--chart-7)", // olive
] as const;

const FIXED_KIND_COLORS: Partial<Record<MarketOutcome["kind"], string>> = {
    // The Да/Нет pair is win_streak-only and stays red-green in both themes
    // (--chart-yes/--chart-no; the categorical wheel would turn blue/cyan in
    // dark). "yes" means the streak was reached, "no" that it failed.
    yes: "var(--chart-yes)", // green
    no: "var(--chart-no)", // red
    other: "var(--muted-foreground)", // slate
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
