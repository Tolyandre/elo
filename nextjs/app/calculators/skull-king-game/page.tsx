"use client";
import type { Base58ID } from "@/lib/id";

import React, { Suspense, useState, useMemo, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toBase58ID } from "@/lib/id";
import { useWakeLock } from "@/hooks/useWakeLock";
import { usePlayers } from "@/app/players/PlayersContext";
import { useGames } from "@/app/gamesContext";
import {
    listSkullKingTablesPromise,
    createSkullKingTablePromise,
    updateSkullKingTableStatePromise,
    submitSkullKingBidPromise,
    submitSkullKingResultPromise,
    deleteSkullKingTablePromise,
    getSkullKingTablePromise,
    SkullKingGameState as GameState,
    SkullKingRoundEntry as RoundEntry,
    SkullKingTableSummary,
} from "@/app/api";
import {
    GameTable,
    EditCellDialog,
    BidButtons,
    playerTotal, findNextUnfilled, TOTAL_ROUNDS,
} from "@/components/calculators/skull-king";
import { toStorage as skToStorage } from "@/components/calculators/skull-king/storage";
import { useSkullKingLobbySSE } from "@/hooks/useSkullKingSSE";
import { useSkullKingTableSession } from "@/hooks/useSkullKingTableSession";
import { useOffline, loadOfflineStore } from "@/app/offline/OfflineContext";
import { useTournamentSelection } from "@/hooks/useTournamentSelection";
import { TournamentCheckboxes } from "@/components/tournament-checkboxes";
import { GameCombobox } from "@/components/game-combobox";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/app/pageHeaderContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthWarning } from "@/components/auth-warning";
import { SetupScreen } from "./setup-screen";
import { ResultEntryCard } from "./result-entry-card";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, Lightbulb, LightbulbOff, Loader2 } from "lucide-react";
import { useMe } from "@/app/meContext";
import { toast } from "sonner";

const CALCULATOR_KIND = "skull-king";

// ─── Main component ──────────────────────────────────────────────────────────

export default function SkullKingGamePage() {
    // useSearchParams (the ?join= invite deep-link) requires a Suspense
    // boundary under the static export, same as the match/market pages.
    return (
        <Suspense>
            <SkullKingGame />
        </Suspense>
    );
}

// Waits until the sync engine has flushed the just-queued match to the server:
// the engine removes the item from the persisted store on success (an item the
// server rejected stays, with an error badge). Table teardown broadcasts the
// match id to the connected players, so it must not fire before the match
// exists. Returns false on timeout (e.g. the network died right after saving).
async function waitForSyncedMatch(matchId: string, timeoutMs = 10_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    // Let the queue write and the ping+sync get going first — React persists
    // the store shortly after submitMatch returns, and a sync flush takes at
    // least a round trip while online.
    await new Promise((r) => setTimeout(r, 400));
    while (Date.now() < deadline) {
        if (!loadOfflineStore().matches.some((m) => m.clientId === matchId)) return true;
        await new Promise((r) => setTimeout(r, 400));
    }
    return false;
}

