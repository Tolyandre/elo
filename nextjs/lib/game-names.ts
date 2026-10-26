// Multi-name rendering and search for games. A game carries up to three
// names — the user alias, the localized Russian title, and the official
// English title — and one display name (server-maintained as alias → ru → en).
// The accent name is what gets emphasis in pickers: the alias when set,
// otherwise the localized title.

export type GameWithNames = {
    name: string;
    alias?: string | null;
    name_en?: string | null;
    name_ru?: string | null;
};

/** The name to emphasize in lists: alias if set, else localized, else English. */
export function accentName(game: GameWithNames): string {
    return game.alias || game.name_ru || game.name_en || game.name;
}

/** The other names, deduplicated, for muted display next to the accent name. */
export function secondaryNames(game: GameWithNames): string[] {
    const names = [game.alias, game.name_ru, game.name_en, game.name];
    const seen = new Set<string>();
    const accent = accentName(game).toLowerCase();
    const out: string[] = [];
    for (const n of names) {
        if (!n) continue;
        const key = n.toLowerCase();
        if (key === accent || seen.has(key)) continue;
        seen.add(key);
        out.push(n);
    }
    return out;
}

/** Every name of the game, for search matching. */
export function allNames(game: GameWithNames): string[] {
    return [accentName(game), ...secondaryNames(game)];
}

/** Case-insensitive substring match across all names. */
export function matchesAnyName(game: GameWithNames, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return allNames(game).some((n) => n.toLowerCase().includes(q));
}

/**
 * The first game claiming `name` as any of its names (trimmed, case- and
 * whitespace-insensitive), or undefined. Broader than the server's unique
 * display-name index (alias → ru → en, exact bytes): a typed name matching a
 * known alias or English title is a duplicate in spirit, so creation forms
 * block it before it ever reaches the queue.
 */
export function findDuplicateGame(
    games: Iterable<GameWithNames>,
    name: string,
): GameWithNames | undefined {
    const key = name.trim().toLowerCase();
    if (!key) return undefined;
    for (const game of games) {
        if (allNames(game).some((n) => n.trim().toLowerCase() === key)) return game;
    }
    return undefined;
}

export function bggUrl(bggRef: number): string {
    return `https://boardgamegeek.com/boardgame/${bggRef}`;
}

export function teseraUrl(teseraRef: number): string {
    return `https://tesera.ru/game/${teseraRef}`;
}
