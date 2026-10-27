import { describe, expect, it } from "vitest";
import { catalogRefCount, sortGames, type SortableGame } from "@/lib/game-sort";

function game(overrides: Partial<SortableGame> & { name: string }): SortableGame {
    return { total_matches: 0, ...overrides };
}

const a = game({ name: "Азул" });
const b = game({ name: "Бутылочка" });

describe("catalogRefCount", () => {
    it("counts the set catalog references", () => {
        expect(catalogRefCount(a)).toBe(0);
        expect(catalogRefCount(game({ name: "x", bgg_ref: 822 }))).toBe(1);
        expect(catalogRefCount(game({ name: "x", bgg_ref: 822, tesera_ref: 707 }))).toBe(2);
    });
});

describe("sortGames", () => {
    it("recent puts the most recently updated game first and breaks ties by name", () => {
        const games = [
            game({ name: "Бутылочка", updated_at: "2026-01-01T00:00:00Z" }),
            game({ name: "Викунья", updated_at: "2026-03-01T00:00:00Z" }),
            game({ name: "Азул", updated_at: "2026-03-01T00:00:00Z" }),
        ];
        expect(sortGames(games, "recent").map((g) => g.name)).toEqual(["Азул", "Викунья", "Бутылочка"]);
    });

    it("recent treats creation like editing: the newest timestamp wins", () => {
        const games = [
            game({ name: "Старая", updated_at: "2020-01-01T00:00:00Z" }),
            game({ name: "Новая", updated_at: "2026-10-01T00:00:00Z" }),
        ];
        expect(sortGames(games, "recent")[0].name).toBe("Новая");
    });

    it("recent sorts games without a timestamp last, by name", () => {
        const games = [
            game({ name: "Без даты" }),
            game({ name: "Ясная", updated_at: "2026-01-01T00:00:00Z" }),
            game({ name: "Анонимная" }),
        ];
        expect(sortGames(games, "recent").map((g) => g.name)).toEqual(["Ясная", "Анонимная", "Без даты"]);
    });

    it("name sorts alphabetically, ignoring matches and recency", () => {
        const games = [
            game({ name: "Викунья", total_matches: 100, updated_at: "2026-03-01T00:00:00Z" }),
            game({ name: "Азул", total_matches: 1 }),
        ];
        expect(sortGames(games, "name").map((g) => g.name)).toEqual(["Азул", "Викунья"]);
    });

    it("matches sorts by total_matches descending and breaks ties by name", () => {
        const games = [
            game({ name: "Азул", total_matches: 3 }),
            game({ name: "Викунья", total_matches: 10 }),
            game({ name: "Бутылочка", total_matches: 10 }),
        ];
        expect(sortGames(games, "matches").map((g) => g.name)).toEqual(["Бутылочка", "Викунья", "Азул"]);
    });

    it("refs sorts by the number of catalog links descending", () => {
        const games = [
            game({ name: "Азул" }),
            game({ name: "Бутылочка", tesera_ref: 555 }),
            game({ name: "Викунья", bgg_ref: 822, tesera_ref: 707 }),
        ];
        expect(sortGames(games, "refs").map((g) => g.name)).toEqual(["Викунья", "Бутылочка", "Азул"]);
    });

    it("returns a copy and leaves the input order untouched", () => {
        const games = [b, a];
        sortGames(games, "name");
        expect(games.map((g) => g.name)).toEqual(["Бутылочка", "Азул"]);
    });
});
