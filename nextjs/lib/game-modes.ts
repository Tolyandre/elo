// Game and match modes (ADR-33). A game is competitive-only, coop/solo-only,
// or mixed; a match snapshots the resolved mode — coop matches carry one
// shared game result instead of per-player scores and never affect ratings,
// arenas, markets, tournaments or profile stats.

export const GAME_MODES = ["competitive", "coop", "mixed"] as const;
export type GameMode = (typeof GAME_MODES)[number];

const MATCH_MODES = ["competitive", "coop"] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

/** Labels for the admin/game-picker select (UI language is Russian). */
export const GAME_MODE_LABELS: Record<GameMode, string> = {
    competitive: "Только соревновательная",
    coop: "Кооператив или сольная",
    mixed: "Смешанная",
};

export function isGameMode(value: unknown): value is GameMode {
    return typeof value === "string" && (GAME_MODES as readonly string[]).includes(value);
}

export function isMatchMode(value: unknown): value is MatchMode {
    return typeof value === "string" && (MATCH_MODES as readonly string[]).includes(value);
}

/**
 * Resolves the match mode a form starts from for a given game (ADR-33):
 * coop/competitive games are fixed by the game itself, a mixed game starts
 * from `preferred`. Unknown or unset game modes stay competitive — the mode of
 * every game created before the feature existed.
 */
export function resolveMatchMode(
    gameMode: string | null | undefined,
    preferred: MatchMode = "competitive",
): MatchMode {
    if (gameMode === "coop") return "coop";
    if (gameMode === "mixed") return preferred;
    return "competitive";
}

/** Whether the form should offer the coop/competitive toggle at all. */
export function hasModeChoice(gameMode: string | null | undefined): boolean {
    return gameMode === "mixed";
}

/**
 * Picker filter for market and tournament game inputs (ADR-33): coop-only
 * games never produce rating matches, so they cannot back a market or a
 * bracket slot. Mixed games pass — their coop matches are excluded per-match.
 */
export function isRatingGame(g: { game_mode: string }): boolean {
    return g.game_mode !== "coop";
}
