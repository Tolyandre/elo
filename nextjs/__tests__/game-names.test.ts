import { describe, expect, it } from "vitest";

import {
    accentName,
    allNames,
    bggUrl,
    findDuplicateGame,
    matchesAnyName,
    secondaryNames,
    teseraUrl,
} from "@/lib/game-names";

const bottleImp = {
    name: "Бутылочка",
    alias: "Бутылочка",
    name_ru: "Тень в бутылке",
    name_en: "The Bottle Imp",
};

describe("accentName", () => {
    it("prefers alias, then localized, then English", () => {
        expect(accentName(bottleImp)).toBe("Бутылочка");
        expect(accentName({ name: "Тень в бутылке", name_ru: "Тень в бутылке", name_en: "The Bottle Imp" })).toBe("Тень в бутылке");
        expect(accentName({ name: "Splendor", name_en: "Splendor" })).toBe("Splendor");
    });

    it("falls back to display name when no canonical name exists", () => {
        expect(accentName({ name: "Игра без матча" })).toBe("Игра без матча");
    });
});

describe("secondaryNames", () => {
    it("lists the non-accent names without duplicates", () => {
        expect(secondaryNames(bottleImp)).toEqual(["Тень в бутылке", "The Bottle Imp"]);
    });

    it("excludes names equal to the accent name (case-insensitive)", () => {
        expect(secondaryNames({ name: "7 чудес", name_ru: "7 Чудес", name_en: "7 Wonders" })).toEqual(["7 Wonders"]);
    });
});

describe("allNames / matchesAnyName", () => {
    it("searches alias, localized, and English names", () => {
        expect(matchesAnyName(bottleImp, "бутыл")).toBe(true);
        expect(matchesAnyName(bottleImp, "bottle")).toBe(true);
        expect(matchesAnyName(bottleImp, "тень")).toBe(true);
        expect(matchesAnyName(bottleImp, "каркссон")).toBe(false);
        expect(matchesAnyName(bottleImp, "")).toBe(true);
    });

    it("allNames is accent plus secondary", () => {
        expect(allNames(bottleImp)).toEqual(["Бутылочка", "Тень в бутылке", "The Bottle Imp"]);
    });
});

describe("findDuplicateGame", () => {
    const carcassonne = { name: "Каркассон", name_en: "Carcassonne" };
    const games = [bottleImp, carcassonne];

    it("matches any known name, case- and whitespace-insensitively", () => {
        expect(findDuplicateGame(games, "бутылочка")).toBe(bottleImp);
        expect(findDuplicateGame(games, "  The Bottle Imp ")).toBe(bottleImp);
        expect(findDuplicateGame(games, "CARCASSONNE")).toBe(carcassonne);
    });

    it("ignores substrings, unknown names, and blanks", () => {
        expect(findDuplicateGame(games, "бутыл")).toBeUndefined();
        expect(findDuplicateGame(games, "Пандория")).toBeUndefined();
        expect(findDuplicateGame(games, "")).toBeUndefined();
        expect(findDuplicateGame(games, "   ")).toBeUndefined();
    });
});

describe("catalog links", () => {
    it("derives the canonical links", () => {
        expect(bggUrl(822)).toBe("https://boardgamegeek.com/boardgame/822");
        expect(teseraUrl(707)).toBe("https://tesera.ru/game/707");
    });
});
