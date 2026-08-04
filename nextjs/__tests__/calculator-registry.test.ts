import { describe, it, expect } from "vitest";
import { scoreFromState as skScoreFromState } from "@/components/calculators/skull-king";
import { scoreFromState as iawwScoreFromState } from "@/components/calculators/iaww/scoring";
import { getCalculator, isCalculatorKind, CALCULATORS } from "@/components/calculators/registry";
import type { GameState as SKGameState } from "@/components/calculators/skull-king";
import type { GameState as IawwGameState } from "@/components/calculators/iaww/scoring";

describe("skull-king scoreFromState", () => {
    it("computes a score per player from the rounds breakdown", () => {
        const state: SKGameState = {
            phase: "result-entry",
            players: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }],
            currentRound: 1,
            currentPlayerIndex: 0,
            rounds: [
                [
                    { bid: 0, actual: 0, bonus: 0 },
                    { bid: 1, actual: 1, bonus: 10 },
                ],
            ],
        };
        const score = skScoreFromState(state);
        // Player 0: bid 0 / actual 0 (success on round 1, 2 players → 10 pts)
        expect(score["p1"]).toBe(10);
        // Player 1: bid 1 / actual 1 (success → 1*20 + bonus 10 = 30)
        expect(score["p2"]).toBe(30);
    });

    it("returns 0 for a player with no entries yet", () => {
        const state: SKGameState = {
            phase: "result-entry",
            players: [{ id: "p1", name: "A" }],
            currentRound: 1,
            currentPlayerIndex: 0,
            rounds: [[null]],
        };
        expect(skScoreFromState(state)["p1"]).toBe(0);
    });
});

describe("iaww scoreFromState", () => {
    it("computes a score per player from directVP + multipliers", () => {
        const state: IawwGameState = {
            phase: "scoring",
            players: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }],
            directVP: { p1: 12, p2: 5 },
            multipliers: {
                "str-res": { p1: { coeff: 6, count: 2 } }, // 6*2 = 12
            },
        };
        const score = iawwScoreFromState(state);
        // p1: direct 12 + multiplier 12 = 24
        expect(score["p1"]).toBe(24);
        // p2: direct 5, no multipliers
        expect(score["p2"]).toBe(5);
    });
});

describe("calculator registry", () => {
    it("looks up known kinds", () => {
        expect(getCalculator("skull-king")?.kind).toBe("skull-king");
        expect(getCalculator("iaww")?.kind).toBe("iaww");
    });

    it("returns undefined for unknown kinds", () => {
        expect(getCalculator("unknown")).toBeUndefined();
    });

    it("isCalculatorKind narrows known kinds", () => {
        expect(isCalculatorKind("skull-king")).toBe(true);
        expect(isCalculatorKind("nope")).toBe(false);
    });

    it("each adapter exposes editTitle, scoreFromState, toStorage, History", () => {
        for (const adapter of Object.values(CALCULATORS)) {
            expect(typeof adapter.editTitle).toBe("string");
            expect(typeof adapter.scoreFromState).toBe("function");
            expect(typeof adapter.toStorage).toBe("function");
            expect(adapter.History).toBeDefined();
        }
    });

    it("adapter scoreFromState delegates to the calculator's implementation", () => {
        const skAdapter = getCalculator("skull-king")!;
        const state: SKGameState = {
            phase: "result-entry",
            players: [{ id: "p1", name: "A" }],
            currentRound: 1,
            currentPlayerIndex: 0,
            rounds: [[{ bid: 0, actual: 0, bonus: 0 }]],
        };
        // Same result whether called directly or through the adapter.
        expect(skAdapter.scoreFromState(state)).toEqual(skScoreFromState(state));
    });
});
