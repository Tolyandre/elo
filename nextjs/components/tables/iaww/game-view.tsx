"use client";

import { useState, useMemo, useRef } from "react";
import type { IawwGameState, TableSubmitInput } from "@/app/api";
import { isIawwState } from "@/lib/game-apps";
import { liveToCalc } from "@/components/calculators/iaww/live";
import type { CellValue, EditTarget, GameState } from "@/components/calculators/iaww/scoring";
import { playerTotal } from "@/components/calculators/iaww/scoring";
import { toStorage } from "@/components/calculators/iaww/storage";
import { VictoryPoints } from "@/components/calculators/iaww/victory-points";
import { EditDialog } from "@/components/calculators/iaww/edit-dialog";
import { ScoringTable } from "@/components/calculators/iaww/scoring-table";
import { MatchSaveSection } from "@/components/tables/match-save-section";
import { Button } from "@/components/ui/button";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { TableGameViewProps } from "@/components/tables/registry";

type CellEditValue = number | CellValue | null;

function cellValuesEqual(a: CellEditValue, b: CellEditValue): boolean {
    if (typeof a === "number" || typeof b === "number") return a === b;
    if (!a || !b) return !a && !b;
    return a.coeff === b.coeff && a.count === b.count;
}

function formatCellValue(v: CellEditValue): string {
    if (typeof v === "number") return String(v);
    if (!v) return "—";
    return `${v.count}×${v.coeff}`;
}

// ─── IAWW in-table UI (ADR-16) ───────────────────────────────────────────────
//
// One scoring phase: every participant fills their own column (the host can
// edit anything), each cell edit syncs instantly, «Готово» locks the column,
// and the host saves the final match. Participants are picked at table
// creation — there is no setup phase here.

