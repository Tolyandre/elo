"use client";

import React, { useState } from "react";
import { ScoringTable } from "@/components/calculators/iaww/scoring-table";
import { EditDialog } from "@/components/calculators/iaww/edit-dialog";
import { fromStorage } from "@/components/calculators/iaww/storage";
import type { IAWWStorage } from "@/components/calculators/iaww/storage";
import type { CellValue, EditTarget, GameState } from "@/components/calculators/iaww/scoring";

/**
 * It's a Wonderful World calculator in history mode — re-opens a saved
 * match's cell-by-cell breakdown so the host can edit a cell and recompute
 * scores. Differences from the live calculator mirror the Skull King one:
 * no setup phase, no localStorage (server is the source of truth), and a
 * read-only mode for non-editors.
 */
export function IawwHistory({
    storage,
    readOnly,
    onStateChange,
}: {
    storage: Record<string, unknown>;
    readOnly: boolean;
    onStateChange: (state: unknown) => void;
}) {
    const [state, setState] = useState<GameState>(() => fromStorage(storage as unknown as IAWWStorage));
    const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

    function handleSaveCell(target: EditTarget, value: number | CellValue) {
        let next: GameState;
        if (target.kind === "direct") {
            next = {
                ...state,
                directVP: { ...state.directVP, [target.playerId]: value as number },
            };
        } else {
            const row = state.multipliers[target.rowId] ?? {};
            next = {
                ...state,
                multipliers: {
                    ...state.multipliers,
                    [target.rowId]: { ...row, [target.playerId]: value as CellValue },
                },
            };
        }
        setState(next);
        onStateChange(next);
    }

    return (
        <div className="space-y-3">
            <ScoringTable state={state} onEdit={readOnly ? () => {} : setEditTarget} readOnly={readOnly} />
            <EditDialog
                target={editTarget}
                state={state}
                onClose={() => setEditTarget(null)}
                onSave={handleSaveCell}
                readOnly={readOnly}
            />
        </div>
    );
}

