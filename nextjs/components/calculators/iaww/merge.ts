// Three-way merge of live IAWW table states. The host edits any cell and the
// patch syncs instantly, while a connected player types locally and sends
// their whole column at once with "Готово" — when both land together,
// fields only one side touched combine silently, equal edits collapse, and
// a real same-field race keeps the editor's value (last write wins — the
// informed choice happens in the edit dialog before saving).

import type { IawwCell, IawwGameState } from "@/app/api";

// If the editor didn't touch a field, the server's value wins; if they did,
// their value wins (equal edits collapse naturally).
function threeWay<T>(base: T, local: T, fresh: T): T {
    return local === base ? fresh : local;
}

/** Merges multiplier cells keyed by row; absence counts as a value. */
function mergeCells(before: IawwCell[], local: IawwCell[], fresh: IawwCell[]): IawwCell[] {
    const same = (a?: IawwCell, b?: IawwCell) =>
        a === b || (!!a && !!b && a.coeff === b.coeff && a.count === b.count);
    const byRow = (cells: IawwCell[]) => new Map(cells.map((c) => [c.row, c]));
    const b = byRow(before), l = byRow(local), f = byRow(fresh);

    const merged: IawwCell[] = [];
    const rows = new Set<string>([...b.keys(), ...l.keys(), ...f.keys()]);
    for (const row of rows) {
        if (same(l.get(row), b.get(row))) {
            const fc = f.get(row);
            if (fc) merged.push(fc);
        } else {
            const lc = l.get(row);
            if (lc) merged.push(lc);
        }
    }
    return merged;
}

/**
 * Merges the host's local edit (`local`, based on `before`) onto the server's
 * `fresh` state. Roster and phase are fixed during scoring — always the
 * server's; per-player entries merge field by field.
 */
export function mergeIawwStates(
    before: IawwGameState,
    local: IawwGameState,
    fresh: IawwGameState,
): IawwGameState {
    return {
        ...fresh,
        entries: fresh.entries.map((freshEntry) => {
            const localEntry = local.entries.find((e) => e.playerId === freshEntry.playerId) ?? freshEntry;
            const beforeEntry = before.entries.find((e) => e.playerId === freshEntry.playerId) ?? freshEntry;
            return {
                ...freshEntry,
                directVp: threeWay(
                    beforeEntry.directVp ?? null,
                    localEntry.directVp ?? null,
                    freshEntry.directVp ?? null,
                ),
                // `done` is monotonic (only the player's submit sets it).
                done: threeWay(beforeEntry.done, localEntry.done, freshEntry.done),
                cells: mergeCells(beforeEntry.cells, localEntry.cells, freshEntry.cells),
            };
        }),
    };
}