export function IawwGameView({
    gameState,
    isHost,
    myPlayerIndex,
    syncHostState,
    submitInput,
    campSelection,
    me,
    saving,
    saveError,
    saveMatch,
}: TableGameViewProps) {
    // The page dispatches by game_id, so this is always an IAWW state; the
    // guard only bridges the union typing (null before the first snapshot —
    // the page shows its connecting card then).
    const state: IawwGameState | null = gameState !== null && isIawwState(gameState)
        ? gameState
        : null;

    const myPlayerId = myPlayerIndex !== null ? state?.players[myPlayerIndex]?.id ?? null : null;
    const myEntry = myPlayerIndex !== null ? state?.entries[myPlayerIndex] ?? null : null;

    const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
    // The cell's value as the dialog opened — what the user is editing on top
    // of. Compared against the latest server value at save time (Google
    // Sheets-style): equal → proceed silently; changed meanwhile → warn.
    const [editSeen, setEditSeen] = useState<number | CellValue | null>(null);

    const calcState: GameState | null = useMemo(() => (state ? liveToCalc(state) : null), [state]);

    const canEditOwnColumn = !isHost && myPlayerId !== null && !(myEntry?.done ?? false);

    function readCellValue(target: EditTarget): number | CellValue | null {
        if (!state) return null;
        const entry = state.entries.find((e) => e.playerId === target.playerId);
        if (target.kind === "direct") return entry?.directVp ?? 0;
        const cell = entry?.cells.find((c) => c.row === target.rowId);
        return cell ? { coeff: cell.coeff, count: cell.count } : null;
    }

    function openEdit(target: EditTarget) {
        setEditSeen(readCellValue(target));
        setEditTarget(target);
    }

    // Connected players sync each cell edit instantly, same as the host. A
    // queue serializes the submits so rapid edits reach the server in click
    // order and the adopted snapshots never regress; on a failure the hook
    // refreshes from the server and the toast says the edit did not land.
    const submitQueue = useRef<Promise<void>>(Promise.resolve());
    function enqueuePlayerSubmit(input: TableSubmitInput) {
        const run = submitQueue.current.then(() => submitInput(input));
        submitQueue.current = run.then(
            () => undefined,
            (err) => {
                toast.error(err instanceof Error ? err.message : String(err));
            },
        );
    }

    function applyCellEdit(target: EditTarget, value: number | CellValue) {
        if (!state) return;
        if (isHost) {
            // Host edits go straight to the server table (versioned patch).
            void syncHostState((prev) => {
                if (!isIawwState(prev)) return prev;
                const idx = prev.entries.findIndex((e) => e.playerId === target.playerId);
                if (idx === -1 || prev.phase !== "scoring") return prev;
                const entries = prev.entries.map((e, i) => {
                    if (i !== idx) return e;
                    if (target.kind === "direct") {
                        return { ...e, directVp: value as number };
                    }
                    const cells = value && (value as CellValue).count > 0
                        ? [
                            ...e.cells.filter((c) => c.row !== target.rowId),
                            { row: target.rowId, coeff: (value as CellValue).coeff, count: (value as CellValue).count },
                        ]
                        : e.cells.filter((c) => c.row !== target.rowId);
                    return { ...e, cells };
                });
                return { ...prev, entries };
            });
            return;
        }
        // Connected player: one partial submit per edit; the column is
        // finished with "Готово", after that only the host can correct it.
        if (!canEditOwnColumn || target.playerId !== myPlayerId) return;
        if (target.kind === "direct") {
            enqueuePlayerSubmit({ done: false, directVp: value as number, cells: [] });
            return;
        }
        const cell = value as CellValue | null;
        enqueuePlayerSubmit({
            done: false,
            // count 0 clears the row server-side
            cells: cell && cell.count > 0
                ? [{ row: target.rowId, coeff: cell.coeff, count: cell.count }]
                : [{ row: target.rowId, coeff: 0, count: 0 }],
        });
    }

    // The user confirmed the dialog: if nobody changed the cell since they
    // saw it — or their value already matches what's there now (someone saved
    // exactly this) — apply the edit; otherwise let them choose.
    function handleSaveCell(target: EditTarget, value: number | CellValue) {
        const current = readCellValue(target);
        if (cellValuesEqual(editSeen, current) || cellValuesEqual(value, current)) {
            applyCellEdit(target, value);
            return;
        }
        setOverwriteChoice({ target, value, seen: editSeen, current });
    }

    // Someone changed the cell between dialog open and save — the user
    // decides (same UX for the host and a connected player).
    const [overwriteChoice, setOverwriteChoice] = useState<{
        target: EditTarget;
        value: number | CellValue;
        seen: number | CellValue | null;
        current: number | CellValue | null;
    } | null>(null);

    function settleOverwrite(apply: boolean) {
        if (overwriteChoice && apply) applyCellEdit(overwriteChoice.target, overwriteChoice.value);
        setOverwriteChoice(null);
    }

    const [isSending, setIsSending] = useState(false);

    async function submitMyScore() {
        if (!canEditOwnColumn || !myPlayerId) return;
        setIsSending(true);
        try {
            // Every edit is already on the server; "Готово" only locks the
            // column (directVp/cells omitted — nothing left to change).
            await submitQueue.current;
            await submitInput({ done: true, cells: [] });
            toast.success("Счёт отправлен");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        } finally {
            setIsSending(false);
        }
    }

    // ── Save (host) ─────────────────────────────────────────────────────────

    async function saveGame() {
        if (!state || !calcState) return;
        const score: Record<string, number> = {};
        state.players.forEach((p) => {
            score[p.id] = playerTotal(calcState, p.id);
        });
        await saveMatch({
            score,
            calculatorData: toStorage(calcState) as unknown as Record<string, never>,
        });
    }

    // ── Render ──────────────────────────────────────────────────────────────

    // Before the first snapshot there is nothing to render yet — the page
    // shows its connecting card around this view.
    if (!state || !calcState) return null;

    const doneCount = state.entries.filter((e) => e.done).length;

    return (
        <>
            {/* Per-player progress (host sees who has finished editing) */}
            {state.entries.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                    {state.players.map((p, i) => {
                        const done = state.entries[i]?.done;
                        return (
                            <div key={p.id} className="flex items-center gap-1">
                                {done
                                    ? <Check className="h-3 w-3 text-green-600" />
                                    : <span className="h-3 w-3 rounded-full border border-muted-foreground inline-block shrink-0" />
                                }
                                <span className={done ? "text-foreground" : "text-muted-foreground"}>
                                    {p.name}
                                </span>
                            </div>
                        );
                    })}
                    {isHost && (
                        <span className="text-muted-foreground">Готовы {doneCount}/{state.entries.length}</span>
                    )}
                </div>
            )}

            {/* Viewer banner */}
            {!isHost && myPlayerIndex === null && (
                <p className="text-sm text-muted-foreground text-center">Просмотр — ожидание ведущего...</p>
            )}

            <ScoringTable
                state={calcState}
                onEdit={openEdit}
                readOnly={isHost ? false : !canEditOwnColumn}
                editablePlayerIds={isHost ? undefined : myPlayerId ? [myPlayerId] : []}
            />

            <EditDialog
                target={editTarget}
                state={calcState}
                onClose={() => setEditTarget(null)}
                onSave={handleSaveCell}
                readOnly={isHost ? false : !canEditOwnColumn}
            />

            {/* Connected player: one-shot submit */}
            {canEditOwnColumn && (
                <Button
                    className="w-full md:h-12 md:text-base"
                    disabled={isSending}
                    onClick={submitMyScore}
                >
                    {isSending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Готово — отправить счёт"}
                </Button>
            )}
            {!isHost && myEntry?.done && (
                <p className="text-sm text-green-700 text-center flex items-center justify-center gap-2">
                    <Check className="h-4 w-4" />
                    Счёт отправлен — ждите ведущего
                </p>
            )}

            {/* Save section (host) */}
            {isHost && (
                <MatchSaveSection selection={campSelection} error={saveError} className="pt-2">
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button className="w-full" disabled={saving || !me.canEdit}>
                                {saving ? "Сохранение…" : "Сохранить партию"}
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Сохранить партию?</AlertDialogTitle>
                                <AlertDialogDescription asChild>
                                    <span className="space-y-1 mt-1 flex flex-col">
                                        {state.players.map((p) => (
                                            <span key={p.id} className="flex items-center justify-between gap-4">
                                                <span>{p.name}</span>
                                                <VictoryPoints value={playerTotal(calcState, p.id)} />
                                            </span>
                                        ))}
                                    </span>
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Отмена</AlertDialogCancel>
                                <AlertDialogAction onClick={saveGame}>Сохранить</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </MatchSaveSection>
            )}

            {/* The cell changed between dialog open and save (someone else's
                edit landed): the user decides whose value wins — the same UX
                for the host and a connected player. */}
            <AlertDialog
                open={!!overwriteChoice}
                onOpenChange={(open) => {
                    if (!open && overwriteChoice) settleOverwrite(false);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Ячейку уже изменили</AlertDialogTitle>
                        <AlertDialogDescription>
                            Пока вы редактировали, значение изменилось: было «{formatCellValue(overwriteChoice?.seen ?? null)}»,
                            стало «{formatCellValue(overwriteChoice?.current ?? null)}».
                            Сохранить ваше «{formatCellValue(overwriteChoice?.value ?? null)}»?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => settleOverwrite(false)}>
                            Оставить новое
                        </AlertDialogCancel>
                        <AlertDialogAction onClick={() => settleOverwrite(true)}>
                            Сохранить моё
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
