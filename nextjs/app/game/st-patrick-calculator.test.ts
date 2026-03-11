import { describe, it, expect } from "vitest"
import { forcedToTakeProbability } from "./st-patrick"

describe("forcedToTakeProbability", () => {
    it("returns 0 when H=0 (no higher black cards)", () => {
        expect(forcedToTakeProbability(2, 3, 2, 0)).toBe(0);
        expect(forcedToTakeProbability(3, 9, 4, 0)).toBe(0);
        expect(forcedToTakeProbability(1, 3, 0, 0)).toBe(0);
    });

    it("returns 1 when single opponent has only higher black cards (L=0, all H fit in n slots)", () => {
        // m=1, n=3, L=0, H=2: opponent has 3 cards, 2 are higher black, no lower → forced
        expect(forcedToTakeProbability(1, 3, 0, 2)).toBeCloseTo(1.0);
        // m=1, n=3, L=0, H=1: opponent has exactly 1 higher black → forced
        expect(forcedToTakeProbability(1, 3, 0, 1)).toBeCloseTo(1.0);
        // m=1, n=9, L=0, H=9: opponent's entire hand is higher black
        expect(forcedToTakeProbability(1, 9, 0, 9)).toBeCloseTo(1.0);
    });

    it("returns 0 when single opponent has lower black card (m=1, L>0)", () => {
        // m=1: only one opponent, they definitely have the lower card → not forced
        expect(forcedToTakeProbability(1, 3, 1, 1)).toBeCloseTo(0.0);
        expect(forcedToTakeProbability(1, 9, 3, 4)).toBeCloseTo(0.0);
    });

    it("returns 1 when H > 0 and L=0 with 2 opponents (someone has the higher card)", () => {
        // m=2, n=3, L=0, H=1: one higher card exists among 2 opponents → whoever has it is forced
        expect(forcedToTakeProbability(2, 3, 0, 1)).toBeCloseTo(1.0);
    });

    it("returns 3/5 for m=2, n=3, L=1, H=1 (verified by exhaustive enumeration)", () => {
        expect(forcedToTakeProbability(2, 3, 1, 1)).toBeCloseTo(3 / 5, 10);
    });

    it("probability is between 0 and 1", () => {
        const cases = [
            [2, 9, 2, 3],
            [3, 9, 0, 4],
            [3, 9, 4, 4],
            [2, 4, 1, 2],
            [1, 9, 2, 5],
        ];
        for (const [m, n, L, H] of cases) {
            const p = forcedToTakeProbability(m, n, L, H);
            expect(p).toBeGreaterThanOrEqual(0);
            expect(p).toBeLessThanOrEqual(1);
        }
    });

    it("probability increases monotonically with H (more higher cards → more likely to force)", () => {
        const m = 2, n = 9, L = 2;
        let prev = 0;
        for (let H = 1; H <= 6; H++) {
            const p = forcedToTakeProbability(m, n, L, H);
            expect(p).toBeGreaterThanOrEqual(prev);
            prev = p;
        }
    });

    it("probability decreases monotonically with L (more lower cards → less likely to force)", () => {
        const m = 2, n = 9, H = 4;
        let prev = forcedToTakeProbability(m, n, 0, H);
        for (let L = 1; L <= 5; L++) {
            const p = forcedToTakeProbability(m, n, L, H);
            expect(p).toBeLessThanOrEqual(prev);
            prev = p;
        }
    });
});
