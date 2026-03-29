import { GameListItem, Match } from "@/app/api";

type GameGroup = { heading: string; options: { value: string; label: string }[] };

/**
 * Builds ordered game groups for comboboxes:
 * 1. "Недавние" — up to 7 games recently played by the current user's player (omitted if no playerId)
 * 2. "Популярные" — up to 7 games by total_matches (excluding recent)
 * 3. "Остальные" — all remaining games, sorted alphabetically
 */
export function buildGameGroups(
  games: GameListItem[],
  matches: Match[],
  playerId: string | undefined
): GameGroup[] {
  const groups: GameGroup[] = [];
  const byId = new Map(games.map((g) => [g.id, g]));

  // 1. Recent
  const recentIds: string[] = [];
  if (playerId !== undefined) {
    const seen = new Set<string>();
    for (const match of matches) {
      if (playerId in match.score && !seen.has(match.game_id) && byId.has(match.game_id)) {
        seen.add(match.game_id);
        recentIds.push(match.game_id);
        if (recentIds.length === 7) break;
      }
    }
    if (recentIds.length > 0) {
      groups.push({
        heading: "Недавние",
        options: recentIds.map((id) => ({ value: id, label: byId.get(id)!.name })),
      });
    }
  }

  // 2. Popular
  const recentSet = new Set(recentIds);
  const popular = games
    .filter((g) => !recentSet.has(g.id))
    .sort((a, b) => b.total_matches - a.total_matches || b.last_played_order - a.last_played_order)
    .slice(0, 7)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  if (popular.length > 0) {
    groups.push({
      heading: "Популярные",
      options: popular.map((g) => ({ value: g.id, label: g.name })),
    });
  }

  // 3. Rest
  const excludedSet = new Set([...recentSet, ...popular.map((g) => g.id)]);
  const rest = games
    .filter((g) => !excludedSet.has(g.id))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  if (rest.length > 0) {
    groups.push({
      heading: "Остальные",
      options: rest.map((g) => ({ value: g.id, label: g.name })),
    });
  }

  return groups;
}
