import { describe, it, expect } from "vitest";
import type { Base58ID } from "@/lib/id";
import type { SkullKingGameState, SkullKingRoundEntry } from "@/app/api";
import { mergeSkullKingStates } from "@/components/calculators/skull-king/merge";

const pid = (s: string) => s as Base58ID;

function state(opts: {
    phase?: SkullKingGameState["phase"];
    currentRound?: number;
    rounds?: (SkullKingRoundEntry | null)[][];
}): SkullKingGameState {
    return {
        phase: opts.phase ?? "waiting-for-bids",
        players: [{ id: pid("p1"), name: "Аня" }, { id: pid("p2"), name: "Боря" }],
        currentRound: opts.currentRound ?? 1,
        currentPlayerIndex: 0,
        rounds: opts.rounds ?? [],
    };
}

const slot = (bid: number, actual: number | null = null): SkullKingRoundEntry => ({ bid, actual, bonus: 0 });

describe("mergeSkullKingStates", () => {
    it("keeps the host's edited slot and the player's concurrent bid", () => {
        const rounds = [[slot(2), slot(3)]];
        const before = state({ rounds });
        const local = state({ rounds: [[{ bid: 2, actual: 1, bonus: 0 }, slot(3)]] }); // host entered p1's result
        const fresh = state({ rounds: [[slot(2), slot(5)]] }); // player p2 changed their bid meanwhile
        const merged = mergeSkullKingStates(before, local, fresh);
        expect(merged.rounds[0][0]).toEqual({ bid: 2, actual: 1, bonus: 0 }); // the host's edit
        expect(merged.rounds[0][1]).toEqual(slot(5)); // the player's concurrent bid
    });

    it("keeps the editor's value in a same-slot race", () => {
        const before = state({ rounds: [[slot(2), null]] });
        const local = state({ rounds: [[slot(4), null]] }); // the host corrected the bid
        const fresh = state({ rounds: [[slot(6), null]] }); // raced write on the same slot
        const merged = mergeSkullKingStates(before, local, fresh);
        // Last write wins: the editor's just-confirmed value.
        expect(merged.rounds[0][0]).toEqual(slot(4));
    });

    it("takes the server's scalars when the editor did not change them", () => {
        const before = state({ phase: "waiting-for-bids", currentRound: 1 });
        const local = state({ phase: "waiting-for-bids", currentRound: 1 });
        const fresh = state({ phase: "result-entry", currentRound: 2 });
        const merged = mergeSkullKingStates(before, local, fresh);
        expect(merged.phase).toBe("result-entry");
        expect(merged.currentRound).toBe(2);
    });

    it("keeps the editor's scalar in a race", () => {
        const before = state({ phase: "waiting-for-bids" });
        const local = state({ phase: "bid-review" });
        const fresh = state({ phase: "result-entry" });
        const merged = mergeSkullKingStates(before, local, fresh);
        expect(merged.phase).toBe("bid-review");
    });

    it("adopts the server's round shape (fresh is authoritative)", () => {
        const before = state({ rounds: [[slot(2), null]] });
        const local = state({ rounds: [[slot(2), slot(3)]] });
        const fresh = state({ currentRound: 2, rounds: [[slot(2), slot(3)], [null, null]] });
        const merged = mergeSkullKingStates(before, local, fresh);
        expect(merged.rounds).toHaveLength(2);
        expect(merged.rounds[0][1]).toEqual(slot(3));
        expect(merged.rounds[1]).toEqual([null, null]);
    });
});
