import { describe, expect, it } from "vitest";
import {
    GAME_MODES,
    hasModeChoice,
    isGameMode,
    isMatchMode,
    isRatingGame,
    resolveMatchMode,
} from "../lib/game-modes";

describe("resolveMatchMode", () => {
    it("fixes coop for coop-only games", () => {
        expect(resolveMatchMode("coop")).toBe("coop");
        expect(resolveMatchMode("coop", "competitive")).toBe("coop");
    });

    it("fixes competitive for competitive-only and unknown modes", () => {
        expect(resolveMatchMode("competitive")).toBe("competitive");
        expect(resolveMatchMode("competitive", "coop")).toBe("competitive");
        // Unset (every pre-feature game) and unknown values stay competitive.
        expect(resolveMatchMode(undefined)).toBe("competitive");
        expect(resolveMatchMode(null)).toBe("competitive");
        expect(resolveMatchMode("weird", "coop")).toBe("competitive");
    });

    it("honors the preferred mode for mixed games", () => {
        expect(resolveMatchMode("mixed")).toBe("competitive");
        expect(resolveMatchMode("mixed", "coop")).toBe("coop");
    });
});

describe("hasModeChoice", () => {
    it("offers the toggle only for mixed games", () => {
        expect(hasModeChoice("mixed")).toBe(true);
        expect(hasModeChoice("coop")).toBe(false);
        expect(hasModeChoice("competitive")).toBe(false);
        expect(hasModeChoice(undefined)).toBe(false);
    });
});

describe("isRatingGame", () => {
    it("excludes coop-only games from market/tournament pickers", () => {
        expect(isRatingGame({ game_mode: "coop" })).toBe(false);
        expect(isRatingGame({ game_mode: "competitive" })).toBe(true);
        expect(isRatingGame({ game_mode: "mixed" })).toBe(true);
    });
});

describe("type guards", () => {
    it("recognize the mode unions", () => {
        expect(GAME_MODES).toEqual(["competitive", "coop", "mixed"]);
        expect(isGameMode("coop")).toBe(true);
        expect(isGameMode("solo")).toBe(false);
        expect(isMatchMode("coop")).toBe(true);
        expect(isMatchMode("mixed")).toBe(false);
    });
});
