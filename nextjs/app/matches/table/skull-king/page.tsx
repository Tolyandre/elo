"use client";
import type { Base58ID } from "@/lib/id";

import React, { Suspense, useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useWakeLock } from "@/hooks/useWakeLock";
import { usePlayers } from "@/app/players/PlayersContext";
import {
    createTablePromise,
    deleteTablePromise,
    SkullKingGameState as GameState,
    SkullKingRoundEntry as RoundEntry,
    TableGameState,
} from "@/app/api";
import { GAME_ID_SKULL_KING } from "@/lib/game-apps";
import {
    GameTable,
    EditCellDialog,
    BidButtons,
    playerTotal, findNextUnfilled, TOTAL_ROUNDS,
    initialState,
} from "@/components/calculators/skull-king";
import { mergeSkullKingStates } from "@/components/calculators/skull-king/merge";
import { toStorage as skToStorage } from "@/components/calculators/skull-king/storage";
import { useTableSession, waitForSyncedMatch } from "@/hooks/useTableSession";
import { useTableDeepLink } from "@/hooks/useTableDeepLink";
import { useOffline } from "@/app/offline/OfflineContext";
import { useTournamentSelection } from "@/hooks/useTournamentSelection";
import { TournamentCheckboxes } from "@/components/tournament-checkboxes";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/app/pageHeaderContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthWarning } from "@/components/auth-warning";
import { TableStatusBanner } from "@/components/tables/table-status-banner";
import { TakeoverButton } from "@/components/tables/takeover-button";
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

const PAGE_PATH = "/matches/table/skull-king";

