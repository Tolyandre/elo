import { describe, it, expect } from "vitest";
import { toStorage, fromStorage } from "../components/calculators/skull-king/storage";
import { toStorage as iawwToStorage, fromStorage as iawwFromStorage } from "../components/calculators/iaww/storage";
import type { GameState as SKGameState } from "../components/calculators/skull-king";
import type { GameState as IawwGameState } from "../components/calculators/iaww/scoring";

describe("skull-king storage roundtrip", () => {
    it("keeps player ids under player_id (normalized shape)", () => {
        const state: SKGameState = {
            phase: "result-entry",
            players: [
                { id: "p-alpha", name: "Alpha" },
                { id: "p-beta", name: "Beta" },
            ],
            currentRound: 2,
            currentPlayerIndex: 1,
            rounds: [
                [
                    { bid: 0, actual: 0, bonus: 0 },
                    { bid: 1, actual: 1, bonus: 10 },
                ],
            ],
            fallbackGameId: "g-1",
        };
        const s = toStorage(state);
        // Every player reference must live under "player_id", never as an object
        // key, so idcodec rewrites ids at the HTTP boundary.
        expect(s.players).toEqual([
            { player_id: "p-alpha", name: "Alpha" },
            { player_id: "p-beta", name: "Beta" },
        ]);
        // rounds stay positional (no player ids embedded).
        expect(s.rounds).toEqual([
            [
                { bid: 0, actual: 0, bonus: 0 },
                { bid: 1, actual: 1, bonus: 10 },
            ],
        ]);
        expect(s.schema_version).toBe(1);
    });

    it("round-trips through fromStorage(toStorage(state)) preserving the breakdown", () => {
        const state: SKGameState = {
            phase: "result-entry",
            players: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }],
            currentRound: 5,
            currentPlayerIndex: 0,
            rounds: [
                [{ bid: 0, actual: 0, bonus: 0 }, null],
                [null, { bid: 2, actual: 1, bonus: 0 }],
            ],
        };
        const restored = fromStorage(toStorage(state));
        expect(restored.players).toEqual(state.players);
        expect(restored.rounds).toEqual(state.rounds);
        expect(restored.currentRound).toBe(5);
        expect(restored.currentPlayerIndex).toBe(0);
    });

    it("preserves null rounds/cells (partial game)", () => {
        const state: SKGameState = {
            phase: "setup",
            players: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }],
            currentRound: 1,
            currentPlayerIndex: 0,
            rounds: [[null, null]],
        };
        const restored = fromStorage(toStorage(state));
        expect(restored.rounds).toEqual([[null, null]]);
    });
});

describe("iaww storage roundtrip", () => {
    it("moves Record<playerId, ...> maps into arrays under player_id", () => {
        const state: IawwGameState = {
            phase: "scoring",
            players: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }],
            directVP: { p1: 12, p2: 0 },
            multipliers: {
                "str-res": { p1: { coeff: 6, count: 2 } },
            },
            fallbackGameId: "g-iaww",
        };
        const s = iawwToStorage(state);
        // directVP keys → array of { player_id, value }
        expect(s.direct_vp).toContainEqual({ player_id: "p1", value: 12 });
        expect(s.direct_vp).toContainEqual({ player_id: "p2", value: 0 });
        // multipliers[rowId][playerId] → flat array; the row identifier lives
        // under "row" (NOT "row_id", which idcodec would corrupt).
        expect(s.multipliers).toEqual([
            { row: "str-res", player_id: "p1", coeff: 6, count: 2 },
        ]);
        expect(s.players).toEqual([
            { player_id: "p1", name: "A" },
            { player_id: "p2", name: "B" },
        ]);
        expect(s.schema_version).toBe(2);
    });

    it("round-trips through fromStorage(toStorage(state)) preserving the breakdown", () => {
        const state: IawwGameState = {
            phase: "scoring",
            players: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }],
            directVP: { p1: 5 },
            multipliers: {
                "str-res": { p1: { coeff: 6, count: 2 } },
                "res-dis": { p2: { coeff: 10, count: 1 } },
            },
        };
        const restored = iawwFromStorage(iawwToStorage(state));
        expect(restored.players).toEqual(state.players);
        expect(restored.directVP).toEqual(state.directVP);
        expect(restored.multipliers).toEqual(state.multipliers);
    });

    it("fromStorage lands in scoring phase (history mode)", () => {
        const restored = iawwFromStorage({
            schema_version: 2,
            players: [{ player_id: "p1", name: "A" }, { player_id: "p2", name: "B" }],
            direct_vp: [],
            multipliers: [],
        });
        expect(restored.phase).toBe("scoring");
    });
});
