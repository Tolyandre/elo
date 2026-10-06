"use client";

import { ScoringTable } from "@/components/calculators/iaww/scoring-table";
import { EditDialog } from "@/components/calculators/iaww/edit-dialog";
import { fromStorage } from "@/components/calculators/iaww/storage";
import type { IAWWStorage } from "@/components/calculators/iaww/storage";
import type { CellValue, EditTarget, GameState } from "@/components/calculators/iaww/scoring";
import { CalculatorHistory } from "@/components/calculators/calculator-history";

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
    return (
        <CalculatorHistory<GameState, EditTarget>
            storage={storage}
            readOnly={readOnly}
            onStateChange={onStateChange}
            fromStorage={s => fromStorage(s as unknown as IAWWStorage)}
            applyEdit={(state, target, value) => {
                if (target.kind === "direct") {
                    return {
                        ...state,
                        directVP: { ...state.directVP, [target.playerId]: value as number },
                    };
                }
                const row = state.multipliers[target.rowId] ?? {};
                return {
                    ...state,
                    multipliers: {
                        ...state.multipliers,
                        [target.rowId]: { ...row, [target.playerId]: value as CellValue },
                    },
                };
            }}
            table={(state, requestEdit) => (
                <ScoringTable state={state} onEdit={requestEdit} readOnly={readOnly} />
            )}
            dialog={({ state, target, save, close }) => (
                <EditDialog
                    target={target}
                    state={state}
                    onClose={close}
                    onSave={(editTarget, value) => save(editTarget, value)}
                    readOnly={readOnly}
                />
            )}
        />
    );
}
