import { describe, expect, it } from "vitest";
import type { ArenaSettings, ArenaSettingsDoc } from "@/app/api";
import {
    buildSettingsFromValues,
    initialSettingsValues,
    settingsValuesError,
} from "@/components/arena-settings-editor";

const doc: ArenaSettings = {
    starting_rating: 950,
    catch_up: { earned_min: 1, earned_max: 50, tau: 80 },
    leagues: [
        { kind: "newbie", goal_gap: 12 },
        { kind: "amateur" },
        { kind: "elite", matches_6m: 10, matches_2m: 2 },
    ],
} as unknown as ArenaSettings;

describe("initialSettingsValues", () => {
    it("parses a stored settings document", () => {
        const values = initialSettingsValues(doc);
        expect(values.startingRating).toBe("950");
        expect(values.catchUp).toEqual({ earnedMin: "1", earnedMax: "50", tau: "80" });
        expect(values.leagues.newbie).toBe(true);
        expect(values.leagues.amateur).toBe(true);
        expect(values.leagues.elite).toBe(true);
        expect(values.leagues.goalGap).toBe("12");
        expect(values.leagues.matches6m).toBe("10");
    });

    it("fills arena defaults (900, newbie + amateur) for a fresh arena", () => {
        const values = initialSettingsValues(null);
        expect(values.startingRating).toBe("900");
        expect(values.catchUp).toEqual({ earnedMin: "2", earnedMax: "64", tau: "100" });
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

    it("honors explicit catch-up and goal-gap defaults (the live elo settings)", () => {
        const values = initialSettingsValues(null, {
            catchUp: { earnedMin: "3", earnedMax: "40", tau: "55" },
            goalGap: "20",
        });
        expect(values.catchUp).toEqual({ earnedMin: "3", earnedMax: "40", tau: "55" });
        expect(values.leagues.goalGap).toBe("20");
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
        // The wire type is opaque; the v2 shape is the typed view.
        const built = buildSettingsFromValues(values) as unknown as ArenaSettingsDoc;
        expect(built.leagues.map((l) => l.kind)).toEqual(["amateur", "elite"]);
        expect(built.starting_rating).toBe(950);
        expect(built.catch_up).toEqual({ earned_min: 1, earned_max: 50, tau: 80 });
    });

    it("emits a league-less document for a camp (all chips off)", () => {
        const values = initialSettingsValues(null, { startingRating: "1000", withLeagues: false });
        const built = buildSettingsFromValues(values) as unknown as ArenaSettingsDoc;
        expect(built.leagues).toEqual([]);
        expect(built.starting_rating).toBe(1000);
        expect(built.catch_up).toEqual({ earned_min: 2, earned_max: 64, tau: 100 });
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

    it("rejects negative catch-up bounds and non-positive tau — in any arena", () => {
        const values = initialSettingsValues(null);
        values.catchUp.earnedMin = "-1";
        expect(settingsValuesError(values)).toContain("неотрицательными");
        values.catchUp.earnedMin = "2";
        values.catchUp.tau = "0";
        expect(settingsValuesError(values)).toContain("τ");
        // The catch-up applies without the newbie league too: the parameters
        // stay required when every league is off (the camp shape).
        const camp = initialSettingsValues(null, { withLeagues: false });
        camp.catchUp.earnedMax = "-5";
        expect(settingsValuesError(camp)).toContain("неотрицательными");
    });

    it("rejects a negative goal gap only when the newbie league is on", () => {
        const values = initialSettingsValues(null);
        values.leagues.goalGap = "-3";
        expect(settingsValuesError(values)).toContain("Разрыв эло");
        values.leagues.newbie = false;
        values.leagues.amateur = false; // zero leagues — the camp shape is valid
        expect(settingsValuesError(values)).toBeNull();
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
