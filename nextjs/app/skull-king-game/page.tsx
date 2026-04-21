"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { usePlayers } from "@/app/players/PlayersContext";
import { useGames } from "@/app/gamesContext";
import { useMatches } from "@/app/matches/MatchesContext";
import {
    addMatchPromise,
    listSkullKingTablesPromise,
    createSkullKingTablePromise,
    updateSkullKingTableStatePromise,
    joinSkullKingTablePromise,
    submitSkullKingBidPromise,
    submitSkullKingResultPromise,
    deleteSkullKingTablePromise,
    getSkullKingTablePromise,
    SkullKingGameState as GameState,
    SkullKingRoundEntry as RoundEntry,
    SkullKingTableSummary,
} from "@/app/api";
import { useSkullKingSSE } from "@/hooks/useSkullKingSSE";
import { PlayerMultiSelect } from "@/components/player-multi-select";
import { GameCombobox } from "@/components/game-combobox";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/app/pageHeaderContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { AuthWarning } from "@/components/auth-warning";
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
import { Check, ChevronDown, ChevronUp, GripVertical, Users } from "lucide-react";
import { useMe } from "@/app/meContext";
import { toast } from "sonner";

// ─── Table session ────────────────────────────────────────────────────────────

type TableSession = {
    tableId: string;
    isHost: boolean;
    myPlayerIndex: number | null; // null = observer / host (controls all)
};

const TABLE_SESSION_KEY = "skull-king-game/table-session";

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL_ROUNDS = 10;
const LS_KEY = "skull-king-game/state";

const initialState: GameState = {
    phase: "setup",
    players: [],
    currentRound: 1,
    currentPlayerIndex: 0,
    rounds: [],
};

// ─── Scoring ─────────────────────────────────────────────────────────────────

function calcRoundScore(entry: RoundEntry, roundNumber: number, playerCount: number): number {
    if (entry.actual == null) return 0;
    const { bid, actual, bonus } = entry;
    const zeroBase = (playerCount >= 8 && roundNumber >= 9) ? 8 : roundNumber;
    if (actual === bid) {
        return (bid === 0 ? zeroBase * 10 : actual * 20) + bonus;
    }
    if (bid === 0) {
        return zeroBase * -10;
    }
    return Math.abs(bid - actual) * -10;
}

function playerTotal(
    rounds: (RoundEntry | null)[][],
    playerIndex: number,
    playerCount: number
): number {
    return rounds.reduce((sum, round, ri) => {
        const entry = round[playerIndex];
        if (!entry) return sum;
        return sum + calcRoundScore(entry, ri + 1, playerCount);
    }, 0);
}

