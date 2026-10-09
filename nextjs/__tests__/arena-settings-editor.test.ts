import { describe, expect, it } from "vitest";
import type { ArenaSettings, ArenaSettingsDoc } from "@/app/api";
import {
    buildSettingsFromValues,
    initialSettingsValues,
    settingsValuesError,
} from "@/components/arena-settings-editor";

const doc: ArenaSettings = {
    starting_rating: 950,
    leagues: [
        { kind: "newbie", goal_gap: 12, earned_min: 1, earned_max: 50, tau: 80 },
        { kind: "amateur" },
        { kind: "elite", matches_6m: 10, matches_2m: 2 },
    ],
};

describe("initialSettingsValues", () => {
    it("parses a stored settings document", () => {
        const values = initialSettingsValues(doc);
        expect(values.startingRating).toBe("950");
        expect(values.leagues.newbie).toBe(true);
        expect(values.leagues.amateur).toBe(true);
        expect(values.leagues.elite).toBe(true);
        expect(values.leagues.goalGap).toBe("12");
        expect(values.leagues.tau).toBe("80");
        expect(values.leagues.matches6m).toBe("10");
    });

    it("fills arena defaults (900, newbie + amateur) for a fresh arena", () => {
        const values = initialSettingsValues(null);
        expect(values.startingRating).toBe("900");
        expect(values.leagues.newbie).toBe(true);
        expect(values.leagues.amateur).toBe(true);
        expect(values.leagues.elite).toBe(false);
    });

    it("fills camp defaults (starting elo, no leagues) for a fresh camp", () => {
        const values = initialSettingsValues(null, { startingRating: "1000", withLeagues: false });
        expect(values.startingRating).toBe("1000");
        expect(values.leagues.newbie).toBe(false);
        expect(values.leagues.amateur).toBe(false);
        expect(values.leagues.elite).toBe(false);
    });
});

describe("buildSettingsFromValues", () => {
    it("round-trips through the values", () => {
        const values = initialSettingsValues(doc);
        expect(buildSettingsFromValues(values)).toEqual(doc);
    });

    it("keeps only the enabled leagues, in promotion order", () => {
        const values = initialSettingsValues(doc);
        values.leagues.newbie = false;
        values.leagues.elite = true;
        // The wire type is opaque; the v1 shape is the typed view.
        const built = buildSettingsFromValues(values) as unknown as ArenaSettingsDoc;
        expect(built.leagues.map((l) => l.kind)).toEqual(["amateur", "elite"]);
        expect(built.starting_rating).toBe(950);
    });
});

describe("settingsValuesError", () => {
    it("accepts the defaults", () => {
        expect(settingsValuesError(initialSettingsValues(null))).toBeNull();
    });

    it("rejects a non-numeric starting rating", () => {
        const values = initialSettingsValues(null);
        values.startingRating = "abc";
        expect(settingsValuesError(values)).toContain("Стартовый рейтинг");
    });

    it("rejects negative newbie params and non-positive tau", () => {
        const values = initialSettingsValues(null);
        values.leagues.earnedMin = "-1";
        expect(settingsValuesError(values)).toContain("неотрицательными");
        values.leagues.earnedMin = "2";
        values.leagues.tau = "0";
        expect(settingsValuesError(values)).toContain("τ");
    });

    it("rejects negative elite params", () => {
        const values = initialSettingsValues(doc);
        values.leagues.matches6m = "-3";
        expect(settingsValuesError(values)).toContain("высшей лиги");
    });

    it("ignores disabled leagues' params", () => {
        const values = initialSettingsValues(doc);
        values.leagues.elite = false; // newbie + amateur remain — a valid set
        values.leagues.matches6m = "-5"; // an elite param on a disabled league
        expect(settingsValuesError(values)).toBeNull();
    });

    it("rejects exactly one selected league (the server schema does too)", () => {
        const values = initialSettingsValues(null);
        values.leagues.newbie = false;
        values.leagues.amateur = false;
        values.leagues.elite = true;
        expect(settingsValuesError(values)).toContain("одиночная лига");
    });

    it("accepts no leagues and two leagues", () => {
        expect(settingsValuesError(initialSettingsValues(null, { withLeagues: false }))).toBeNull();
        const values = initialSettingsValues(null);
        values.leagues.newbie = false;
        values.leagues.elite = true;
        expect(settingsValuesError(values)).toBeNull();
    });
});
