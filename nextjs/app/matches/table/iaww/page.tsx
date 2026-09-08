"use client";
import type { Base58ID } from "@/lib/id";

import React, { Suspense, useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { usePlayers } from "@/app/players/PlayersContext";
import {
    createTablePromise,
    deleteTablePromise,
    IawwGameState,
    TableSubmitInput,
} from "@/app/api";
import { GAME_ID_IAWW } from "@/lib/game-apps";
import {
    initialLiveState,
    isIawwGameState,
    liveToCalc,
} from "@/components/calculators/iaww/live";
import { mergeIawwStates } from "@/components/calculators/iaww/merge";
import type { CellValue, EditTarget, GameState } from "@/components/calculators/iaww/scoring";
import { playerTotal } from "@/components/calculators/iaww/scoring";
import { toStorage } from "@/components/calculators/iaww/storage";
import { VictoryPoints } from "@/components/calculators/iaww/victory-points";
import { EditDialog } from "@/components/calculators/iaww/edit-dialog";
import { ScoringTable } from "@/components/calculators/iaww/scoring-table";
import { useTableSession } from "@/hooks/useTableSession";
import { useTableDeepLink } from "@/hooks/useTableDeepLink";
import { useOffline, loadOfflineStore } from "@/app/offline/OfflineContext";
import { useTournamentSelection } from "@/hooks/useTournamentSelection";
import { TournamentCheckboxes } from "@/components/tournament-checkboxes";
import { PlayerMultiSelect } from "@/components/player-multi-select";
import { AuthWarning } from "@/components/auth-warning";
import { TableStatusBanner } from "@/components/tables/table-status-banner";
import { TakeoverButton } from "@/components/tables/takeover-button";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/app/pageHeaderContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Check, Loader2 } from "lucide-react";
import { useMe } from "@/app/meContext";
import { toast } from "sonner";

const PAGE_PATH = "/matches/table/iaww";

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

// See the Skull King table page for the rationale.
async function waitForSyncedMatch(matchId: string, timeoutMs = 10_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    await new Promise((r) => setTimeout(r, 400));
    while (Date.now() < deadline) {
        if (!loadOfflineStore().matches.some((m) => m.clientId === matchId)) return true;
        await new Promise((r) => setTimeout(r, 400));
    }
    return false;
}

export default function IawwTablePage() {
    return (
        <Suspense>
            <IawwTable />
        </Suspense>
    );
}