function isSkullKingState(state: TableGameState): state is GameState {
    return "rounds" in state;
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function SkullKingGamePage() {
    // useSearchParams (the ?table= deep-link) requires a Suspense
    // boundary under the static export, same as the match/market pages.
    return (
        <Suspense>
            <SkullKingGame />
        </Suspense>
    );
}

function SkullKingGame() {
    const me = useMe();
    const { players: allPlayers, playerDisplayName } = usePlayers();
    const { submitMatch } = useOffline();
    const router = useRouter();

    // Table session (ADR-15/ADR-16), server-only: no local game-state
    // persistence — a reload resumes from the SSE connect snapshot.
    const {
        hydrated,
        session: tableSession,
        gameState,
        setSession: setTableSession,
        resetTableSession,
        joinTable,
        takeoverHosting,
        connectedPlayerIds,
        savedMatchId: sseSavedMatchId,
        closed: sseClosed,
        connected: sseConnected,
        table: currentTable,
        syncHostState,
        submitInput,
        awaitingSnapshot,
    } = useTableSession<GameState>({
        initial: initialState,
        isGameState: isSkullKingState,
        me: { id: me.id, playerId: me.playerId },
        mergeStates: mergeSkullKingStates,
    });

    // Player selection for a new game.
    const [setupPlayerIds, setSetupPlayerIds] = useState<Base58ID[]>([]);

    // Loading state for server interactions
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    const [resetDialogOpen, setResetDialogOpen] = useState(false);
    const [isBidRevealed, setIsBidRevealed] = useState(false);

    // Async phase transition: applies the updater locally and awaits the
    // versioned server sync (with one automatic conflict merge + retry).
    const doPhaseTransition = useCallback(async (updater: (prev: GameState) => GameState) => {
        setIsTransitioning(true);
        try {
            await syncHostState(updater);
        } finally {
            setIsTransitioning(false);
        }
    }, [syncHostState]);

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

    // The host closed the table without saving: connected players go back to
    // the matches page (rejoining happens from there). The hook already
    // toasted and cleared the session.
    useEffect(() => {
        if (!sseClosed || tableSession?.isHost !== false) return;
        router.push("/matches");
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sseClosed]);

    // Auto-advance to round-complete when all results are filled (triggered via SSE in table mode)
    useEffect(() => {
        if (gameState.phase !== "result-entry" || tableSession === null || !tableSession.isHost) return;
        const { rounds, currentRound, players } = gameState;
        const allDone = (rounds[currentRound - 1] ?? [])
            .slice(0, players.length)
            .every(e => e !== null && e.actual !== null);
        if (allDone) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- advance phase once all results arrive via SSE
            doPhaseTransition((prev) => ({ ...prev, phase: "round-complete", currentPlayerIndex: 0 }));
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameState]);

    // Host mutation with an in-flight flag (buttons disable + show a spinner).
    const syncGameState = useCallback(async (updater: (prev: GameState) => GameState) => {
        setIsSyncing(true);
        try {
            await syncHostState(updater);
        } finally {
            setIsSyncing(false);
        }
    }, [syncHostState]);

    // Fire-and-forget host mutation (tab switches and similar UI state).
    const setGameState = useCallback((updater: (prev: GameState) => GameState) => {
        void syncHostState(updater);
    }, [syncHostState]);

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

    // URL bindings (ADR-18): ?new=1 forces a fresh table (the /matches/new
    // links), ?table=<id> is the sticky shareable binding — a stored session
    // on that table resumes as-is, otherwise the table is joined (or watched
    // read-only by a visitor who cannot join). ?join= is a legacy alias.
    useTableDeepLink({
        pagePath: PAGE_PATH,
        gameId: GAME_ID_SKULL_KING,
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

    // Host: confirm + delete the server table, then return to the matches page
    // (rejoining happens from there; new tables are created from /matches/new).
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

    async function startGame() {
        const players = setupPlayerIds
            .map((id) => allPlayers.find((p) => p.id === id))
            .filter(Boolean)
            .map((p) => ({ id: p!.id, name: playerDisplayName(p!) }));
        if (players.length < 2) return;
        if (!(me.isAuthenticated && me.playerId)) return;

        const newState: GameState = {
            phase: "waiting-for-bids",
            players,
            currentRound: 1,
            currentPlayerIndex: 0,
            // Pre-initialize round 1 slot so connected players can submit bids immediately.
            // An empty rounds array causes the backend to reject bids with ErrWrongPhase.
            rounds: [new Array(players.length).fill(null)],
        };

        // Set tableSession optimistically (tableId="" placeholder) so the
        // host UI appears immediately while the API call is in flight.
        setTableSession({ tableId: "" as Base58ID, isHost: true, myPlayerIndex: null });
        setIsSubmitting(true);
        try {
            const table = await createTablePromise(GAME_ID_SKULL_KING, newState);
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

    // ── Connected player submits their own bid via server ──────────────────────
    async function handleConnectedPlayerBid(bid: number) {
        if (!tableSession || tableSession.isHost) return;
        setIsSubmitting(true);
        try {
            await submitInput({ bid });
        } catch (err) {
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
            await submitInput({ actual, bonus });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        } finally {
            setIsSubmitting(false);
        }
    }

    function handleBidSelect(bid: number, playerIndex: number) {
        void syncGameState((prev) => {
            const { currentRound, players, rounds } = prev;
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
                return { ...prev, rounds: newRounds, currentPlayerIndex: 0, phase: "bid-review" as const };
            }
            const next = findNextUnfilled(playerIndex, players.length, (i) => !!newRounds[roundIndex][i]);
            return { ...prev, rounds: newRounds, currentPlayerIndex: next ?? playerIndex };
        });
    }

    async function startResultEntry() {
        await doPhaseTransition((prev) => {
            const firstDisconnected = prev.players.findIndex(
                (p) => !connectedPlayerIds.some(id => id === p.id),
            );
            const startIndex = firstDisconnected >= 0 ? firstDisconnected : 0;
            return { ...prev, phase: "result-entry" as const, currentPlayerIndex: startIndex };
        });
    }

    function handleResultSubmit(actual: number, bonus: number, playerIndex: number) {
        void syncGameState((prev) => {
            const { currentRound, players, rounds } = prev;
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
                return { ...prev, rounds: newRounds, currentPlayerIndex: 0, phase: "round-complete" as const };
            }
            const needsResult = (i: number) => (newRounds[roundIndex][i]?.actual ?? null) === null;
            const isConnected = (i: number) => connectedPlayerIds.some(id => id === players[i].id);
            const findNext = (candidates: number[]) => {
                if (candidates.length === 0) return null;
                return candidates.find(i => i > playerIndex) ?? candidates[0];
            };
            const disconnectedNeeding = players.map((_, i) => i).filter(i => needsResult(i) && !isConnected(i));
            const connectedNeeding = players.map((_, i) => i).filter(i => needsResult(i) && isConnected(i));
            const next = findNext(disconnectedNeeding) ?? findNext(connectedNeeding);
            return { ...prev, rounds: newRounds, currentPlayerIndex: next ?? playerIndex };
        });
    }

    async function startNextRound() {
        await doPhaseTransition((prev) => {
            const nextRound = prev.currentRound + 1;
            const newRounds = [...prev.rounds];
            // Pre-initialize the next round slot for connected-player bid submissions.
            newRounds[nextRound - 1] = new Array(prev.players.length).fill(null);
            return {
                ...prev,
                rounds: newRounds,
                phase: "waiting-for-bids" as const,
                currentRound: nextRound,
                currentPlayerIndex: 0,
            };
        });
    }

    function handleCellEdit(roundIndex: number, playerIndex: number, entry: RoundEntry) {
        setGameState((prev) => {
            const newRounds = prev.rounds.map((r) => [...r]);
            newRounds[roundIndex][playerIndex] = entry;
            return { ...prev, rounds: newRounds };
        });
    }

    async function saveGame() {
        setSaving(true);
        setSaveError("");
        try {
            const score: Record<string, number> = {};
            gameState.players.forEach((p, pi) => {
                score[p.id] = playerTotal(gameState.rounds, pi, gameState.players.length);
            });
            const result = await submitMatch({
                game_id: GAME_ID_SKULL_KING,
                score,
                tournament_ids: tournamentIdsToSubmit(checkedTournamentIds),
                calculator_kind: "skull-king",
                calculator_data: skToStorage(gameState) as unknown as Record<string, never>,
            });
            // The match is queued under its final id; the lists refresh when the
            // sync lands it. Table teardown must wait until the match actually
            // exists on the server: DeleteTable broadcasts its id to the
            // connected players, who open the saved match right away.
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

    // ── Render ───────────────────────────────────────────────────────────────

    const { phase, players, currentRound, currentPlayerIndex, rounds } = gameState;
    // ADR-15: only a stored host session renders as host. A connected player
    // stays connected until they leave the table; losing the session can no
    // longer silently promote them.
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
        <main className="max-w-sm md:max-w-5xl mx-auto space-y-4 overflow-x-hidden">
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
                        {phase !== "setup" && !isHost && me.canEdit && (
                            <TakeoverButton busy={isTakingOver} onConfirm={handleTakeover} />
                        )}
                        {phase !== "setup" && isHost && (
                            <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
                                <AlertDialogTrigger asChild>
                                    <Button variant="destructive" size="sm">Удалить стол</Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Удалить стол?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            Результаты текущей партии будут удалены. Новый стол создаётся на странице «Партии».
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
                }
            />

            {/* Only the host can save; a connected player can't, so the auth
                warning is irrelevant for them. */}
            {isHost && <AuthWarning table />}

            {/* Connection status */}
            {phase !== "setup" && currentTable && (
                <TableStatusBanner connected={sseConnected} />
            )}

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
                            players={allPlayers}
                            playerDisplayName={playerDisplayName}
                            canCreate={!!(me.isAuthenticated && me.playerId)}
                            setupPlayerIds={setupPlayerIds}
                            onSetupPlayerIdsChange={setSetupPlayerIds}
                            isSubmitting={isSubmitting}
                            onStart={startGame}
                        />
                    )}

                    {/* ── BIDDING (host manual entry) ────────────────── */}
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
                                        setGameState((prev) => ({ ...prev, currentPlayerIndex: Number(v) }))
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
                                        onClick={() => doPhaseTransition((prev) => ({ ...prev, phase: "bid-review" as const, currentPlayerIndex: 0 }))}
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
                                        await doPhaseTransition((prev) => ({ ...prev, phase: "bid-review" as const, currentPlayerIndex: 0 }));
                                    } else {
                                        const firstUnfilled = roundData.findIndex(e => e == null);
                                        await doPhaseTransition((prev) => ({
                                            ...prev,
                                            phase: "bidding" as const,
                                            currentPlayerIndex: firstUnfilled >= 0 ? firstUnfilled : 0,
                                        }));
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
                                                    setGameState((prev) => ({ ...prev, currentPlayerIndex: Number(v) }))
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
                                                disabled={saving || !me.id}
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
