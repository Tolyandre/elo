"use client";

import { EditCellDialog, GameTable, ScoreChart, TOTAL_ROUNDS } from "@/components/calculators/skull-king";
import type { GameState, RoundEntry } from "@/components/calculators/skull-king";
import { fromStorage } from "@/components/calculators/skull-king/storage";
import type { SkullKingStorage } from "@/components/calculators/skull-king/storage";
import { CalculatorHistory } from "@/components/calculators/calculator-history";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** A positional cell address in the rounds matrix. */
type Cell = { round: number; player: number };

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
    return (
        <CalculatorHistory<GameState, Cell>
            storage={storage}
            readOnly={readOnly}
            onStateChange={onStateChange}
            fromStorage={s => fromStorage(s as unknown as SkullKingStorage)}
            applyEdit={(state, { round: roundIndex, player: playerIndex }, entry) => {
                const newRounds = state.rounds.map(r => [...r]);
                // Ensure the round row exists and is long enough.
                while (newRounds.length <= roundIndex) newRounds.push([]);
                const row = newRounds[roundIndex];
                while (row.length <= playerIndex) row.push(null);
                row[playerIndex] = entry as RoundEntry;
                return { ...state, rounds: newRounds };
            }}
            table={(state, requestEdit) => (
                <div className="space-y-3">
                    <GameTable state={state} onCellClick={readOnly ? undefined : (r, p) => requestEdit({ round: r, player: p })} />
                    <Card>
                        <CardHeader>
                            <CardTitle>График очков</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ScoreChart state={state} />
                        </CardContent>
                    </Card>
                    <p className="text-xs text-muted-foreground">
                        Всего раундов: {TOTAL_ROUNDS}. Итоги пересчитываются автоматически при изменении ячейки.
                    </p>
                </div>
            )}
            dialog={({ state, target, save, close }) => (
                <EditCellDialog
                    open={!!target}
                    onClose={close}
                    roundIndex={target?.round ?? 0}
                    playerIndex={target?.player ?? 0}
                    state={state}
                    onSave={(roundIndex, playerIndex, entry) => save({ round: roundIndex, player: playerIndex }, entry)}
                    readOnly={readOnly}
                />
            )}
        />
    );
}