function IawwTable() {
    const me = useMe();
    const { players: allPlayers, playerDisplayName } = usePlayers();
    const { submitMatch } = useOffline();
    const router = useRouter();

    const {
        hydrated,
        session: tableSession,
        gameState,
        setSession: setTableSession,
        resetTableSession,
        joinTable,
        takeoverHosting,
        syncHostState,
        submitInput,
        savedMatchId: sseSavedMatchId,
        closed: sseClosed,
        connected: sseConnected,
        table: currentTable,
        awaitingSnapshot,
    } = useTableSession<IawwGameState>({
        initial: initialLiveState,
        isGameState: isIawwGameState,
        me: { id: me.id, playerId: me.playerId },
        mergeStates: mergeIawwStates,
    });

    // ── Setup-screen state ──────────────────────────────────────────────────
    const [setupPlayerIds, setSetupPlayerIds] = useState<Base58ID[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // URL bindings (ADR-18): ?new=1 forces a fresh table (the /matches/new
    // links), ?table=<id> is the sticky shareable binding — a stored session
    // on that table resumes as-is, otherwise the table is joined (or watched
    // read-only by a visitor who cannot join). ?join= is a legacy alias.
    // See useTableDeepLink for the details.
    useTableDeepLink({
        pagePath: PAGE_PATH,
        gameId: GAME_ID_IAWW,
        hydrated,
        session: tableSession,
        me: { isAuthenticated: me.isAuthenticated, playerId: me.playerId },
        setSession: setTableSession,
        joinTable,
        resetTableSession,
    });

    // Claim hosting (edit permission; idempotent for the account that already
    // hosts — the second-device host scenario).
    const [isTakingOver, setIsTakingOver] = useState(false);
    async function handleTakeover() {
        setIsTakingOver(true);
        try {
            await takeoverHosting();
            toast.success("Вы ведущий");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        } finally {
            setIsTakingOver(false);
        }
    }

    async function startScoring() {
        const players = setupPlayerIds
            .map((id) => allPlayers.find((p) => p.id === id))
            .filter(Boolean)
            .map((p) => ({ id: p!.id, name: playerDisplayName(p!) }));
        if (players.length < 2) return;
        if (!(me.isAuthenticated && me.playerId)) return;

        const newState = {
            phase: "scoring" as const,
            players,
            entries: players.map((p) => ({
                playerId: p.id,
                directVp: null,
                cells: [],
                done: false,
            })),
        };

        setTableSession({ tableId: "" as Base58ID, isHost: true, myPlayerIndex: null });
        setIsSubmitting(true);
        try {
            const table = await createTablePromise(GAME_ID_IAWW, newState);
            setTableSession({ tableId: table.id, isHost: true, myPlayerIndex: null });
            // The table id stays in the URL: a refresh or a shared link
            // reopens exactly this table.
            router.replace(`${PAGE_PATH}?table=${table.id}`, { scroll: false });
        } catch (err) {
            toast.error("Не удалось создать стол: " + (err instanceof Error ? err.message : String(err)));
            resetTableSession();
        } finally {
            setIsSubmitting(false);
        }
    }

    // ── Scoring phase ───────────────────────────────────────────────────────

    const isHost = !tableSession || tableSession.isHost;
    const myPlayerIndex = tableSession?.myPlayerIndex ?? null;
    const myPlayerId = myPlayerIndex !== null ? gameState.players[myPlayerIndex]?.id ?? null : null;
    const myEntry = myPlayerIndex !== null ? gameState.entries[myPlayerIndex] ?? null : null;

    const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
    // The cell's value as the dialog opened — what the user is editing on top
    // of. Compared against the latest server value at save time (Google
    // Sheets-style): equal → proceed silently; changed meanwhile → warn.
    const [editSeen, setEditSeen] = useState<number | CellValue | null>(null);

    const calcState: GameState = useMemo(() => liveToCalc(gameState), [gameState]);

    const canEditOwnColumn = !isHost && myPlayerId !== null && !(myEntry?.done ?? false);

    function readCellValue(target: EditTarget): number | CellValue | null {
        const entry = gameState.entries.find((e) => e.playerId === target.playerId);
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
        if (isHost) {
            // Host edits go straight to the server table (versioned patch).
            void syncHostState((prev) => {
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

    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState("");
    const [isResetting, setIsResetting] = useState(false);
    const [resetDialogOpen, setResetDialogOpen] = useState(false);

    const [checkedTournamentIds, setCheckedTournamentIds] = useState<Base58ID[]>([]);
    const tournamentDate = useMemo(() => new Date(), []);
    const tournamentPlayerIds = useMemo(() => gameState.players.map((p) => p.id), [gameState.players]);
    const {
        active: activeTournamentsForSave,
        isMandatory: isTournamentMandatory,
        idsToSubmit: tournamentIdsToSubmit,
    } = useTournamentSelection(tournamentPlayerIds, tournamentDate);
    const toggleTournament = (id: Base58ID, checked: boolean) =>
        setCheckedTournamentIds((prev) =>
            checked ? [...new Set([...prev, id])] : prev.filter((t) => t !== id),
        );

    // Connected players are redirected to the saved match by the "saved" event.
    useEffect(() => {
        if (!sseSavedMatchId || tableSession?.isHost !== false) return;
        resetTableSession();
        router.push(`/matches/view?id=${sseSavedMatchId}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sseSavedMatchId]);

    // The host closed the table without saving: connected players go back to
    // the matches page (the hook already toasted and cleared the session).
    useEffect(() => {
        if (!sseClosed || tableSession?.isHost !== false) return;
        router.push("/matches");
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sseClosed]);

    // Host: confirm + delete the server table, then return to the matches page.
    async function closeTable() {
        if (tableSession?.isHost && tableSession.tableId) {
            setIsResetting(true);
            try { await deleteTablePromise(tableSession.tableId); }
            catch { /* ignore */ }
            finally { setIsResetting(false); }
        }
        resetTableSession();
        setSetupPlayerIds([]);
        setSaveError("");
        router.push("/matches");
    }

    async function saveGame() {
        setSaving(true);
        setSaveError("");
        try {
            const score: Record<string, number> = {};
            gameState.players.forEach((p) => {
                score[p.id] = playerTotal(calcState, p.id);
            });
            const result = await submitMatch({
                game_id: GAME_ID_IAWW,
                score,
                tournament_ids: tournamentIdsToSubmit(checkedTournamentIds),
                calculator_kind: "iaww",
                calculator_data: toStorage(liveToCalc(gameState)) as unknown as Record<string, never>,
            });
            if (tableSession?.tableId && (await waitForSyncedMatch(result.id))) {
                try { await deleteTablePromise(tableSession.tableId, result.id); } catch { /* ignore */ }
            }
            resetTableSession();
            router.push(`/matches/view?id=${result.id}`);
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    }

    // ── Render ──────────────────────────────────────────────────────────────

    const connecting = !hydrated || awaitingSnapshot;
    const doneCount = gameState.entries.filter((e) => e.done).length;

    // While connecting the game state is not known yet (the session is bound
    // but the first snapshot has not arrived) — never flash the setup screen,
    // which would invite creating a duplicate table.
    if (connecting) {
        return (
            <main className="max-w-sm md:max-w-5xl mx-auto space-y-4">
                <PageHeader title="Этот Безумный Мир" />
                <Card>
                    <CardContent className="py-8 flex items-center justify-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm">Подключение к столу...</span>
                    </CardContent>
                </Card>
            </main>
        );
    }

    if (gameState.phase === "setup") {
        return (
            <main className="max-w-sm md:max-w-2xl mx-auto space-y-4">
                <PageHeader title="Этот Безумный Мир" />
                <Card>
                    <CardHeader>
                        <CardTitle>Новая партия</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <PlayerMultiSelect value={setupPlayerIds} onChange={setSetupPlayerIds} />
                        <Button
                            className="w-full"
                            disabled={setupPlayerIds.length < 2 || isSubmitting || !(me.isAuthenticated && me.playerId)}
                            onClick={startScoring}
                            title={!(me.isAuthenticated && me.playerId)
                                ? "Для создания стола нужна авторизация и привязка к игроку"
                                : undefined}
                        >
                            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Начать подсчёт"}
                        </Button>
                    </CardContent>
                </Card>
            </main>
        );
    }

    return (
        <main className="p-3 sm:p-4 space-y-4 max-w-sm md:max-w-5xl mx-auto">
            {/* Only the host can save; the auth warning is irrelevant for
                connected players and viewers. */}
            {isHost && <AuthWarning table />}
            {/* Connection status */}
            {currentTable && (
                <TableStatusBanner connected={sseConnected} />
            )}
            <PageHeader title="Этот Безумный Мир" action={
                <div className="flex items-center gap-2">
                    {!isHost && me.canEdit && (
                        <TakeoverButton busy={isTakingOver} onConfirm={handleTakeover} />
                    )}
                    {isHost && (
                        <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
                                <AlertDialogTrigger asChild>
                                    <Button variant="destructive" size="sm">Удалить стол</Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Удалить стол?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Введённые данные будут удалены. Новый стол создаётся на странице «Партии».
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel disabled={isResetting}>Отмена</AlertDialogCancel>
                                    <AlertDialogAction
                                        variant="destructive"
                                        disabled={isResetting}
                                        onClick={(e) => {
                                            e.preventDefault();
                                            closeTable().then(() => setResetDialogOpen(false));
                                        }}
                                    >
                                        {isResetting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Удалить"}
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    )}
                </div>
            } />

            {/* Per-player progress (host sees who has finished editing) */}
            {gameState.entries.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                    {gameState.players.map((p, i) => {
                        const done = gameState.entries[i]?.done;
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
                        <span className="text-muted-foreground">Готовы {doneCount}/{gameState.entries.length}</span>
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
                <div className="space-y-2 pt-2">
                    <TournamentCheckboxes
                        active={activeTournamentsForSave}
                        checked={checkedTournamentIds}
                        isMandatory={isTournamentMandatory}
                        onToggle={toggleTournament}
                    />
                    {saveError && <p className="text-sm text-red-600">{saveError}</p>}
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
                                        {gameState.players.map((p) => (
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
                </div>
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
        </main>
    );
}
