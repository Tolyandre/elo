import type { Base58ID } from "../lib/id";
import { describe, expect, it } from "vitest";
import { arenaSingleGame, buildArenaGroups } from "../lib/arena-groups";
import type { Arena, GameListItem, Match } from "../app/api";

const game = (id: string, name: string, totalMatches: number, lastPlayedOrder = 0) =>
  ({ id, name, total_matches: totalMatches, last_played_order: lastPlayedOrder }) as unknown as GameListItem;

const match = (gameId: string, playerId: string) =>
  ({ game_id: gameId, score: { [playerId]: { score: 1 } } }) as unknown as Match;

const arena = (
  id: string,
  name: string,
  matchesCount: number | null,
  filter: Partial<Arena["filter"]> = {},
  anchors: { game_id?: string; tournament_id?: string } = {},
) =>
  ({
    id,
    name,
    matches_count: matchesCount,
    settings: {},
    settings_schema_version: 1,
    filter: { game_ids: [], tag_ids: [], ...filter },
    ...anchors,
  }) as unknown as Arena;

const PLAYER = "p1" as Base58ID;

describe("arenaSingleGame", () => {
  it("prefers the per-game anchor over the filter's game list", () => {
    const a = arena("a", "A", 0, { game_ids: ["g2" as Base58ID] }, { game_id: "g1" });
    expect(arenaSingleGame(a)).toBe("g1");
  });

  it("accepts a one-element game list and rejects multi-game or game-less arenas", () => {
    expect(arenaSingleGame(arena("a", "A", 0, { game_ids: ["g1" as Base58ID] }))).toBe("g1");
    expect(arenaSingleGame(arena("a", "A", 0, { game_ids: ["g1", "g2"] as Base58ID[] }))).toBeNull();
    expect(arenaSingleGame(arena("a", "A", 0))).toBeNull();
  });
});

describe("buildArenaGroups", () => {
  // Recent: g4 then g5 (match order). Popular: the top-7 non-recent games by
  // total_matches — g2 (100), g3 (50), g1 (1) and four zero-total fillers;
  // "Лямбда" (0) is the 8th and falls through to "Остальные".
  const games = [
    game("g1", "Альфа", 1),
    game("g2", "Бета", 100),
    game("g3", "Гамма", 50),
    game("g4", "Дельта", 5),
    game("g5", "Эпсилон", 200),
    game("g6", "Жюри", 0),
    game("g7", "Зета", 0),
    game("g8", "Итака", 0),
    game("g9", "Каппа", 0),
    game("g10", "Лямбда", 0),
  ];
  const matches = [match("g4", PLAYER), match("g5", PLAYER)];

  it("groups tag arenas first by matches, then games as in the search combobox", () => {
    const arenas = [
      arena("a-g2", "Бета арена", 0, { game_ids: ["g2" as Base58ID] }),
      arena("a-tags2", "Серия", 10, { tag_ids: ["t2" as Base58ID], game_ids: ["g1" as Base58ID] }),
      arena("a-g4b", "Дельта вечер", 3, { game_ids: ["g4" as Base58ID] }),
      arena("a-season", "Сезон 2025", 1, { date_from: "2025-01-01T00:00:00Z", date_to: "2025-12-31T00:00:00Z" }),
      arena("a-g10", "Лямбда арена", 6, { game_ids: ["g10" as Base58ID] }),
      arena("a-g5", "Эпсилон арена", 2, { game_ids: ["g5" as Base58ID] }),
      arena("a-g1", "Альфа арена", 2, {}, { game_id: "g1" }),
      arena("a-tags1", "Кланк!", 40, { tag_ids: ["t1" as Base58ID] }),
      arena("a-g4a", "Дельта кубок", 7, {}, { game_id: "g4" }),
    ];

    const groups = buildArenaGroups(arenas, games, matches, PLAYER);

    expect(groups.map((g) => g.heading)).toEqual(["По тегам", "Недавние", "Популярные", "Остальные"]);
    expect(groups[0].arenas.map((a) => a.name)).toEqual(["Кланк!", "Серия"]);
    // Recent games in combobox order; arenas of one game adjacent, most matches first.
    expect(groups[1].arenas.map((a) => a.name)).toEqual(["Дельта кубок", "Дельта вечер", "Эпсилон арена"]);
    expect(groups[2].arenas.map((a) => a.name)).toEqual(["Альфа арена", "Бета арена"]);
    // Arenas of a game beyond the popular cut, then the arenas with no single game.
    expect(groups[3].arenas.map((a) => a.name)).toEqual(["Лямбда арена", "Сезон 2025"]);
  });

  it("puts a multi-game arena without tags at the end of Остальные", () => {
    const arenas = [
      arena("a-series", "Серия без тега", 5, { game_ids: ["g2", "g4"] as Base58ID[] }),
      arena("a-g4", "Дельта", 1, { game_ids: ["g4" as Base58ID] }),
    ];

    const groups = buildArenaGroups(arenas, games, matches, PLAYER);

    expect(groups.map((g) => g.heading)).toEqual(["Недавние", "Остальные"]);
    expect(groups[0].arenas.map((a) => a.name)).toEqual(["Дельта"]);
    expect(groups[1].arenas.map((a) => a.name)).toEqual(["Серия без тега"]);
  });

  it("omits empty groups", () => {
    const groups = buildArenaGroups([arena("a-tags", "Кланк!", 3, { tag_ids: ["t1" as Base58ID] })], games, matches, PLAYER);
    expect(groups.map((g) => g.heading)).toEqual(["По тегам"]);
  });

  it("sorts by matches descending when a game filter is applied by the caller", () => {
    // The page sorts the by-game list itself; arenaMatchesCount treats a
    // missing count as 0.
    const arenas = [arena("a", "A", null), arena("b", "B", 2)];
    const sorted = [...arenas].sort((x, y) => (y.matches_count ?? 0) - (x.matches_count ?? 0));
    expect(sorted.map((a) => a.id)).toEqual(["b", "a"]);
  });
});
