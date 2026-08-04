"use client";

import React, { useState } from "react";
import { EditCellDialog, GameTable, TOTAL_ROUNDS } from "@/components/calculators/skull-king";
import { fromStorage } from "@/components/calculators/skull-king/storage";
import type { SkullKingStorage } from "@/components/calculators/skull-king/storage";
import type { GameState, RoundEntry } from "@/components/calculators/skull-king";

/**
 * Skull King calculator in history mode — re-opens a saved match's
 * round-by-round breakdown so the host can edit a cell and recompute scores.
 *
 * Differences from the live calculator:
 *   - no setup phase (players are fixed by the match)
 *   - no table/lobby (history is a local re-edit)
 *   - state lives in useState (not localStorage); persistence is via the
 *     server's PUT /matches/{id}, not a draft
 *   - readOnly (when the user is not an editor) makes the dialogs view-only
 */
export function SkullKingHistory({
    storage,
    readOnly,
    onStateChange,
}: {
    storage: Record<string, unknown>;
    readOnly: boolean;
    onStateChange: (state: unknown) => void;
}) {
    const [state, setState] = useState<GameState>(() => fromStorage(storage as unknown as SkullKingStorage));
    const [editCell, setEditCell] = useState<{ round: number; player: number } | null>(null);

    function handleSaveCell(roundIndex: number, playerIndex: number, entry: RoundEntry) {
        const newRounds = state.rounds.map(r => [...r]);
        // Ensure the round row exists and is long enough.
        while (newRounds.length <= roundIndex) newRounds.push([]);
        const row = newRounds[roundIndex];
        while (row.length <= playerIndex) row.push(null);
        row[playerIndex] = entry;
        const next: GameState = { ...state, rounds: newRounds };
        setState(next);
        onStateChange(next);
    }

    return (
        <div className="space-y-3">
            <GameTable state={state} onCellClick={readOnly ? undefined : (r, p) => setEditCell({ round: r, player: p })} />
            <EditCellDialog
                open={!!editCell}
                onClose={() => setEditCell(null)}
                roundIndex={editCell?.round ?? 0}
                playerIndex={editCell?.player ?? 0}
                state={state}
                onSave={handleSaveCell}
                readOnly={readOnly}
            />
            <p className="text-xs text-muted-foreground">
                Всего раундов: {TOTAL_ROUNDS}. Итоги пересчитываются автоматически при изменении ячейки.
            </p>
        </div>
    );
}

