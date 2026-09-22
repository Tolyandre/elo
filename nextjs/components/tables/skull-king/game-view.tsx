"use client";

import { useState, useEffect } from "react";
import {
    SkullKingGameState as GameState,
    SkullKingRoundEntry as RoundEntry,
} from "@/app/api";
import { isSkullKingState } from "@/lib/game-apps";
import {
    GameTable,
    EditCellDialog,
    BidButtons,
    ScoreChart,
    playerTotal, findNextUnfilled, TOTAL_ROUNDS,
} from "@/components/calculators/skull-king";
import { toStorage as skToStorage } from "@/components/calculators/skull-king/storage";
import { MatchSaveSection } from "@/components/tables/match-save-section";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { TableGameViewProps } from "@/components/tables/registry";

// ─── Skull King in-table UI (ADR-16) ─────────────────────────────────────────
//
// The phases of a live game: connected players bid and enter their results
// themselves; the host drives the round transitions, can enter anything by
// hand (manual bidding / cell edits) and saves the final match. Participants
// are picked at table creation — there is no setup phase here.

export function SkullKingGameView({
    gameState,
    isHost,
    myPlayerIndex,
    connectedPlayerIds,
    isSyncing,
    isTransitioning,
    doPhaseTransition,
    setGameState,
    submitInput,
    campSelection,
    me,
    saving,
    saveError,
    saveMatch,
}: TableGameViewProps) {
    // The page dispatches by game_id, so this is always a Skull King state;
    // the guard only bridges the union typing (null before the first
    // snapshot — the page shows its connecting card then).
    const state: GameState | null = gameState !== null && isSkullKingState(gameState)
        ? gameState
        : null;

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isBidRevealed, setIsBidRevealed] = useState(false);
    // Edit cell dialog state
    const [editCell, setEditCell] = useState<{ roundIndex: number; playerIndex: number } | null>(null);

    // Auto-advance to round-complete when all results are filled (triggered via SSE in table mode)
    useEffect(() => {
        if (state?.phase !== "result-entry" || !isHost) return;
        const { rounds, currentRound, players } = state;
        const allDone = (rounds[currentRound - 1] ?? [])
            .slice(0, players.length)
            .every(e => e !== null && e.actual !== null);
        if (allDone) {
            void doPhaseTransition((prev) => {
                const s = prev as GameState;
                return { ...s, phase: "round-complete", currentPlayerIndex: 0 };
            });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- advance once per arriving state, like the SSE snapshot that triggered it
    }, [gameState]);

    // Reset bid reveal when round changes
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the per-round reveal toggle on round change
        setIsBidRevealed(false);
    }, [state?.currentRound]);

    // ── Connected player submits their own bid via server ──────────────────────
    async function handleConnectedPlayerBid(bid: number) {
        if (isHost) return;
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
        if (isHost) return;
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
        setGameState((prev) => {
            const s = prev as GameState;
            const { currentRound, players, rounds } = s;
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
                return { ...s, rounds: newRounds, currentPlayerIndex: 0, phase: "bid-review" as const };
            }
            const next = findNextUnfilled(playerIndex, players.length, (i) => !!newRounds[roundIndex][i]);
            return { ...s, rounds: newRounds, currentPlayerIndex: next ?? playerIndex };
        });
    }

    async function startResultEntry() {
        await doPhaseTransition((prev) => {
            const s = prev as GameState;
            const firstDisconnected = s.players.findIndex(
                (p) => !connectedPlayerIds.some(id => id === p.id),
            );
            const startIndex = firstDisconnected >= 0 ? firstDisconnected : 0;
            return { ...s, phase: "result-entry" as const, currentPlayerIndex: startIndex };
        });
    }

    function handleResultSubmit(actual: number, bonus: number, playerIndex: number) {
        setGameState((prev) => {
            const s = prev as GameState;
            const { currentRound, players, rounds } = s;
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
                return { ...s, rounds: newRounds, currentPlayerIndex: 0, phase: "round-complete" as const };
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
            return { ...s, rounds: newRounds, currentPlayerIndex: next ?? playerIndex };
        });
    }

    async function startNextRound() {
        await doPhaseTransition((prev) => {
            const s = prev as GameState;
            const nextRound = s.currentRound + 1;
            const newRounds = [...s.rounds];
            // Pre-initialize the next round slot for connected-player bid submissions.
            newRounds[nextRound - 1] = new Array(s.players.length).fill(null);
            return {
                ...s,
                rounds: newRounds,
                phase: "waiting-for-bids" as const,
                currentRound: nextRound,
                currentPlayerIndex: 0,
            };
        });
    }

    function handleCellEdit(roundIndex: number, playerIndex: number, entry: RoundEntry) {
        setGameState((prev) => {
            const s = prev as GameState;
            const newRounds = s.rounds.map((r) => [...r]);
            newRounds[roundIndex][playerIndex] = entry;
            return { ...s, rounds: newRounds };
        });
    }

    async function saveGame() {
        if (!state) return;
        const score: Record<string, number> = {};
        state.players.forEach((p, pi) => {
            score[p.id] = playerTotal(state.rounds, pi, state.players.length);
        });
        await saveMatch({
            score,
            calculatorData: skToStorage(state) as unknown as Record<string, never>,
        });
    }

    // ── Render ───────────────────────────────────────────────────────────────

    // Before the first snapshot there is nothing to render yet — the page
    // shows its connecting card around this view.
    if (!state) return null;

    const { phase, players, currentRound, currentPlayerIndex, rounds } = state;

    // For connected players, check if their slot is already filled by host
    const mySlotBidSet = myPlayerIndex !== null
        ? !!(rounds[currentRound - 1]?.[myPlayerIndex]?.bid !== undefined && rounds[currentRound - 1]?.[myPlayerIndex] !== null)
        : false;
    const mySlotResultSet = myPlayerIndex !== null
        ? (rounds[currentRound - 1]?.[myPlayerIndex]?.actual ?? null) !== null
        : false;

    // Running totals of players without a recorded result for the current round
    // stay hidden from a connected player (both in the table's Σ row and in the
    // score chart) until the host enters the results.
    const hiddenTotalPlayerIndices = phase === "result-entry" && !isHost
        ? players.map((_, pi) => pi).filter((pi) => (rounds[currentRound - 1]?.[pi]?.actual ?? null) === null)
        : undefined;

    return (
        <>
            {/* ── BIDDING (host manual entry) ────────────────── */}
            {phase === "bidding" && !isHost && (
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground text-center">Ожидание ведущего...</p>
                    <Card>
                        <CardHeader>
                            <CardTitle>Таблица результатов</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <GameTable state={state} planRoundIndex={currentRound - 1} />
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
                                setGameState((prev) => ({ ...(prev as GameState), currentPlayerIndex: Number(v) }))
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
                                onClick={() => doPhaseTransition((prev) => ({ ...(prev as GameState), phase: "bid-review" as const, currentPlayerIndex: 0 }))}
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
                                <GameTable state={state} maskedRoundIndex={currentRound - 1} planRoundIndex={currentRound - 1} />
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
                                    state={state}
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
                                await doPhaseTransition((prev) => ({ ...(prev as GameState), phase: "bid-review" as const, currentPlayerIndex: 0 }));
                            } else {
                                const firstUnfilled = roundData.findIndex(e => e == null);
                                await doPhaseTransition((prev) => ({
                                    ...(prev as GameState),
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
                                state={state}
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
                                            setGameState((prev) => ({ ...(prev as GameState), currentPlayerIndex: Number(v) }))
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
                                            state={state}
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
                                    state={state}
                                    hideTotalPlayerIndices={hiddenTotalPlayerIndices}
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
                                state={state}
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
                        <MatchSaveSection selection={campSelection} error={saveError}>
                            <Button
                                className="w-full md:h-12 md:text-base lg:h-14 lg:text-lg"
                                disabled={saving || !me.id}
                                onClick={saveGame}
                            >
                                {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-2 inline" />Сохранение...</> : "Сохранить партию"}
                            </Button>
                        </MatchSaveSection>
                    )}
                </div>
            )}

            {/* Players' score chart: shown at the bottom of every in-game phase
                once at least one round result exists. */}
            {rounds.some((r) => r.some((e) => !!e && e.actual !== null)) && (
                <Card>
                    <CardHeader>
                        <CardTitle>График очков</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ScoreChart state={state} hideTotalPlayerIndices={hiddenTotalPlayerIndices} />
                    </CardContent>
                </Card>
            )}

            {/* Edit cell dialog (host only) */}
            {isHost && editCell && (
                <EditCellDialog
                    open={!!editCell}
                    onClose={() => setEditCell(null)}
                    roundIndex={editCell.roundIndex}
                    playerIndex={editCell.playerIndex}
                    state={state}
                    onSave={handleCellEdit}
                />
            )}
        </>
    );
}