// Returns the next index (wrapping) where isFilled(index) is false, or null if all filled.
function findNextUnfilled(from: number, count: number, isFilled: (i: number) => boolean): number | null {
    for (let i = 1; i < count; i++) {
        const idx = (from + i) % count;
        if (!isFilled(idx)) return idx;
    }
    return null;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function BidButtons({
    roundNumber,
    selected,
    onSelect,
    compact = false,
}: {
    roundNumber: number;
    selected: number | null;
    onSelect: (n: number) => void;
    compact?: boolean;
}) {
    return (
        <div className={`flex flex-wrap ${compact ? "gap-1.5" : "gap-2 md:gap-3"}`}>
            {Array.from({ length: roundNumber + 1 }, (_, i) => (
                <Button
                    key={i}
                    variant={selected === i ? "default" : "outline"}
                    size={compact ? "default" : "lg"}
                    className={compact
                        ? "h-10 min-w-10 md:h-12 md:min-w-12 md:text-lg lg:h-14 lg:min-w-14 lg:text-xl"
                        : "w-14 h-14 text-xl md:w-16 md:h-16 md:text-2xl lg:w-20 lg:h-20 lg:text-3xl"
                    }
                    onClick={() => onSelect(i)}
                >
                    {i}
                </Button>
            ))}
        </div>
    );
}

function GameTable({
    state,
    onCellClick,
    maskedRoundIndex,
}: {
    state: GameState;
    onCellClick?: (roundIndex: number, playerIndex: number) => void;
    maskedRoundIndex?: number;
}) {
    const { players, rounds } = state;

    const clickable = !!onCellClick;

    // Compute totals
    const totals = players.map((_, pi) =>
        rounds.reduce((sum, round, ri) => {
            const entry = round[pi];
            if (!entry || entry.actual === null) return sum;
            return sum + calcRoundScore(entry, ri + 1, players.length);
        }, 0)
    );

    return (
        <div className="overflow-x-auto max-w-full">
            <table className="border-collapse text-sm md:text-base">
                <thead>
                    <tr>
                        <th className="border border-border px-2 py-0.5 md:px-3 md:py-1.5 text-center bg-muted min-w-12 md:min-w-16"></th>
                        {players.map((p) => (
                            <th key={p.id} className="border border-border px-1 py-0.5 md:px-2 md:py-1.5 text-center bg-muted min-w-[2.5rem] sm:min-w-20 md:min-w-24">
                                <span className="inline-block [writing-mode:vertical-lr] rotate-180 sm:[writing-mode:horizontal-tb] sm:rotate-0 sm:max-w-none truncate">
                                    {p.name}
                                </span>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rounds.map((round, ri) => (
                        <tr key={ri}>
                            <td className="border border-border px-2 py-0.5 md:px-3 md:py-1.5 text-center font-medium bg-muted/50">
                                {ri + 1}
                            </td>
                            {players.map((_, pi) => {
                                const entry = round[pi];
                                if (!entry) return <td key={pi} className="border border-border px-2 py-0.5" />;
                                const isMasked = maskedRoundIndex !== undefined && ri === maskedRoundIndex;
                                const isClickable = clickable && !isMasked;
                                const score = !isMasked && entry.actual !== null
                                    ? calcRoundScore(entry, ri + 1, players.length)
                                    : null;
                                const scoreDisplay = score !== null
                                    ? entry.bonus > 0
                                        ? `${score - entry.bonus > 0 ? "+" : ""}${score - entry.bonus}+${entry.bonus}`
                                        : `${score > 0 ? "+" : ""}${score}`
                                    : null;
                                return (
                                    <td
                                        key={pi}
                                        className={`border border-border px-1 py-0.5 md:px-3 md:py-1.5 text-center [container-type:inline-size] ${isClickable ? "cursor-pointer hover:bg-accent" : ""}`}
                                        onClick={() => isClickable && onCellClick!(ri, pi)}
                                    >
                                        <div className="flex flex-col items-center leading-tight">
                                            <span className="text-muted-foreground text-center whitespace-nowrap" style={{ fontSize: "clamp(7px, 6cqi, 12px)" }}>
                                                {entry.actual !== null ? entry.actual : "—"}/{isMasked ? "?" : entry.bid}
                                            </span>
                                            <span className={`font-semibold text-center whitespace-nowrap ${score! < 0 ? "text-red-600" : "text-green-700"}`} style={{ fontSize: "clamp(7px, 7cqi, 14px)" }}>
                                                {scoreDisplay ?? ""}
                                            </span>
                                        </div>
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                    {/* Totals row */}
                    {rounds.length > 0 && (
                        <tr className="bg-muted/50 font-bold">
                            <td className="border border-border px-2 py-0.5 md:px-3 md:py-1.5 text-center">Σ</td>
                            {totals.map((total, pi) => (
                                <td key={pi} className={`border border-border px-2 py-0.5 md:px-3 md:py-1.5 text-center font-semibold ${total < 0 ? "text-red-600" : "text-green-700"}`}>
                                    {total}
                                </td>
                            ))}
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}

function EditCellDialog({
    open,
    onClose,
    roundIndex,
    playerIndex,
    state,
    onSave,
}: {
    open: boolean;
    onClose: () => void;
    roundIndex: number;
    playerIndex: number;
    state: GameState;
    onSave: (roundIndex: number, playerIndex: number, entry: RoundEntry) => void;
}) {
    const roundNumber = roundIndex + 1;
    const playerName = state.players[playerIndex]?.name ?? "";
    const original = state.rounds[roundIndex]?.[playerIndex] ?? { bid: 0, actual: null, bonus: 0 };

    const [bid, setBid] = useState(original.bid);
    const [actual, setActual] = useState<number | null>(original.actual ?? null);
    const [bonus, setBonus] = useState(original.bonus);

    // Reset on open
    React.useEffect(() => {
        if (open) {
            setBid(original.bid);
            setActual(original.actual ?? null);
            setBonus(original.bonus);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, roundIndex, playerIndex]);

    const bonusApplicable = actual !== null && actual === bid;

    function handleSave() {
        onSave(roundIndex, playerIndex, {
            bid,
            actual,
            bonus: bonusApplicable ? bonus : 0,
        });
        onClose();
    }

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        Раунд {roundNumber} — {playerName}
                    </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                    <div>
                        <p className="text-sm font-medium mb-2">План (взяток):</p>
                        <BidButtons roundNumber={roundNumber} selected={bid} onSelect={setBid} compact />
                    </div>
                    <div>
                        <p className="text-sm font-medium mb-2">Факт (взяток):</p>
                        <BidButtons
                            roundNumber={roundNumber}
                            selected={actual}
                            onSelect={(i) => { setActual(i); if (i !== bid) setBonus(0); }}
                            compact
                        />
                    </div>
                    {bonusApplicable && (
                        <div>
                            <p className="text-sm font-medium mb-2">Бонус: {bonus}</p>
                            <div className="flex flex-wrap gap-2">
                                {[10, 20, 30, 40].map((b) => (
                                    <Button key={b} variant="outline" className="md:h-12 md:min-w-[3.5rem] md:text-base lg:h-14 lg:min-w-[4rem] lg:text-lg" onClick={() => setBonus((v) => v + b)}>
                                        +{b}
                                    </Button>
                                ))}
                                <Button variant="ghost" className="md:h-12 md:text-base lg:h-14 lg:text-lg" onClick={() => setBonus(0)}>
                                    Сбросить
                                </Button>
                            </div>
                        </div>
                    )}
                    <Button className="w-full md:h-12 md:text-base lg:h-14 lg:text-lg" onClick={handleSave}>Сохранить</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function SkullKingGamePage() {
    const me = useMe();
    const { players: allPlayers, playerDisplayName } = usePlayers();
    const { games } = useGames();
    const { invalidate: invalidateMatches } = useMatches();
    const { invalidate: invalidatePlayers } = usePlayers();
    const router = useRouter();

    const [gameState, setGameStateRaw] = useLocalStorage<GameState>(LS_KEY, initialState);
    const [tableSession, setTableSession] = useLocalStorage<TableSession | null>(TABLE_SESSION_KEY, null);
    const [setupPlayerIds, setSetupPlayerIds] = useState<string[]>(
        gameState.players.map((p) => p.id)
    );

    // Active tables list (fetched in setup phase)
    const [activeTables, setActiveTables] = useState<SkullKingTableSummary[]>([]);
    const [tablesLoading, setTablesLoading] = useState(false);
    const [joiningTableId, setJoiningTableId] = useState<string | null>(null);

    // SSE subscription for all table participants (host + connected players).
    // Skip the optimistic placeholder tableId "" set before the API call resolves.
    const sseTable = useSkullKingSSE(tableSession?.tableId || null);
    const [connectedPlayerIds, setConnectedPlayerIds] = useState<number[]>([]);

    // When SSE delivers an update, apply game state and connected player list
    useEffect(() => {
        if (sseTable) {
            setGameStateRaw(sseTable.game_state);
            setConnectedPlayerIds(sseTable.connected_player_ids);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sseTable]);

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

    // Refresh local state from the server (used to recover from phase mismatches on 409)
    const refreshStateFromServer = useCallback(async () => {
        if (!tableSession?.tableId) return;
        try {
            const table = await getSkullKingTablePromise(tableSession.tableId);
            setGameStateRaw(table.game_state);
        } catch {
            // ignore
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tableSession]);

    // Drag-and-drop state for player reordering
    const dragIndexRef = React.useRef<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

    function handleDragStart(index: number) {
        dragIndexRef.current = index;
    }

    function handleDragOver(e: React.DragEvent, index: number) {
        e.preventDefault();
        setDragOverIndex(index);
    }

    function handleDrop(index: number) {
        const from = dragIndexRef.current;
        if (from === null || from === index) {
            dragIndexRef.current = null;
            setDragOverIndex(null);
            return;
        }
        const newIds = [...setupPlayerIds];
        const [moved] = newIds.splice(from, 1);
        newIds.splice(index, 0, moved);
        setSetupPlayerIds(newIds);
        dragIndexRef.current = null;
        setDragOverIndex(null);
    }

    function handleDragEnd() {
        dragIndexRef.current = null;
        setDragOverIndex(null);
    }

    // Edit cell dialog state
    const [editCell, setEditCell] = useState<{ roundIndex: number; playerIndex: number } | null>(null);

    // Save state
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState("");

    const skullKingGame = useMemo(
        () => games.find((g) => g.name.toLowerCase().includes("skull king")),
        [games]
    );

    // Load active tables when in setup phase
    useEffect(() => {
        if (gameState.phase !== "setup" || tableSession !== null) return;
        setTablesLoading(true);
        listSkullKingTablesPromise()
            .then(setActiveTables)
            .catch(() => {}) // ignore errors silently
            .finally(() => setTablesLoading(false));
    }, [gameState.phase, tableSession]);

    async function handleJoinTable(table: SkullKingTableSummary) {
        if (!me.isAuthenticated || !me.playerId) return;
        setJoiningTableId(table.id);
        try {
            const updated = await joinSkullKingTablePromise(table.id);
            const playerIdx = updated.game_state.players.findIndex((p) => p.id === me.playerId);
            setTableSession({
                tableId: table.id,
                isHost: false,
                myPlayerIndex: playerIdx === -1 ? null : playerIdx,
            });
            setGameStateRaw(updated.game_state);
            setConnectedPlayerIds(updated.connected_player_ids);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        } finally {
            setJoiningTableId(null);
        }
    }

    async function resetGame() {
        // Only delete server table if we have a real (non-placeholder) tableId
        if (tableSession?.isHost && tableSession.tableId) {
            try { await deleteSkullKingTablePromise(tableSession.tableId); } catch { /* ignore */ }
        }
        setGameStateRaw(initialState);
        setTableSession(null);
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
        // "Ждать ставок от игроков" button appears immediately while the API call is in flight.
        if (me.isAuthenticated && me.playerId) {
            setTableSession({ tableId: "", isHost: true, myPlayerIndex: null });
            try {
                const table = await createSkullKingTablePromise(newState);
                setTableSession({ tableId: table.id, isHost: true, myPlayerIndex: null });
                setConnectedPlayerIds(table.connected_player_ids);
            } catch (err) {
                toast.error("Не удалось создать стол: " + (err instanceof Error ? err.message : String(err)));
                setTableSession(null); // revert to local-only
            }
        }
    }

    function movePlayerUp(index: number) {
        if (index === 0) return;
        const newIds = [...setupPlayerIds];
        [newIds[index - 1], newIds[index]] = [newIds[index], newIds[index - 1]];
        setSetupPlayerIds(newIds);
    }

    function movePlayerDown(index: number) {
        if (index === setupPlayerIds.length - 1) return;
        const newIds = [...setupPlayerIds];
        [newIds[index], newIds[index + 1]] = [newIds[index + 1], newIds[index]];
        setSetupPlayerIds(newIds);
    }

    // ── Connected player submits their own bid via server ──────────────────────
    async function handleConnectedPlayerBid(bid: number) {
        if (!tableSession || tableSession.isHost) return;
        try {
            const updated = await submitSkullKingBidPromise(tableSession.tableId, bid);
            setGameStateRaw(updated.game_state);
        } catch (err) {
            // On phase mismatch (409) or any error, refresh state from server
            // so the UI reflects the actual current game phase
            await refreshStateFromServer();
            toast.error(err instanceof Error ? err.message : String(err));
        }
    }

    // ── Connected player submits their own result via server ──────────────────
    async function handleConnectedPlayerResult(actual: number, bonus: number) {
        if (!tableSession || tableSession.isHost) return;
        try {
            const updated = await submitSkullKingResultPromise(tableSession.tableId, actual, bonus);
            setGameStateRaw(updated.game_state);
        } catch (err) {
            // On phase mismatch (409) or any error, refresh state from server
            await refreshStateFromServer();
            toast.error(err instanceof Error ? err.message : String(err));
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
            setGameState({ ...gameState, rounds: newRounds, currentPlayerIndex: 0, phase: "bid-review" });
        } else {
            const next = findNextUnfilled(playerIndex, players.length, (i) => !!newRounds[roundIndex][i]);
            setGameState({ ...gameState, rounds: newRounds, currentPlayerIndex: next ?? playerIndex });
        }
    }

    function startResultEntry() {
        setGameState({ ...gameState, phase: "result-entry", currentPlayerIndex: 0 });
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
            .every((e) => e !== null && e.actual !== null);

        if (allDone) {
            setGameState({ ...gameState, rounds: newRounds, currentPlayerIndex: 0, phase: "round-complete" });
        } else {
            const next = findNextUnfilled(
                playerIndex,
                players.length,
                (i) => (newRounds[roundIndex][i]?.actual ?? null) !== null
            );
            setGameState({ ...gameState, rounds: newRounds, currentPlayerIndex: next ?? playerIndex });
        }
    }

    function startNextRound() {
        const nextRound = gameState.currentRound + 1;
        const newRounds = [...gameState.rounds];
        // Pre-initialize the next round slot for connected-player bid submissions.
        if (tableSession !== null) {
            newRounds[nextRound - 1] = new Array(gameState.players.length).fill(null);
        }
        setGameState({
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
            const result = await addMatchPromise({ game_id: gameId, score });
            invalidateMatches();
            invalidatePlayers();
            // Delete server table if in table mode
            if (tableSession?.tableId) {
                try { await deleteSkullKingTablePromise(tableSession.tableId); } catch { /* ignore */ }
            }
            localStorage.removeItem(LS_KEY);
            setTableSession(null);
            router.push(`/match?id=${result.id}`);
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    }

    // ── Render ───────────────────────────────────────────────────────────────

    const { phase, players, currentRound, currentPlayerIndex, rounds } = gameState;
    const isHost = !tableSession || tableSession.isHost;
    const myPlayerIndex = tableSession?.myPlayerIndex ?? null;

    // For connected players, check if their slot is already filled by host
    const mySlotBidSet = myPlayerIndex !== null
        ? !!(rounds[currentRound - 1]?.[myPlayerIndex]?.bid !== undefined && rounds[currentRound - 1]?.[myPlayerIndex] !== null)
        : false;
    const mySlotResultSet = myPlayerIndex !== null
        ? (rounds[currentRound - 1]?.[myPlayerIndex]?.actual ?? null) !== null
        : false;


    return (
        <main className="max-w-5xl mx-auto space-y-4 overflow-x-hidden">
            <PageHeader
                title="Skull King"
                action={phase !== "setup" ? (
                    isHost ? (
                        <AlertDialog>
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
                                    <AlertDialogCancel>Отмена</AlertDialogCancel>
                                    <AlertDialogAction onClick={resetGame}>Начать</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    ) : (
                        <Button variant="outline" size="sm" onClick={resetGame}>Новая партия</Button>
                    )
                ) : null}
            />

            <AuthWarning />

            {/* ── SETUP ──────────────────────────────────────── */}
            {phase === "setup" && (
                <div className="space-y-4">
                    {/* Active tables card */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Users className="h-5 w-5" />
                                Активные столы
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {tablesLoading && (
                                <p className="text-sm text-muted-foreground">Загрузка...</p>
                            )}
                            {!tablesLoading && activeTables.length === 0 && (
                                <p className="text-sm text-muted-foreground">Нет активных столов</p>
                            )}
                            {!tablesLoading && activeTables.length > 0 && (
                                <div className="space-y-2">
                                    {activeTables.map((table) => {
                                        const playerNames = table.game_state.players.map(p => p.name).join(", ");
                                        const phase = table.game_state.phase;
                                        const roundInfo = phase !== "setup"
                                            ? `Раунд ${table.game_state.currentRound}`
                                            : "Ожидание игроков";
                                        const canJoin = me.isAuthenticated && !!me.playerId;
                                        return (
                                            <div key={table.id} className="flex items-center justify-between rounded border border-border px-3 py-2 gap-2">
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium truncate">{playerNames || "—"}</p>
                                                    <p className="text-xs text-muted-foreground">{roundInfo}</p>
                                                </div>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    disabled={!canJoin || joiningTableId === table.id}
                                                    onClick={() => handleJoinTable(table)}
                                                    title={!canJoin ? "Для входа нужна авторизация и привязка к игроку" : undefined}
                                                >
                                                    {joiningTableId === table.id ? "Вход..." : "Войти"}
                                                </Button>
                                            </div>
                                        );
                                    })}
                                    {!me.isAuthenticated && (
                                        <p className="text-xs text-muted-foreground">Войдите в аккаунт и привяжите игрока, чтобы присоединиться к столу</p>
                                    )}
                                    {me.isAuthenticated && !me.playerId && (
                                        <p className="text-xs text-muted-foreground">Привяжите аккаунт к игроку, чтобы присоединиться к столу</p>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Player setup card */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Новая партия</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <PlayerMultiSelect
                                value={setupPlayerIds}
                                onChange={setSetupPlayerIds}
                            />

                            {setupPlayerIds.length > 0 && (
                                <div className="space-y-1">
                                    <p className="text-sm font-medium text-muted-foreground">Порядок:</p>
                                    {setupPlayerIds.map((id, index) => {
                                        const player = allPlayers.find((p) => p.id === id);
                                        const isDragOver = dragOverIndex === index;
                                        return (
                                            <div
                                                key={id}
                                                draggable
                                                onDragStart={() => handleDragStart(index)}
                                                onDragOver={(e) => handleDragOver(e, index)}
                                                onDrop={() => handleDrop(index)}
                                                onDragEnd={handleDragEnd}
                                                className={`flex items-center gap-2 rounded px-1 cursor-grab active:cursor-grabbing transition-colors ${isDragOver ? "bg-accent" : ""}`}
                                            >
                                                <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                                                <span className="flex-1 text-sm">{index + 1}. {player ? playerDisplayName(player) : id}</span>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    disabled={index === 0}
                                                    onClick={() => movePlayerUp(index)}
                                                >
                                                    <ChevronUp className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    disabled={index === setupPlayerIds.length - 1}
                                                    onClick={() => movePlayerDown(index)}
                                                >
                                                    <ChevronDown className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            <Button
                                className="w-full md:h-12 md:text-base lg:h-14 lg:text-lg"
                                disabled={setupPlayerIds.length < 2}
                                onClick={startGame}
                            >
                                Начать игру
                            </Button>
                        </CardContent>
                    </Card>
                </div>
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
                            <GameTable state={gameState} maskedRoundIndex={currentRound - 1} />
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
                                    />
                                </TabsContent>
                            ))}
                        </Tabs>
                        {rounds[currentRound - 1]?.slice(0, players.length).every((e) => e !== null) && (
                            <Button
                                className="w-full md:h-12 md:text-base"
                                onClick={() => setGameState({ ...gameState, phase: "bid-review", currentPlayerIndex: 0 })}
                            >
                                Перейти к обзору
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
                                            Ставка принята: {rounds[currentRound - 1]?.[myPlayerIndex]?.bid}
                                        </p>
                                        <p className="text-sm text-muted-foreground">Ожидайте остальных игроков...</p>
                                    </div>
                                ) : (
                                    <>
                                        <p className="text-sm md:text-base">Сколько взяток планируете взять?</p>
                                        <BidButtons
                                            roundNumber={currentRound}
                                            selected={rounds[currentRound - 1]?.[myPlayerIndex]?.bid ?? null}
                                            onSelect={handleConnectedPlayerBid}
                                        />
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
                                <GameTable state={gameState} maskedRoundIndex={currentRound - 1} />
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
                                    onCellClick={(ri, pi) => setEditCell({ roundIndex: ri, playerIndex: pi })}
                                />
                                <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm mt-1">
                                    {players.map((p, pi) => {
                                        if (!connectedPlayerIds.some(id => String(id) === p.id)) return null;
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
                    {isHost && (
                        <Button
                            className="w-full md:h-12 md:text-base"
                            onClick={() => setGameState({ ...gameState, phase: "bidding", currentPlayerIndex: 0 })}
                        >
                            Ввести ставки
                        </Button>
                    )}
                </div>
            )}

            {/* ── BID REVIEW ─────────────────────────────────── */}
            {phase === "bid-review" && (
                <div className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Раунд {currentRound} — планы введены</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <GameTable
                                state={gameState}
                                onCellClick={isHost ? (ri, pi) => setEditCell({ roundIndex: ri, playerIndex: pi }) : undefined}
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
                        <Button className="w-full md:h-12 md:text-base lg:h-14 lg:text-lg" onClick={startResultEntry}>
                            Ввести результаты
                        </Button>
                    )}
                    {!isHost && (
                        <p className="text-sm text-muted-foreground text-center">Ожидание ведущего...</p>
                    )}
                </div>
            )}

            {/* ── RESULT ENTRY ───────────────────────────────── */}
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
                                    <ResultEntryCard
                                        player={players[myPlayerIndex]}
                                        roundNumber={currentRound}
                                        bid={rounds[currentRound - 1]?.[myPlayerIndex]?.bid ?? 0}
                                        initialActual={rounds[currentRound - 1]?.[myPlayerIndex]?.actual ?? null}
                                        initialBonus={rounds[currentRound - 1]?.[myPlayerIndex]?.bonus ?? 0}
                                        onSubmit={(actual, bonus) => handleConnectedPlayerResult(actual, bonus)}
                                    />
                                )}
                            </>
                        )}

                        {/* Host: full tab UI */}
                        {isHost && (
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
                                            />
                                        </TabsContent>
                                    );
                                })}
                            </Tabs>
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
                            <GameTable state={gameState} />
                        </CardContent>
                    </Card>
                )}
                </div>
            )}

            {/* ── ROUND COMPLETE ─────────────────────────────── */}
            {phase === "round-complete" && (
                <div className="space-y-4">
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
                        <Button className="w-full md:h-12 md:text-base lg:h-14 lg:text-lg" onClick={startNextRound}>
                            Следующий раунд ({currentRound + 1} / {TOTAL_ROUNDS})
                        </Button>
                    )}

                    {!isHost && currentRound < TOTAL_ROUNDS && (
                        <p className="text-sm text-muted-foreground text-center">Ожидание ведущего...</p>
                    )}

                    {currentRound === TOTAL_ROUNDS && isHost && (
                        <div className="space-y-2">
                            {!skullKingGame && (
                                <div className="space-y-1">
                                    <p className="text-sm text-muted-foreground">
                                        Не найдена игра "Skull King". Выберите вручную:
                                    </p>
                                    <GameCombobox
                                        value={gameState.fallbackGameId ?? undefined}
                                        onChange={(id) =>
                                            setGameState({ ...gameState, fallbackGameId: id })
                                        }
                                    />
                                </div>
                            )}
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
                                {saving ? "Сохранение..." : "Сохранить партию"}
                            </Button>
                        </div>
                    )}

                    {currentRound === TOTAL_ROUNDS && !isHost && (
                        <p className="text-sm text-muted-foreground text-center">Ожидание сохранения ведущим...</p>
                    )}
                </div>
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

// ─── Result entry as separate component to keep state local ──────────────────

function ResultEntryCard({
    player,
    roundNumber,
    bid,
    initialActual = null,
    initialBonus = 0,
    onSubmit,
}: {
    player: { id: string; name: string };
    roundNumber: number;
    bid: number;
    initialActual?: number | null;
    initialBonus?: number;
    onSubmit: (actual: number, bonus: number) => void;
}) {
    const [actual, setActual] = useState<number | null>(initialActual);
    const [bonus, setBonus] = useState(initialBonus);

    // Bonus is applicable whenever plan is exactly met
    const bonusApplicable = actual !== null && actual === bid;

    function handleActualSelect(n: number) {
        const willHaveBonus = n === bid;
        setActual(n);
        setBonus(0);
        if (!willHaveBonus) {
            // No bonus to enter — advance immediately
            onSubmit(n, 0);
        }
    }

    function handleNext() {
        if (actual === null) return;
        onSubmit(actual, bonus);
    }

    return (
        <div className="space-y-4">
            <div>
                <p className="text-xl md:text-2xl font-semibold">{player.name}</p>
                <p className="text-sm md:text-base text-muted-foreground">
                    план: {bid}
                </p>
            </div>

            <div>
                <p className="text-sm md:text-base font-medium mb-2">Взято взяток:</p>
                <BidButtons
                    roundNumber={roundNumber}
                    selected={actual}
                    onSelect={handleActualSelect}
                />
            </div>

            {bonusApplicable && (
                <>
                    <div>
                        <p className="text-sm md:text-base font-medium mb-2">
                            Бонус: {bonus}
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {[10, 20, 30, 40].map((b) => (
                                <Button
                                    key={b}
                                    variant="outline"
                                    className="md:h-12 md:min-w-[3.5rem] md:text-base lg:h-14 lg:min-w-[4rem] lg:text-lg"
                                    onClick={() => setBonus((v) => v + b)}
                                >
                                    +{b}
                                </Button>
                            ))}
                            <Button variant="ghost" className="md:h-12 md:text-base lg:h-14 lg:text-lg" onClick={() => setBonus(0)}>
                                Сбросить
                            </Button>
                        </div>
                    </div>

                    <Button className="w-full md:h-12 md:text-base lg:h-14 lg:text-lg" onClick={handleNext}>
                        Дальше
                    </Button>
                </>
            )}
        </div>
    );
}
