import { describe, it, expect } from "vitest";
import type { Base58ID } from "@/lib/id";
import type { IawwCell, IawwGameState } from "@/app/api";
import { mergeIawwStates } from "@/components/calculators/iaww/merge";

const pid = (s: string) => s as Base58ID;

function state(entries: {
    id: string; name: string;
    directVp?: number | null;
    cells?: IawwCell[];
    done?: boolean;
}[]): IawwGameState {
    return {
        phase: "scoring",
        players: entries.map((e) => ({ id: pid(e.id), name: e.name })),
        entries: entries.map((e) => ({
            playerId: pid(e.id),
            directVp: e.directVp ?? null,
            cells: e.cells ?? [],
            done: e.done ?? false,
        })),
    };
}

const cell = (row: string, count: number): IawwCell => ({ row, coeff: 6, count });

describe("mergeIawwStates", () => {
    it("combines cells only one side touched", () => {
        const before = state([{ id: "p1", name: "Аня", cells: [cell("structure", 1)] }]);
        const local = state([{ id: "p1", name: "Аня", cells: [cell("structure", 2)] }]);
        const fresh = state([{ id: "p1", name: "Аня", cells: [cell("structure", 1), cell("vehicle", 3)] }]);
        const merged = mergeIawwStates(before, local, fresh);
        // host's structure edit survives the player's submit, player's vehicle arrives
        expect(merged.entries[0].cells).toEqual([cell("structure", 2), cell("vehicle", 3)]);
    });

    it("keeps host-entered rows the player's submit does not carry", () => {
        const before = state([{ id: "p1", name: "Аня", cells: [] }]);
        const local = state([{ id: "p1", name: "Аня", cells: [cell("structure", 2)] }]);
        const fresh = state([{ id: "p1", name: "Аня", cells: [cell("vehicle", 3)] }]);
        const merged = mergeIawwStates(before, local, fresh);
        expect(merged.entries[0].cells).toEqual([cell("structure", 2), cell("vehicle", 3)]);
    });

    it("treats equal edits of the same cell as no conflict", () => {
        const before = state([{ id: "p1", name: "Аня", cells: [] }]);
        const local = state([{ id: "p1", name: "Аня", cells: [cell("structure", 2)] }]);
        const fresh = state([{ id: "p1", name: "Аня", cells: [cell("structure", 2)] }]);
        const merged = mergeIawwStates(before, local, fresh);
        expect(merged.entries[0].cells).toEqual([cell("structure", 2)]);
    });

    it("keeps the editor's value in a same-cell race", () => {
        const before = state([{ id: "p1", name: "Аня", cells: [] }]);
        const local = state([{ id: "p1", name: "Аня", cells: [cell("structure", 2)] }]);
        const fresh = state([{ id: "p1", name: "Аня", cells: [cell("structure", 5)] }]);
        const merged = mergeIawwStates(before, local, fresh);
        // Last write wins: the editor's just-confirmed value.
        expect(merged.entries[0].cells).toEqual([cell("structure", 2)]);
    });

    it("merges directVp three-way", () => {
        // Only the host (local) changed it.
        const hostEdit = mergeIawwStates(
            state([{ id: "p1", name: "Аня", directVp: 2 }]),
            state([{ id: "p1", name: "Аня", directVp: 4 }]),
            state([{ id: "p1", name: "Аня", directVp: 2 }]),
        );
        expect(hostEdit.entries[0].directVp).toBe(4);

        // Only the player's submit changed it.
        const playerSubmit = mergeIawwStates(
            state([{ id: "p1", name: "Аня", directVp: 2 }]),
            state([{ id: "p1", name: "Аня", directVp: 2 }]),
            state([{ id: "p1", name: "Аня", directVp: 7 }]),
        );
        expect(playerSubmit.entries[0].directVp).toBe(7);

        // Both changed it to the same value.
        const equal = mergeIawwStates(
            state([{ id: "p1", name: "Аня", directVp: 2 }]),
            state([{ id: "p1", name: "Аня", directVp: 5 }]),
            state([{ id: "p1", name: "Аня", directVp: 5 }]),
        );
        expect(equal.entries[0].directVp).toBe(5);

        // Both changed it differently: the editor's value wins.
        const raced = mergeIawwStates(
            state([{ id: "p1", name: "Аня", directVp: 2 }]),
            state([{ id: "p1", name: "Аня", directVp: 4 }]),
            state([{ id: "p1", name: "Аня", directVp: 7 }]),
        );
        expect(raced.entries[0].directVp).toBe(4);
    });

    it("keeps the server's done flag and keeps untouched entries", () => {
        const before = state([
            { id: "p1", name: "Аня", done: false },
            { id: "p2", name: "Боря", cells: [cell("culture", 1)] },
        ]);
        const local = state([
            { id: "p1", name: "Аня", done: false },
            { id: "p2", name: "Боря", cells: [cell("culture", 1), cell("general", 2)] },
        ]);
        const fresh = state([
            { id: "p1", name: "Аня", done: true },
            { id: "p2", name: "Боря", cells: [cell("culture", 1)] },
        ]);
        const merged = mergeIawwStates(before, local, fresh);
        expect(merged.entries[0].done).toBe(true);
        expect(merged.entries[1].cells).toEqual([cell("culture", 1), cell("general", 2)]);
    });

    it("keeps the server roster and phase", () => {
        const before = state([{ id: "p1", name: "Аня" }]);
        const local = state([{ id: "p1", name: "Аня" }]);
        const fresh = {
            ...state([
                { id: "p1", name: "Аня" },
                { id: "p2", name: "Боря" },
            ]),
            phase: "scoring" as const,
        };
        const merged = mergeIawwStates(before, local, fresh);
        expect(merged.players).toHaveLength(2);
        expect(merged.entries).toHaveLength(2);
        expect(merged.phase).toBe("scoring");
    });
});
