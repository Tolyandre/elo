import { GameListItem, Match } from "@/app/api";
import type { Base58ID } from "@/lib/id";
import { accentName } from "@/lib/game-names";

export type GameGroup = {
  heading: string;
  options: { value: string; label: string; game?: GameListItem }[];
};

/** A tab in the game picker: «Избранные» (its two sections) and «Остальные». */
export type GameTab = {
  key: string;
  label: string;
  sections: GameGroup[];
};

/** The two sections of the picker's «Избранные» tab, as game ids. */
export type FavoriteGameIds = {
  /** «Недавние» — most recently played first. */
  recent: Base58ID[];
  /** «Популярные» — most played first. */
  popular: Base58ID[];
};

export const RECENT_LABEL = "Недавние";
export const POPULAR_LABEL = "Популярные";
export const FAVORITES_TAB_LABEL = "Избранные";
export const OTHER_GAMES_LABEL = "Остальные";

/** Cap of each «Избранные» section, mirroring the server's FavoriteGamesLimit. */
export const FAVORITE_GAMES_LIMIT = 7;

const byName = (a: GameListItem, b: GameListItem) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/**
 * Offline fallback for the favorites (used while the server's
 * /games/favorites is unavailable, on error, or when signed out):
 * «Недавние» = the first distinct games of the current player's own matches
 * (matches come most-recent-first), «Популярные» = the most played games by
 * total match count, excluding the recent ones. Empty recent without a current
 * player or matches.
 */
export function clientFavoriteGameIds(
  games: GameListItem[],
  matches: Match[] | undefined,
  playerId: string | undefined,
  limit = FAVORITE_GAMES_LIMIT,
): FavoriteGameIds {
  const byId = new Map(games.map((g) => [g.id, g]));
  const recentIds: Base58ID[] = [];
  if (playerId !== undefined && matches) {
    const seen = new Set<string>();
    for (const match of matches) {
      if (playerId in match.score && !seen.has(match.game_id) && byId.has(match.game_id)) {
        seen.add(match.game_id);
        recentIds.push(match.game_id);
        if (recentIds.length === limit) break;
      }
    }
  }
  const recentSet = new Set(recentIds);
  const popularIds = games
    .filter((g) => !recentSet.has(g.id))
    .sort((a, b) => b.total_matches - a.total_matches || b.last_played_order - a.last_played_order)
    .slice(0, limit)
    .map((g) => g.id);
  return { recent: recentIds, popular: popularIds };
}

/**
 * Resolves the favorites against the visible game list (ids unknown to the
 * list drop out — a game may have been deleted or hidden by a picker filter).
 * Without server favorites, falls back to the client-side computation.
 */
function resolveFavoriteGames(
  games: GameListItem[],
  matches: Match[] | undefined,
  playerId: string | undefined,
  favorites: FavoriteGameIds | undefined,
): { recent: GameListItem[]; popular: GameListItem[] } {
  const byId = new Map(games.map((g) => [g.id, g]));
  const resolve = (ids: Base58ID[]) =>
    ids.map((id) => byId.get(id)).filter((g): g is GameListItem => g !== undefined);
  if (favorites) {
    const recent = resolve(favorites.recent);
    const recentSet = new Set(recent.map((g) => g.id));
    return { recent, popular: resolve(favorites.popular).filter((g) => !recentSet.has(g.id)) };
  }
  const fallback = clientFavoriteGameIds(games, matches, playerId);
  return { recent: resolve(fallback.recent), popular: resolve(fallback.popular) };
}

/**
 * Builds ordered game groups for comboboxes and multi-selects (the search
 * view; the browse view is buildGameTabs):
 * 1. "Недавние" — the favorites' recent games, recency order (omitted when empty)
 * 2. "Популярные" — the favorites' popular games, most played first (omitted when empty)
 * 3. "Остальные" — all remaining games, sorted alphabetically
 *
 * The option label is the accent name (alias if set, else localized, else
 * English); the full game rides along so pickers can search all names and
 * render the secondary names muted.
 */
export function buildGameGroups(
  games: GameListItem[],
  matches: Match[] | undefined,
  playerId: string | undefined,
  favorites?: FavoriteGameIds,
): GameGroup[] {
  const { recent, popular } = resolveFavoriteGames(games, matches, playerId, favorites);
  const option = (g: GameListItem) => ({ value: g.id, label: accentName(g), game: g });
  const groups: GameGroup[] = [];

  if (recent.length > 0) {
    groups.push({ heading: RECENT_LABEL, options: recent.map(option) });
  }
  if (popular.length > 0) {
    groups.push({ heading: POPULAR_LABEL, options: popular.map(option) });
  }

  const excludedSet = new Set([...recent, ...popular].map((g) => g.id));
  const rest = games.filter((g) => !excludedSet.has(g.id)).sort(byName);
  if (rest.length > 0) {
    groups.push({ heading: OTHER_GAMES_LABEL, options: rest.map(option) });
  }

  return groups;
}

/**
 * Builds the tabbed game picker structure (the browse view):
 * 1. «Избранные» — the «Недавние» and «Популярные» sections (omitted when both empty)
 * 2. «Остальные» — every game not in the favorites, alphabetical; when the
 *    favorites are empty this is the flat full list and the tab bar stays
 *    hidden (the picker renders the single remaining tab's sections).
 */
export function buildGameTabs(
  games: GameListItem[],
  matches: Match[] | undefined,
  playerId: string | undefined,
  favorites?: FavoriteGameIds,
): GameTab[] {
  const { recent, popular } = resolveFavoriteGames(games, matches, playerId, favorites);
  const option = (g: GameListItem) => ({ value: g.id, label: accentName(g), game: g });
  const tabs: GameTab[] = [];

  if (recent.length > 0 || popular.length > 0) {
    const sections: GameGroup[] = [];
    if (recent.length > 0) sections.push({ heading: RECENT_LABEL, options: recent.map(option) });
    if (popular.length > 0) sections.push({ heading: POPULAR_LABEL, options: popular.map(option) });
    tabs.push({ key: "favorites", label: FAVORITES_TAB_LABEL, sections });
  }

  const excludedSet = new Set([...recent, ...popular].map((g) => g.id));
  const rest = games.filter((g) => !excludedSet.has(g.id)).sort(byName);
  if (rest.length > 0) {
    tabs.push({
      key: "other",
      label: OTHER_GAMES_LABEL,
      sections: [{ heading: "", options: rest.map(option) }],
    });
  }

  return tabs;
}
