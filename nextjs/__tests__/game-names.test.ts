import { describe, expect, it } from "vitest";

import {
    accentName,
    allNames,
    bggUrl,
    matchesAnyName,
    secondaryNames,
    teseraUrl,
} from "@/lib/game-names";

const bottleImp = {
    name: "Бутылочка",
    alias: "Бутылочка",
    name_ru: "Тень в бутылке",
    name_original: "The Bottle Imp",
};

describe("accentName", () => {
    it("prefers alias, then localized, then original", () => {
        expect(accentName(bottleImp)).toBe("Бутылочка");
        expect(accentName({ name: "Тень в бутылке", name_ru: "Тень в бутылке", name_original: "The Bottle Imp" })).toBe("Тень в бутылке");
        expect(accentName({ name: "Splendor", name_original: "Splendor" })).toBe("Splendor");
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
        expect(secondaryNames({ name: "7 чудес", name_ru: "7 Чудес", name_original: "7 Wonders" })).toEqual(["7 Wonders"]);
    });
});

describe("allNames / matchesAnyName", () => {
    it("searches alias, localized, and original names", () => {
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

describe("catalog links", () => {
    it("derives the canonical links", () => {
        expect(bggUrl(822)).toBe("https://boardgamegeek.com/boardgame/822");
        expect(teseraUrl(707)).toBe("https://tesera.ru/game/707");
    });
});
