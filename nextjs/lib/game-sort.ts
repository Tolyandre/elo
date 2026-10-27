// Sort orders of the admin games list. The whole list is loaded client-side
// (and cached by GamesProvider), so the modes sort in memory. `updated_at` —
// set at creation and bumped on every game edit server-side — is the recency
// key of the default mode.

export type SortableGame = {
    name: string;
    total_matches: number;
    bgg_ref?: number | null;
    tesera_ref?: number | null;
    updated_at?: string | null;
};

export type GameSortMode = "recent" | "name" | "matches" | "refs";

export const GAME_SORT_MODES: GameSortMode[] = ["recent", "name", "matches", "refs"];

export const GAME_SORT_LABELS: Record<GameSortMode, string> = {
    recent: "Недавно изменённые",
    name: "По названию",
    matches: "По числу партий",
    refs: "По числу ссылок (BGG, Тесера)",
};

/** Number of catalog links (BGG, Tesera) attached to the game. */
export function catalogRefCount(game: SortableGame): number {
    return (game.bgg_ref ? 1 : 0) + (game.tesera_ref ? 1 : 0);
}

function byName(a: SortableGame, b: SortableGame): number {
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/** The recency instant as a number; anything missing or unparsable sorts last. */
function recencyOf(game: SortableGame): number {
    if (!game.updated_at) return Number.NEGATIVE_INFINITY;
    const ts = Date.parse(game.updated_at);
    return Number.isNaN(ts) ? Number.NEGATIVE_INFINITY : ts;
}

/**
 * A sorted copy of the games. `recent` puts the most recently created or
 * edited game first; every mode breaks ties by name so the order stays
 * stable while values are equal.
 */
export function sortGames<T extends SortableGame>(games: T[], mode: GameSortMode): T[] {
    const sorted = [...games];
    switch (mode) {
        case "name":
            return sorted.sort(byName);
        case "matches":
            return sorted.sort((a, b) => b.total_matches - a.total_matches || byName(a, b));
        case "refs":
            return sorted.sort((a, b) => catalogRefCount(b) - catalogRefCount(a) || byName(a, b));
        case "recent":
            return sorted.sort((a, b) => {
                const ra = recencyOf(a);
                const rb = recencyOf(b);
                return ra !== rb ? rb - ra : byName(a, b);
            });
    }
}