function SkullKingGame() {
    const me = useMe();
    const { players: allPlayers, playerDisplayName } = usePlayers();
    const { games } = useGames();
    const { submitMatch } = useOffline();
    const router = useRouter();

    // Table session + game state with the strict host/connected-player policy
    // (ADR-15): connected players never persist local state and can never
    // render as host; the SSE wiring (snapshots, saved/closed, table-gone
    // recovery) lives inside the hook.
    const {
        hydrated,
        session: tableSession,
        gameState,
        setGameState: setGameStateRaw,
        setSession: setTableSession,
        resetGame: resetTableSession,
        joinTable,
        connectedPlayerIds,
        savedMatchId: sseSavedMatchId,
        refreshFromServer,
        awaitingSnapshot,
    } = useSkullKingTableSession();

    // Player selection for a new local game; initialized once from the
    // restored (host/local) state after hydration.
    const [setupPlayerIds, setSetupPlayerIds] = useState<Base58ID[]>([]);
    useEffect(() => {
        if (!hydrated) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time init from the hydrated game state
        setSetupPlayerIds(gameState.players.map((p) => p.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hydrated]);

    // Active tables list (fetched in setup phase)
    const [activeTables, setActiveTables] = useState<SkullKingTableSummary[]>([]);
    const [tablesLoading, setTablesLoading] = useState(false);
    const [joiningTableId, setJoiningTableId] = useState<Base58ID | null>(null);

    // Loading state for server interactions
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    const [resetDialogOpen, setResetDialogOpen] = useState(false);
    const [isBidRevealed, setIsBidRevealed] = useState(false);

    // Async phase transition: updates local state and awaits server sync
    const doPhaseTransition = useCallback(async (newState: GameState) => {
        setIsTransitioning(true);
        try {
            setGameStateRaw(newState);
            if (tableSession?.isHost && tableSession.tableId) {
                await updateSkullKingTableStatePromise(tableSession.tableId, newState);
            }
        } catch (err) {
            toast.error("Ошибка синхронизации: " + (err instanceof Error ? err.message : String(err)));
        } finally {
            setIsTransitioning(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tableSession]);

    // Connected player: when the host saves the match, the server broadcasts a
    // "saved" event carrying the new match id. Redirect to that match's view
    // page and tear down the local session. Host handles its own redirect in
    // saveGame(), so this effect is a no-op for the host.
    useEffect(() => {
        if (!sseSavedMatchId || tableSession?.isHost !== false) return;
        resetTableSession();
        router.push(`/matches/view?id=${sseSavedMatchId}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sseSavedMatchId]);

    // Auto-advance to round-complete when all results are filled (triggered via SSE in table mode)
    useEffect(() => {
        if (gameState.phase !== "result-entry" || tableSession === null || !tableSession.isHost) return;
        const { rounds, currentRound, players } = gameState;
        const allDone = (rounds[currentRound - 1] ?? [])
            .slice(0, players.length)
            .every(e => e !== null && e.actual !== null);
        if (allDone) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- advance phase once all results arrive via SSE
            doPhaseTransition({ ...gameState, phase: "round-complete", currentPlayerIndex: 0 });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameState]);

    // Wrap setGameState so host auto-syncs to server
    // Skip when tableId is "" (placeholder set before API call resolves)
    const setGameState = useCallback((newState: GameState) => {
        setGameStateRaw(newState);
        if (tableSession?.isHost && tableSession.tableId) {
            updateSkullKingTableStatePromise(tableSession.tableId, newState).catch((err) => {
                toast.error("Ошибка синхронизации: " + (err instanceof Error ? err.message : String(err)));
            });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tableSession]);

    // Like setGameState, but awaits the server sync and exposes an in-flight flag
    // (isSyncing) so host entry buttons can disable + show a spinner while sending.
    // In local-only mode (no table) it applies state instantly and never blocks.
    const syncGameState = useCallback(async (newState: GameState) => {
        if (!(tableSession?.isHost && tableSession.tableId)) {
            setGameStateRaw(newState);
            return;
        }
        setIsSyncing(true);
        try {
            setGameStateRaw(newState);
            await updateSkullKingTableStatePromise(tableSession.tableId, newState);
        } catch (err) {
            toast.error("Ошибка синхронизации: " + (err instanceof Error ? err.message : String(err)));
        } finally {
            setIsSyncing(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tableSession]);

    // Edit cell dialog state
    const [editCell, setEditCell] = useState<{ roundIndex: number; playerIndex: number } | null>(null);

    // Save state
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState("");

    // Tournament selection for the saved match. Mandatory tournaments (all players
    // are members) are applied server-side; checked carries the host's explicit picks.
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

    // Reset bid reveal when round changes
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the per-round reveal toggle on round change
        setIsBidRevealed(false);
    }, [gameState.currentRound]);

    // Wake lock
    const { supported: wakeLockSupported, enabled: wakeLockEnabled, toggle: toggleWakeLock } = useWakeLock();

    const skullKingGame = useMemo(
        () => games.find((g) => g.name.toLowerCase().includes("skull king")),
        [games]
    );

    // Subscribe to lobby SSE while on the setup screen so the active-tables list
    // auto-refreshes when tables are created/deleted on the server.
    const lobbyEnabled = hydrated && gameState.phase === "setup" && tableSession === null;
    const lobbyTick = useSkullKingLobbySSE(lobbyEnabled);

    // Load active tables when in setup phase (re-runs on each lobby signal)
    useEffect(() => {
        if (!hydrated || gameState.phase !== "setup" || tableSession !== null) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- loading indicator before async fetch
        setTablesLoading(true);
        listSkullKingTablesPromise()
            .then(setActiveTables)
            .catch(() => {}) // ignore errors silently
            .finally(() => setTablesLoading(false));
    }, [hydrated, gameState.phase, tableSession, lobbyTick]);

    async function handleJoinTable(table: SkullKingTableSummary) {
        if (!me.isAuthenticated || !me.playerId) return;
        setJoiningTableId(table.id);
        try {
            await joinTable(table, me.playerId);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        } finally {
            setJoiningTableId(null);
        }
    }

    // Invite deep-link: the table-invite toast on any page navigates here with
    // ?join=<tableId>. Fetch the table and auto-join once (session must be free
    // and the user must control a player); the param is then cleared so a
    // refresh does not retry the join.
    const searchParams = useSearchParams();
    const joinParam = toBase58ID(searchParams.get("join") ?? "");
    useEffect(() => {
        if (!joinParam || !hydrated || tableSession !== null) return;
        if (!me.isAuthenticated || !me.playerId) return;
        let cancelled = false;
        (async () => {
            try {
                const table = await getSkullKingTablePromise(joinParam);
                if (!cancelled) await handleJoinTable(table);
            } catch {
                if (!cancelled) toast.error("Стол не найден или уже завершён");
            } finally {
                router.replace("/calculators/skull-king-game", { scroll: false });
            }
        })();
        return () => {
            cancelled = true;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [joinParam, hydrated, tableSession === null, me.isAuthenticated, me.playerId]);

    // Host: confirm + delete the server table. Connected player: leave the
    // table immediately — their state lives on the server and cannot be lost,
    // so no confirmation is needed.
    async function resetGame() {
        // Only delete server table if we have a real (non-placeholder) tableId
        if (tableSession?.isHost && tableSession.tableId) {
            setIsResetting(true);
            try { await deleteSkullKingTablePromise(tableSession.tableId); }
            catch { /* ignore */ }
            finally { setIsResetting(false); }
        }
        resetTableSession();
        setSetupPlayerIds([]);
        setSaveError("");
    }

    async function startGame() {
        const players = setupPlayerIds
            .map((id) => allPlayers.find((p) => p.id === id))
            .filter(Boolean)
            .map((p) => ({ id: p!.id, name: playerDisplayName(p!) }));
        if (players.length < 2) return;

        const isTableMode = !!(me.isAuthenticated && me.playerId);
        const newState: GameState = {
            phase: isTableMode ? "waiting-for-bids" : "bidding",
            players,
            currentRound: 1,
            currentPlayerIndex: 0,
            // Pre-initialize round 1 slot so connected players can submit bids immediately.
            // An empty rounds array causes the backend to reject bids with ErrWrongPhase.
            rounds: isTableMode ? [new Array(players.length).fill(null)] : [],
        };

        setGameStateRaw(newState);

        // Create server table if authenticated with player_id.
        // Set tableSession optimistically (tableId="" placeholder) so the
        // "Ждать ставки от игроков" button appears immediately while the API call is in flight.
        if (me.isAuthenticated && me.playerId) {
            setTableSession({ tableId: "" as Base58ID, isHost: true, myPlayerIndex: null });
            setIsSubmitting(true);
            try {
                const table = await createSkullKingTablePromise(newState);
                setTableSession({ tableId: table.id, isHost: true, myPlayerIndex: null });
            } catch (err) {
                toast.error("Не удалось создать стол: " + (err instanceof Error ? err.message : String(err)));
                setTableSession(null); // revert to local-only
            } finally {
                setIsSubmitting(false);
            }
        }
    }

    // ── Connected player submits their own bid via server ──────────────────────
    async function handleConnectedPlayerBid(bid: number) {
        if (!tableSession || tableSession.isHost) return;
        setIsSubmitting(true);
        try {
            const updated = await submitSkullKingBidPromise(tableSession.tableId, bid);
            setGameStateRaw(updated.game_state);
        } catch (err) {
            // On phase mismatch (409) or any error, refresh state from server
            // so the UI reflects the actual current game phase
            await refreshFromServer();
            toast.error(err instanceof Error ? err.message : String(err));
        } finally {
            setIsSubmitting(false);
        }
    }

    // ── Connected player submits their own result via server ──────────────────
    async function handleConnectedPlayerResult(actual: number, bonus: number) {
        if (!tableSession || tableSession.isHost) return;
        setIsSubmitting(true);
        try {
            const updated = await submitSkullKingResultPromise(tableSession.tableId, actual, bonus);
            setGameStateRaw(updated.game_state);
        } catch (err) {
            // On phase mismatch (409) or any error, refresh state from server
            // so the UI reflects the actual current game phase
            await refreshFromServer();
            toast.error(err instanceof Error ? err.message : String(err));
        } finally {
            setIsSubmitting(false);
        }
    }

    function handleBidSelect(bid: number, playerIndex: number) {
        const { currentRound, players, rounds } = gameState;
        const roundIndex = currentRound - 1;

        const newRounds = [...rounds];
        if (!newRounds[roundIndex]) {
            newRounds[roundIndex] = new Array(players.length).fill(null);
        } else {
            newRounds[roundIndex] = [...newRounds[roundIndex]];
        }
        newRounds[roundIndex][playerIndex] = { bid, actual: null, bonus: 0 };

        const allBid =
            newRounds[roundIndex].length >= players.length &&
            newRounds[roundIndex].slice(0, players.length).every((e) => e !== null);

        if (allBid) {
            syncGameState({ ...gameState, rounds: newRounds, currentPlayerIndex: 0, phase: "bid-review" });
        } else {
            const next = findNextUnfilled(playerIndex, players.length, (i) => !!newRounds[roundIndex][i]);
            syncGameState({ ...gameState, rounds: newRounds, currentPlayerIndex: next ?? playerIndex });
        }
    }

    async function startResultEntry() {
        const firstDisconnected = gameState.players.findIndex(
            (p) => !connectedPlayerIds.some(id => id === p.id)
        );
        const startIndex = firstDisconnected >= 0 ? firstDisconnected : 0;
        await doPhaseTransition({ ...gameState, phase: "result-entry", currentPlayerIndex: startIndex });
    }

    function handleResultSubmit(actual: number, bonus: number, playerIndex: number) {
        const { currentRound, players, rounds } = gameState;
        const roundIndex = currentRound - 1;
        const newRounds = rounds.map((r) => [...r]);
        // Guard: ensure the round slot exists (can be missing if bids weren't recorded locally)
        if (!newRounds[roundIndex]) {
            newRounds[roundIndex] = new Array(players.length).fill(null);
        }
        newRounds[roundIndex][playerIndex] = {
            bid: newRounds[roundIndex][playerIndex]?.bid ?? 0,
            actual,
            bonus,
        };

        const allDone = newRounds[roundIndex]
            .slice(0, players.length)
            .every(e => e !== null && e.actual !== null);

        if (allDone) {
            syncGameState({ ...gameState, rounds: newRounds, currentPlayerIndex: 0, phase: "round-complete" });
        } else {
            const needsResult = (i: number) => (newRounds[roundIndex][i]?.actual ?? null) === null;
            const isConnected = (i: number) => connectedPlayerIds.some(id => id === players[i].id);
            const findNext = (candidates: number[]) => {
                if (candidates.length === 0) return null;
                return candidates.find(i => i > playerIndex) ?? candidates[0];
            };
            const disconnectedNeeding = players.map((_, i) => i).filter(i => needsResult(i) && !isConnected(i));
            const connectedNeeding = players.map((_, i) => i).filter(i => needsResult(i) && isConnected(i));
            const next = findNext(disconnectedNeeding) ?? findNext(connectedNeeding);
            syncGameState({ ...gameState, rounds: newRounds, currentPlayerIndex: next ?? playerIndex });
        }
    }

    async function startNextRound() {
        const nextRound = gameState.currentRound + 1;
        const newRounds = [...gameState.rounds];
        // Pre-initialize the next round slot for connected-player bid submissions.
        if (tableSession !== null) {
            newRounds[nextRound - 1] = new Array(gameState.players.length).fill(null);
        }
        await doPhaseTransition({
            ...gameState,
            rounds: newRounds,
            phase: tableSession !== null ? "waiting-for-bids" : "bidding",
            currentRound: nextRound,
            currentPlayerIndex: 0,
        });
    }

    function handleCellEdit(roundIndex: number, playerIndex: number, entry: RoundEntry) {
        const newRounds = gameState.rounds.map((r) => [...r]);
        newRounds[roundIndex][playerIndex] = entry;
        setGameState({ ...gameState, rounds: newRounds });
    }

    async function saveGame() {
        const gameId = skullKingGame?.id ?? gameState.fallbackGameId;
        if (!gameId) return;
        setSaving(true);
        setSaveError("");
        try {
            const score: Record<string, number> = {};
            gameState.players.forEach((p, pi) => {
                score[p.id] = playerTotal(gameState.rounds, pi, gameState.players.length);
            });
            const result = await submitMatch({
                game_id: gameId,
                score,
                tournament_ids: tournamentIdsToSubmit(checkedTournamentIds),
                calculator_kind: CALCULATOR_KIND,
                calculator_data: skToStorage(gameState) as unknown as Record<string, never>,
            });
            // The match is queued under its final id; the lists refresh when the
            // sync lands it. In table mode, teardown must wait until the match
            // actually exists on the server: DeleteTable broadcasts its id to the
            // connected players, who open the saved match right away.
            if (tableSession?.tableId && (await waitForSyncedMatch(result.id))) {
                try { await deleteSkullKingTablePromise(tableSession.tableId, result.id); } catch { /* ignore */ }
            }
            resetTableSession();
            router.push(`/matches/view?id=${result.id}`);
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    }

    // ── Render ───────────────────────────────────────────────────────────────

    const { phase, players, currentRound, currentPlayerIndex, rounds } = gameState;
    // ADR-15: only a stored host session (or no session at all — a local game)
    // renders as host. A connected player stays connected until they leave the
    // table; losing the session can no longer silently promote them.
    const isHost = !tableSession || tableSession.isHost;
    const myPlayerIndex = tableSession?.myPlayerIndex ?? null;

    // For connected players, check if their slot is already filled by host
    const mySlotBidSet = myPlayerIndex !== null
        ? !!(rounds[currentRound - 1]?.[myPlayerIndex]?.bid !== undefined && rounds[currentRound - 1]?.[myPlayerIndex] !== null)
        : false;
    const mySlotResultSet = myPlayerIndex !== null
        ? (rounds[currentRound - 1]?.[myPlayerIndex]?.actual ?? null) !== null
        : false;

    // Until localStorage hydration completes — or, for connected players, until
    // the first server snapshot arrives — the mode is unknown; show a
    // placeholder instead of flashing the wrong UI.
    const connecting = !hydrated || awaitingSnapshot;

    return (
        <main className="max-w-5xl mx-auto space-y-4 overflow-x-hidden">
            <PageHeader
                title="Skull King"
                action={
                    <div className="flex items-center gap-2">
                        {wakeLockSupported && (
                            <Button
                                variant={wakeLockEnabled ? "secondary" : "ghost"}
                                size="sm"
                                onClick={toggleWakeLock}
                                title={wakeLockEnabled ? "Экран не выключается" : "Экран может потухнуть"}
                            >
                                {wakeLockEnabled
                                    ? <Lightbulb className="h-4 w-4" />
                                    : <LightbulbOff className="h-4 w-4" />}
                            </Button>
                        )}
                        {phase !== "setup" && (
                            isHost ? (
                                <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="outline" size="sm">Новая партия</Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Начать новую партию?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Результаты текущей партии будут удалены.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel disabled={isResetting}>Отмена</AlertDialogCancel>
                                            <AlertDialogAction
                                                disabled={isResetting}
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    resetGame().then(() => setResetDialogOpen(false));
                                                }}
                                            >
                                                {isResetting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Начать"}
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            ) : (
                                <Button variant="outline" size="sm" onClick={resetTableSession}>Новая партия</Button>
                            )
                        )}
                    </div>
                }
            />

            {/* Only the host can save; a connected player can't, so the auth
                warning is irrelevant for them. */}
            {isHost && <AuthWarning />}

            {connecting ? (
                <Card>
                    <CardContent className="py-8 flex items-center justify-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm">Подключение к столу...</span>
                    </CardContent>
                </Card>
            ) : (
                <>
                    {/* ── SETUP ──────────────────────────────────────── */}
                    {phase === "setup" && (
                        <SetupScreen
                            me={me}
                            players={allPlayers}
                            playerDisplayName={playerDisplayName}
                            activeTables={activeTables}
                            tablesLoading={tablesLoading}
                            joiningTableId={joiningTableId}
                            onJoin={handleJoinTable}
                            setupPlayerIds={setupPlayerIds}
                            onSetupPlayerIdsChange={setSetupPlayerIds}
                            isSubmitting={isSubmitting}
                            onStart={startGame}
                        />
                    )}

                    {/* ── BIDDING ────────────────────────────────────── */}
                    {phase === "bidding" && !isHost && (
                        <div className="space-y-4">
                            <p className="text-sm text-muted-foreground text-center">Ожидание ведущего...</p>
                            <Card>
                                <CardHeader>
                                    <CardTitle>Таблица результатов</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <GameTable state={gameState} planRoundIndex={currentRound - 1} />
                                </CardContent>
                            </Card>
                        </div>
                    )}
                    {phase === "bidding" && isHost && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Раунд {currentRound} — план взяток</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <Tabs
                                    value={String(currentPlayerIndex)}
                                    onValueChange={(v) =>
                                        setGameState({ ...gameState, currentPlayerIndex: Number(v) })
                                    }
                                >
                                    <TabsList className="flex flex-wrap h-auto gap-1">
                                        {players.map((p, pi) => {
                                            const hasBid = !!rounds[currentRound - 1]?.[pi];
                                            return (
                                                <TabsTrigger key={pi} value={String(pi)} className="gap-1">
                                                    {p.name}
                                                    {hasBid && <Check className="h-3 w-3" />}
                                                </TabsTrigger>
                                            );
                                        })}
                                    </TabsList>
                                    {players.map((_, pi) => (
                                        <TabsContent key={pi} value={String(pi)} className="mt-4 space-y-2">
                                            <p className="text-sm md:text-base">Сколько взяток планируете взять?</p>
                                            <BidButtons
                                                roundNumber={currentRound}
                                                selected={rounds[currentRound - 1]?.[pi]?.bid ?? null}
                                                onSelect={(bid) => handleBidSelect(bid, pi)}
                                                disabled={isSyncing}
                                            />
                                            {isSyncing && (
                                                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                                                    <Loader2 className="h-4 w-4 animate-spin" /> Сохранение...
                                                </p>
                                            )}
                                        </TabsContent>
                                    ))}
                                </Tabs>
                                {rounds[currentRound - 1]?.slice(0, players.length).every((e) => e !== null) && (
                                    <Button
                                        className="w-full md:h-12 md:text-base"
                                        disabled={isTransitioning}
                                        onClick={() => doPhaseTransition({ ...gameState, phase: "bid-review", currentPlayerIndex: 0 })}
                                    >
                                        {isTransitioning ? <Loader2 className="h-5 w-5 animate-spin" /> : "Перейти к обзору"}
                                    </Button>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* ── WAITING FOR BIDS ───────────────────────────── */}
                    {phase === "waiting-for-bids" && (
                        <div className="space-y-4">
                            {/* Connected player: show only own bid UI */}
                            {!isHost && myPlayerIndex !== null && (
                                <Card>
                                    <CardHeader>
                                        <CardTitle>Раунд {currentRound} — ваш план</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        {mySlotBidSet ? (
                                            <div className="space-y-2">
                                                <p className="text-green-700 font-medium flex items-center gap-2">
                                                    <Check className="h-4 w-4" />
                                                    Ставка принята:{" "}
                                                    <span
                                                        className={`transition-all cursor-pointer select-none font-bold text-3xl px-3 py-1 rounded-md ${isBidRevealed ? "text-foreground" : "blur text-foreground bg-foreground/20"}`}
                                                        onClick={() => setIsBidRevealed(v => !v)}
                                                    >
                                                        {rounds[currentRound - 1]?.[myPlayerIndex]?.bid}
                                                    </span>
                                                </p>
                                                <p className="text-sm text-muted-foreground">Ожидайте остальных игроков...</p>
                                            </div>
                                        ) : (
                                            <>
                                                <p className="text-sm md:text-base">Сколько взяток планируете взять?</p>
                                                <BidButtons
                                                    roundNumber={currentRound}
                                                    selected={rounds[currentRound - 1]?.[myPlayerIndex]?.bid ?? null}
                                                    onSelect={isSubmitting ? () => {} : handleConnectedPlayerBid}
                                                />
                                                {isSubmitting && <p className="text-sm text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Отправка...</p>}
                                            </>
                                        )}
                                    </CardContent>
                                </Card>
                            )}

                            {/* Connected player: read-only table (bids hidden until bid-review) */}
                            {!isHost && (
                                <Card>
                                    <CardHeader>
                                        <CardTitle>Таблица результатов</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <GameTable state={gameState} maskedRoundIndex={currentRound - 1} planRoundIndex={currentRound - 1} />
                                    </CardContent>
                                </Card>
                            )}

                            {/* Host: show table + progress + interrupt button */}
                            {isHost && (
                                <Card>
                                    <CardHeader>
                                        <CardTitle>Раунд {currentRound} — ожидание ставок</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <GameTable
                                            state={gameState}
                                            maskedRoundIndex={currentRound - 1}
                                            planRoundIndex={currentRound - 1}
                                            onCellClick={(ri, pi) => setEditCell({ roundIndex: ri, playerIndex: pi })}
                                        />
                                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm mt-1">
                                            {players.map((p, pi) => {
                                                if (!connectedPlayerIds.some(id => id === p.id)) return null;
                                                const hasBid = !!rounds[currentRound - 1]?.[pi];
                                                return (
                                                    <div key={pi} className="flex items-center gap-1">
                                                        {hasBid
                                                            ? <Check className="h-3 w-3 text-green-600" />
                                                            : <span className="h-3 w-3 rounded-full border border-muted-foreground inline-block shrink-0" />
                                                        }
                                                        <span className={hasBid ? "text-foreground" : "text-muted-foreground"}>{p.name}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </CardContent>
                                </Card>
                            )}
                            {isHost && (() => {
                                const roundData = rounds[currentRound - 1] ?? [];
                                const allBid = players.length > 0 &&
                                    roundData.slice(0, players.length).every(e => e != null);
                                const connectedNotBid = players.filter((p, pi) =>
                                    connectedPlayerIds.some(id => id === p.id) && !roundData[pi]
                                );
                                async function performForceTransition() {
                                    if (allBid) {
                                        await doPhaseTransition({ ...gameState, phase: "bid-review", currentPlayerIndex: 0 });
                                    } else {
                                        const firstUnfilled = roundData.findIndex(e => e == null);
                                        await doPhaseTransition({ ...gameState, phase: "bidding", currentPlayerIndex: firstUnfilled >= 0 ? firstUnfilled : 0 });
                                    }
                                }
                                if (connectedNotBid.length > 0) {
                                    return (
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button className="w-full md:h-12 md:text-base" disabled={isTransitioning}>
                                                    {isTransitioning ? <Loader2 className="h-5 w-5 animate-spin" /> : "Ввести ставки"}
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Перейти к ручному вводу?</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        Не все подключённые игроки ввели план: {connectedNotBid.map(p => p.name).join(", ")}
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Отмена</AlertDialogCancel>
                                                    <AlertDialogAction onClick={performForceTransition}>Продолжить</AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    );
                                }
                                return (
                                    <Button
                                        className="w-full md:h-12 md:text-base"
                                        disabled={isTransitioning}
                                        onClick={performForceTransition}
                                    >
                                        {isTransitioning ? <Loader2 className="h-5 w-5 animate-spin" /> : "Ввести ставки"}
                                    </Button>
                                );
                            })()}
                        </div>
                    )}

                    {/* ── BID REVIEW ─────────────────────────────── */}
                            {phase === "bid-review" && (
                                <div className="space-y-4">
                                    {!isHost && (
                                        <p className="text-sm text-muted-foreground text-center">Ожидание ведущего...</p>
                                    )}
                                    <Card>
                                        <CardHeader>
                                            <CardTitle>Раунд {currentRound} — планы введены</CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <GameTable
                                                state={gameState}
                                                onCellClick={isHost ? (ri, pi) => setEditCell({ roundIndex: ri, playerIndex: pi }) : undefined}
                                                planRoundIndex={currentRound - 1}
                                            />
                                            <div className="text-sm text-muted-foreground mt-3 space-y-1">
                                                <p>
                                                    План:{" "}
                                                    <span className="text-foreground text-base md:text-lg font-bold tabular-nums">
                                                        {(rounds[currentRound - 1] ?? []).reduce((s, e) => s + (e?.bid ?? 0), 0)}
                                                    </span>
                                                    {" "}взяток, раздано карт:{" "}
                                                    <span className="text-foreground text-base md:text-lg font-bold tabular-nums">
                                                        {(players.length >= 8 && currentRound >= 9) ? 8 : currentRound}
                                                    </span>
                                                </p>
                                            </div>
                                        </CardContent>
                                    </Card>
                                    {isHost && (
                                        <Button
                                            className="w-full md:h-12 md:text-base lg:h-14 lg:text-lg"
                                            disabled={isTransitioning}
                                            onClick={startResultEntry}
                                        >
                                            {isTransitioning ? <Loader2 className="h-5 w-5 animate-spin" /> : "Ввести результаты"}
                                        </Button>
                                    )}
                                </div>
                            )}

                            {/* ── RESULT ENTRY ───────────────────────────── */}
                            {phase === "result-entry" && (
                                <div className="space-y-4">
                                <Card>
                                    <CardHeader>
                                        <CardTitle>Раунд {currentRound} — результаты</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        {/* Connected player: only own tab */}
                                        {!isHost && myPlayerIndex !== null && (
                                            <>
                                                {mySlotResultSet ? (
                                                    <div className="space-y-2">
                                                        <p className="text-green-700 font-medium flex items-center gap-2">
                                                            <Check className="h-4 w-4" />
                                                            Результат принят: {rounds[currentRound - 1]?.[myPlayerIndex]?.actual}
                                                        </p>
                                                        <p className="text-sm text-muted-foreground">Ожидайте остальных игроков...</p>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <ResultEntryCard
                                                            player={players[myPlayerIndex]}
                                                            roundNumber={currentRound}
                                                            bid={rounds[currentRound - 1]?.[myPlayerIndex]?.bid ?? 0}
                                                            initialActual={rounds[currentRound - 1]?.[myPlayerIndex]?.actual ?? null}
                                                            initialBonus={rounds[currentRound - 1]?.[myPlayerIndex]?.bonus ?? 0}
                                                            onSubmit={isSubmitting ? () => {} : (actual, bonus) => handleConnectedPlayerResult(actual, bonus)}
                                                        />
                                                        {isSubmitting && <p className="text-sm text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Отправка...</p>}
                                                    </>
                                                )}
                                            </>
                                        )}

                                        {/* Host: full tab UI */}
                                        {isHost && (
                                            <>
                                            <Tabs
                                                value={String(currentPlayerIndex)}
                                                onValueChange={(v) =>
                                                    setGameState({ ...gameState, currentPlayerIndex: Number(v) })
                                                }
                                            >
                                                <TabsList className="flex flex-wrap h-auto gap-1">
                                                    {players.map((p, pi) => {
                                                        const hasResult = (rounds[currentRound - 1]?.[pi]?.actual ?? null) !== null;
                                                        return (
                                                            <TabsTrigger key={pi} value={String(pi)} className="gap-1">
                                                                {p.name}
                                                                {hasResult && <Check className="h-3 w-3" />}
                                                            </TabsTrigger>
                                                        );
                                                    })}
                                                </TabsList>
                                                {players.map((p, pi) => {
                                                    const entry = rounds[currentRound - 1]?.[pi];
                                                    return (
                                                        <TabsContent key={pi} value={String(pi)} className="mt-4">
                                                            <ResultEntryCard
                                                                player={p}
                                                                roundNumber={currentRound}
                                                                bid={entry?.bid ?? 0}
                                                                initialActual={entry?.actual ?? null}
                                                                initialBonus={entry?.bonus ?? 0}
                                                                onSubmit={(actual, bonus) => handleResultSubmit(actual, bonus, pi)}
                                                                disabled={isSyncing}
                                                            />
                                                        </TabsContent>
                                                    );
                                                })}
                                            </Tabs>
                                            <div className="mt-4">
                                                <GameTable
                                                    state={gameState}
                                                    onCellClick={(ri, pi) => setEditCell({ roundIndex: ri, playerIndex: pi })}
                                                    planRoundIndex={currentRound - 1}
                                                />
                                            </div>
                                            </>
                                        )}
                                    </CardContent>
                                </Card>
                                {/* Connected player: read-only table */}
                                {!isHost && (
                                    <Card>
                                        <CardHeader>
                                            <CardTitle>Таблица результатов</CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <GameTable
                                                state={gameState}
                                                hideTotalPlayerIndices={
                                                    players.map((_, pi) => pi).filter(pi =>
                                                        (rounds[currentRound - 1]?.[pi]?.actual ?? null) === null
                                                    )
                                                }
                                            />
                                        </CardContent>
                                    </Card>
                                )}
                                </div>
                            )}

                            {/* ── ROUND COMPLETE ─────────────────────────── */}
                            {phase === "round-complete" && (
                                <div className="space-y-4">
                                    {!isHost && currentRound < TOTAL_ROUNDS && (
                                        <p className="text-sm text-muted-foreground text-center">Ожидание ведущего...</p>
                                    )}
                                    {currentRound === TOTAL_ROUNDS && !isHost && (
                                        <p className="text-sm text-muted-foreground text-center">Ожидание сохранения ведущим...</p>
                                    )}
                                    <Card>
                                        <CardHeader>
                                            <CardTitle>
                                                {currentRound === TOTAL_ROUNDS
                                                    ? "Партия завершена!"
                                                    : `Раунд ${currentRound} завершён`}
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <GameTable
                                                state={gameState}
                                                onCellClick={isHost ? (ri, pi) => setEditCell({ roundIndex: ri, playerIndex: pi }) : undefined}
                                            />
                                            {isHost && (
                                                <p className="text-xs text-muted-foreground mt-2">
                                                    Нажмите на ячейку для редактирования
                                                </p>
                                            )}
                                        </CardContent>
                                    </Card>

                                    {isHost && currentRound < TOTAL_ROUNDS && (
                                        <Button
                                            className="w-full md:h-12 md:text-base lg:h-14 lg:text-lg"
                                            disabled={isTransitioning}
                                            onClick={startNextRound}
                                        >
                                            {isTransitioning
                                                ? <Loader2 className="h-5 w-5 animate-spin" />
                                                : `Следующий раунд (${currentRound + 1} / ${TOTAL_ROUNDS})`
                                            }
                                        </Button>
                                    )}

                                    {currentRound === TOTAL_ROUNDS && isHost && (
                                        <div className="space-y-2">
                                            {!skullKingGame && (
                                                <div className="space-y-1">
                                                    <p className="text-sm text-muted-foreground">
                                                        Не найдена игра «Skull King». Выберите вручную:
                                                    </p>
                                                    <GameCombobox
                                                        value={gameState.fallbackGameId ?? undefined}
                                                        onChange={(id) =>
                                                            setGameState({ ...gameState, fallbackGameId: id })
                                                        }
                                                    />
                                                </div>
                                            )}
                                            <TournamentCheckboxes
                                                active={activeTournamentsForSave}
                                                checked={checkedTournamentIds}
                                                isMandatory={isTournamentMandatory}
                                                onToggle={toggleTournament}
                                            />
                                            {saveError && (
                                                <p className="text-red-600 text-sm">{saveError}</p>
                                            )}
                                            <Button
                                                className="w-full md:h-12 md:text-base lg:h-14 lg:text-lg"
                                                disabled={
                                                    saving ||
                                                    (!skullKingGame && !gameState.fallbackGameId) ||
                                                    !me.id
                                                }
                                                onClick={saveGame}
                                            >
                                                {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-2 inline" />Сохранение...</> : "Сохранить партию"}
                                            </Button>
                                        </div>
                                    )}

                                </div>
                            )}
                </>
            )}

            {/* Edit cell dialog (host only) */}
            {isHost && editCell && (
                <EditCellDialog
                    open={!!editCell}
                    onClose={() => setEditCell(null)}
                    roundIndex={editCell.roundIndex}
                    playerIndex={editCell.playerIndex}
                    state={gameState}
                    onSave={handleCellEdit}
                />
            )}
        </main>
    );
}
