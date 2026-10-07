import { describe, expect, it } from "vitest";
import { buildGameGroups, buildGameTabs, clientFavoriteGameIds, FAVORITE_GAMES_LIMIT, type FavoriteGameIds } from "@/lib/game-groups";
import type { GameListItem, Match } from "@/app/api";
import type { Base58ID } from "@/lib/id";

/** Plain string ids as Base58ID — the tests use readable "g1"-style ids. */
const favorites = (recent: string[], popular: string[]): FavoriteGameIds => ({
    recent: recent as Base58ID[],
    popular: popular as Base58ID[],
});

const game = (id: string, name: string, totalMatches = 0, lastPlayedOrder = 0) =>
    ({
        id,
        name,
        alias: null,
        name_en: null,
        name_ru: null,
        total_matches: totalMatches,
        last_played_order: lastPlayedOrder,
    }) as unknown as GameListItem;

const match = (gameId: string, playerIds: string[]) =>
    ({ game_id: gameId, date: "2026-01-01", score: Object.fromEntries(playerIds.map((id) => [id, 10])) }) as unknown as Match;

const optionValues = (sections: { options: { value: string }[] }[]) =>
    sections.flatMap((s) => s.options.map((o) => o.value));

// Chess is the current player's latest game; Checkers their second; Catan is
// the globally most played game; Azul rounds out the catalogue.
const chess = game("g1", "Chess", 3, 0);
const checkers = game("g2", "Checkers", 2, 1);
const catan = game("g3", "Catan", 10, 2);
const azul = game("g4", "Azul", 1, 3);
const allGames = [chess, checkers, catan, azul];

describe("clientFavoriteGameIds (offline fallback)", () => {
    it("takes recent games from my own matches in recency order", () => {
        const matches = [match("g1", ["me", "p1"]), match("g3", ["p2", "p3"]), match("g2", ["me", "p1"])];
        expect(clientFavoriteGameIds(allGames, matches, "me")).toEqual({
            recent: ["g1", "g2"], // g3 skipped — I did not play it
            popular: ["g3", "g4"], // most played of the rest
        });
    });

    it("is empty without a current player or matches", () => {
        expect(clientFavoriteGameIds(allGames, [match("g1", ["me"])], undefined)).toEqual({
            recent: [],
            popular: ["g3", "g1", "g2", "g4"], // global most played
        });
        expect(clientFavoriteGameIds(allGames, undefined, "me")).toEqual({
            recent: [],
            popular: ["g3", "g1", "g2", "g4"],
        });
    });

    it("caps the recent section at the limit", () => {
        const games = Array.from({ length: FAVORITE_GAMES_LIMIT + 3 }, (_, i) => game(`g${i}`, `G${i}`));
        const matches = games.map((g) => match(g.id, ["me"]));
        const favorites = clientFavoriteGameIds(games, matches, "me");
        expect(favorites.recent).toHaveLength(FAVORITE_GAMES_LIMIT);
        // Only the games outside the recent cap remain for popular.
        expect(favorites.popular).toHaveLength(3);
    });
});

describe("buildGameTabs", () => {
    it("builds the «Избранные» and «Остальные» tabs from server favorites", () => {
        const tabs = buildGameTabs(allGames, [], "me", favorites(["g1", "g2"], ["g3"]));

        expect(tabs.map((t) => t.label)).toEqual(["Избранные", "Остальные"]);
        // The favorites tab keeps its two sections with headings.
        expect(tabs[0].sections.map((s) => s.heading)).toEqual(["Недавние", "Популярные"]);
        expect(optionValues(tabs[0].sections)).toEqual(["g1", "g2", "g3"]);
        // «Остальные» holds everything else, alphabetical.
        expect(optionValues(tabs[1].sections)).toEqual(["g4"]);
    });

    it("drops favorites overlapping between sections (popular excludes recent)", () => {
        const tabs = buildGameTabs(allGames, [], "me", favorites(["g3"], ["g3", "g1"]));
        expect(optionValues(tabs[0].sections)).toEqual(["g3", "g1"]);
    });

    it("filters favorite ids unknown to the game list", () => {
        const tabs = buildGameTabs([chess], [], "me", favorites(["g1", "ghost"], ["ghost"]));
        expect(optionValues(tabs[0].sections)).toEqual(["g1"]);
    });

    it("omits the favorites tab when both sections are empty", () => {
        const tabs = buildGameTabs(allGames, [], undefined, favorites([], []));
        expect(tabs.map((t) => t.label)).toEqual(["Остальные"]);
        // Alphabetical: Azul, Catan, Checkers, Chess.
        expect(optionValues(tabs[0].sections)).toEqual(["g4", "g3", "g2", "g1"]);
    });

    it("falls back to the client-side computation without server favorites", () => {
        const matches = [match("g1", ["me"])];
        const tabs = buildGameTabs(allGames, matches, "me");
        // Recent [g1]; popular swallows the three remaining games — «Остальные»
        // is empty, so only the favorites tab remains.
        expect(tabs.map((t) => t.label)).toEqual(["Избранные"]);
        expect(optionValues(tabs[0].sections)).toEqual(["g1", "g3", "g2", "g4"]);
    });
});

describe("buildGameGroups (search view)", () => {
    it("groups Недавние / Популярные / Остальные from server favorites", () => {
        const groups = buildGameGroups(allGames, [], "me", favorites(["g1"], ["g3"]));
        expect(groups.map((g) => g.heading)).toEqual(["Недавние", "Популярные", "Остальные"]);
        // «Остальные» holds the leftovers alphabetically: Azul, Checkers.
        expect(optionValues(groups)).toEqual(["g1", "g3", "g4", "g2"]);
        expect(groups[0].options[0].label).toBe("Chess");
    });

    it("falls back to the client-side computation without server favorites", () => {
        const matches = [match("g1", ["me", "p1"])];
        const groups = buildGameGroups(allGames, matches, "me");
        // Recent [g1]; the popular section swallows the rest — «Остальные» is empty.
        expect(groups.map((g) => g.heading)).toEqual(["Недавние", "Популярные"]);
        expect(optionValues(groups)).toEqual(["g1", "g3", "g2", "g4"]);
    });

    it("hides empty sections", () => {
        // One game only, explicit empty favorites: a single «Остальные» group.
        const groups = buildGameGroups([chess], [], undefined, favorites([], []));
        expect(groups.map((g) => g.heading)).toEqual(["Остальные"]);
    });
});
