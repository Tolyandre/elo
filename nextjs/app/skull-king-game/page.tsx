"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { usePlayers } from "@/app/players/PlayersContext";
import { useGames } from "@/app/gamesContext";
import { useMatches } from "@/app/matches/MatchesContext";
import { addMatchPromise } from "@/app/api";
import { PlayerMultiSelect } from "@/components/player-multi-select";
import { GameCombobox } from "@/components/game-combobox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { AlertCircleIcon, Check, ChevronDown, ChevronUp } from "lucide-react";
import { useMe } from "@/app/meContext";

// ─── Types ───────────────────────────────────────────────────────────────────

type RoundEntry = {
    bid: number;
    actual: number | null;
    bonus: number;
};

type GamePhase =
    | "setup"
    | "bidding"
    | "bid-review"
    | "result-entry"
    | "round-complete";

type GameState = {
    phase: GamePhase;
    players: { id: string; name: string }[];
    currentRound: number; // 1–10
    currentPlayerIndex: number;
    rounds: (RoundEntry | null)[][]; // rounds[roundIndex][playerIndex], 0-based, null = not yet entered
    fallbackGameId?: string;
};

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
    if (entry.actual === null) return 0;
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
}: {
    state: GameState;
    onCellClick?: (roundIndex: number, playerIndex: number) => void;
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
                        <th className="border border-border px-2 py-1 md:px-3 md:py-2 text-center bg-muted min-w-12 md:min-w-16"></th>
                        {players.map((p) => (
                            <th key={p.id} className="border border-border px-1 py-1 md:px-2 md:py-2 text-center bg-muted min-w-[2.5rem] sm:min-w-20 md:min-w-24">
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
                            <td className="border border-border px-2 py-1 md:px-3 md:py-2 text-center font-medium bg-muted/50">
                                {ri + 1}
                            </td>
                            {players.map((_, pi) => {
                                const entry = round[pi];
                                if (!entry) return <td key={pi} className="border border-border px-2 py-1" />;
                                const score = entry.actual !== null
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
                                        className={`border border-border px-2 py-1 md:px-3 md:py-2 text-center whitespace-nowrap ${clickable ? "cursor-pointer hover:bg-accent" : ""}`}
                                        onClick={() => clickable && onCellClick!(ri, pi)}
                                    >
                                        <div className="grid grid-cols-2 items-center gap-x-1">
                                            <span className="text-xs md:text-sm text-muted-foreground text-center">
                                                {entry.actual !== null ? entry.actual : "—"}/{entry.bid}
                                            </span>
                                            <span className={`font-semibold text-sm md:text-base text-center ${score! < 0 ? "text-red-600" : "text-green-700"}`}>
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
                            <td className="border border-border px-2 py-1 md:px-3 md:py-2 text-center">Σ</td>
                            {totals.map((total, pi) => (
                                <td key={pi} className={`border border-border px-2 py-1 md:px-3 md:py-2 text-center font-semibold ${total < 0 ? "text-red-600" : "text-green-700"}`}>
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
    const [actual, setActual] = useState<number | null>(original.actual);
    const [bonus, setBonus] = useState(original.bonus);

    // Reset on open
    React.useEffect(() => {
        if (open) {
            setBid(original.bid);
            setActual(original.actual);
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

    const [gameState, setGameState] = useLocalStorage<GameState>(LS_KEY, initialState);
    const [setupPlayerIds, setSetupPlayerIds] = useState<string[]>(
        gameState.players.map((p) => p.id)
    );

    // Edit cell dialog state
    const [editCell, setEditCell] = useState<{ roundIndex: number; playerIndex: number } | null>(null);

    // Save state
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState("");

    const skullKingGame = useMemo(
        () => games.find((g) => g.name.toLowerCase().includes("skull king")),
        [games]
    );

    function resetGame() {
        setGameState(initialState);
        setSetupPlayerIds([]);
        setSaveError("");
    }

    function startGame() {
        const players = setupPlayerIds
            .map((id) => allPlayers.find((p) => p.id === id))
            .filter(Boolean)
            .map((p) => ({ id: p!.id, name: playerDisplayName(p!) }));
        if (players.length < 2) return;
        setGameState({
            phase: "bidding",
            players,
            currentRound: 1,
            currentPlayerIndex: 0,
            rounds: [],
        });
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
        newRounds[roundIndex][playerIndex] = {
            ...newRounds[roundIndex][playerIndex]!,
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
        setGameState({
            ...gameState,
            phase: "bidding",
            currentRound: gameState.currentRound + 1,
            currentPlayerIndex: 0,
        });
    }

    function handleCellEdit(roundIndex: number, playerIndex: number, entry: RoundEntry) {
        const newRounds = gameState.rounds.map((r) => [...r]);
        newRounds[roundIndex][playerIndex] = entry;
        setGameState({ ...gameState, rounds: newRounds });
    }

    async function saveGame() {
        const gameId =
            skullKingGame?.id ?? gameState.fallbackGameId;
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
            localStorage.removeItem(LS_KEY);
            router.push(`/match?id=${result.id}`);
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    }

    // ── Render ───────────────────────────────────────────────────────────────

    const { phase, players, currentRound, currentPlayerIndex, rounds } = gameState;

    return (
        <main className="max-w-5xl mx-auto p-4 space-y-4 overflow-x-hidden">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">Skull King</h1>
                {phase !== "setup" && (
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
                )}
            </div>

            {/* Auth warning */}
            {!me.id && (
                <Alert>
                    <AlertCircleIcon />
                    <AlertTitle>Для сохранения партии потребуется выполнить вход</AlertTitle>
                    <AlertDescription>Результаты временно хранятся в браузере</AlertDescription>
                </Alert>
            )}

            {/* ── SETUP ──────────────────────────────────────── */}
            {phase === "setup" && (
                <Card>
                    <CardHeader>
                        <CardTitle>Игроки</CardTitle>
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
                                    return (
                                        <div key={id} className="flex items-center gap-2">
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
            )}

            {/* ── BIDDING ────────────────────────────────────── */}
            {phase === "bidding" && (
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
                    </CardContent>
                </Card>
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
                                onCellClick={(ri, pi) => setEditCell({ roundIndex: ri, playerIndex: pi })}
                            />
                            <p className="text-xs text-muted-foreground mt-2">
                                Нажмите на ячейку для редактирования
                            </p>
                            <div className="text-base md:text-lg font-medium mt-3 space-y-1">
                                <p>
                                    Сумма планов:{" "}
                                    <span className="font-bold">
                                        {(rounds[currentRound - 1] ?? []).reduce((s, e) => s + (e?.bid ?? 0), 0)}
                                    </span>
                                </p>
                                <p>
                                    Раздано карт:{" "}
                                    <span className="font-bold">
                                        {(players.length >= 8 && currentRound >= 9) ? 8 : currentRound}
                                    </span>
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                    <Button className="w-full md:h-12 md:text-base lg:h-14 lg:text-lg" onClick={startResultEntry}>
                        Ввести результаты
                    </Button>
                </div>
            )}

            {/* ── RESULT ENTRY ───────────────────────────────── */}
            {phase === "result-entry" && (
                <Card>
                    <CardHeader>
                        <CardTitle>Раунд {currentRound} — результаты</CardTitle>
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
                    </CardContent>
                </Card>
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
                                onCellClick={(ri, pi) => setEditCell({ roundIndex: ri, playerIndex: pi })}
                            />
                            <p className="text-xs text-muted-foreground mt-2">
                                Нажмите на ячейку для редактирования
                            </p>
                        </CardContent>
                    </Card>

                    {currentRound < TOTAL_ROUNDS ? (
                        <Button className="w-full md:h-12 md:text-base lg:h-14 lg:text-lg" onClick={startNextRound}>
                            Следующий раунд ({currentRound + 1} / {TOTAL_ROUNDS})
                        </Button>
                    ) : (
                        <div className="space-y-2">
                            {!skullKingGame && (
                                <div className="space-y-1">
                                    <p className="text-sm text-muted-foreground">
                                        Не найдена игра "Skull King". Выберите вручную:
                                    </p>
                                    <GameCombobox
                                        value={gameState.fallbackGameId}
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
                            {!me.id && (
                                <p className="text-xs text-muted-foreground text-center">
                                    Необходим вход для сохранения
                                </p>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Edit cell dialog */}
            {editCell && (
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
