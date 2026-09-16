import { Arena, GameListItem, Match } from "@/app/api";
import type { Base58ID } from "@/lib/id";
import { buildGameGroups } from "@/lib/game-groups";

export type ArenaGroup = { heading: string; arenas: Arena[] };

export function arenaMatchesCount(arena: Arena): number {
  return arena.matches_count ?? 0;
}

function byMatchesDesc(a: Arena, b: Arena): number {
  return (
    arenaMatchesCount(b) - arenaMatchesCount(a) ||
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

/**
 * The arena's own single game: the per-game anchor of an auto-managed arena,
 * or a one-element game list of a user-created one.
 */
export function arenaSingleGame(arena: Arena): Base58ID | null {
  if (arena.game_id != null) return arena.game_id;
  if (arena.filter.game_ids.length === 1) return arena.filter.game_ids[0];
  return null;
}

/**
 * Games-tab grouping (no game selected in the filter):
 *
 * 1. "По тегам" — arenas with a game-tag filter, most matches first;
 * 2. the remaining arenas follow the game-search combobox ordering
 *    (buildGameGroups): each group heading ("Недавние", "Популярные",
 *    "Остальные") lists its games in the combobox order, the arenas of one
 *    game adjacent, most matches first;
 * 3. arenas not tied to a single game (multi-game without tags, date-range
 *    seasons) close the "Остальные" group.
 *
 * Empty groups are omitted.
 */
export function buildArenaGroups(
  arenas: Arena[],
  games: GameListItem[],
  matches: Match[],
  playerId: string | undefined
): ArenaGroup[] {
  const withTags = arenas
    .filter((a) => a.filter.tag_ids.length > 0)
    .sort(byMatchesDesc);
  const rest = new Map(
    arenas
      .filter((a) => a.filter.tag_ids.length === 0)
      .map((a) => [a.id, a] as const)
  );

  // Laying out arenas in game order reuses the combobox's game groups as-is.
  const flatByHeading = new Map<string, Arena[]>();
  const headingOrder: string[] = [];
  for (const gameGroup of buildGameGroups(games, matches, playerId)) {
    for (const game of gameGroup.options) {
      const arenasOfGame = [...rest.values()]
        .filter((a) => arenaSingleGame(a) === game.value)
        .sort(byMatchesDesc);
      if (arenasOfGame.length === 0) continue;
      let flat = flatByHeading.get(gameGroup.heading);
      if (!flat) {
        flat = [];
        flatByHeading.set(gameGroup.heading, flat);
        headingOrder.push(gameGroup.heading);
      }
      for (const arena of arenasOfGame) {
        flat.push(arena);
        rest.delete(arena.id);
      }
    }
  }

  const groups: ArenaGroup[] = [];
  if (withTags.length > 0) {
    groups.push({ heading: "По тегам", arenas: withTags });
  }
  for (const heading of headingOrder) {
    groups.push({ heading, arenas: flatByHeading.get(heading)! });
  }

  // Whatever is left has no single game (multi-game without tags, date-range
  // seasons) or its game vanished from the list — it closes "Остальные".
  if (rest.size > 0) {
    const sorted = [...rest.values()].sort(byMatchesDesc);
    const others = groups.find((g) => g.heading === "Остальные");
    if (others) {
      others.arenas.push(...sorted);
    } else {
      groups.push({ heading: "Остальные", arenas: sorted });
    }
  }

  return groups;
}
