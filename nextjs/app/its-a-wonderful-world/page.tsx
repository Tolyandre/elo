"use client";

import React, { useState, useMemo } from "react";
import { PageHeader } from "@/app/pageHeaderContext";
import { useRouter } from "next/navigation";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { usePlayers } from "@/app/players/PlayersContext";
import { useGames } from "@/app/gamesContext";
import { useMatches } from "@/app/matches/MatchesContext";
import { useMe } from "@/app/meContext";
import { useOffline } from "@/app/offline/OfflineContext";
import { useTournamentSelection } from "@/hooks/useTournamentSelection";
import { TournamentCheckboxes } from "@/components/tournament-checkboxes";
import { PlayerMultiSelect } from "@/components/player-multi-select";
import { GameCombobox } from "@/components/game-combobox";
import { AuthWarning } from "@/components/auth-warning";
import { Button } from "@/components/ui/button";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { VictoryPoints } from "@/components/calculators/iaww/victory-points";
import { EditDialog } from "@/components/calculators/iaww/edit-dialog";
import { ScoringTable } from "@/components/calculators/iaww/scoring-table";
import {
    INITIAL, playerTotal,
} from "@/components/calculators/iaww/scoring";
import { toStorage } from "@/components/calculators/iaww/storage";
import type { CellValue, EditTarget, GameState } from "@/components/calculators/iaww/scoring";

const CALCULATOR_KIND = "iaww";
const LS_KEY = "iaww/state";

export default function ItsAWonderfulWorldPage() {
    const { players: allPlayers, playerDisplayName } = usePlayers();
    const { games } = useGames();
    const me = useMe();
    const { invalidate: invalidateMatches } = useMatches();
    const { invalidate: invalidatePlayers } = usePlayers();
    const { submitMatch, offline } = useOffline();
    const router = useRouter();

    const [gameState, setGameState] = useLocalStorage<GameState>(LS_KEY, INITIAL);
    const [setupPlayerIds, setSetupPlayerIds] = useState<string[]>(
        gameState.players.map(p => p.id)
    );
    const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState("");

    // Tournament selection for the saved match. Mandatory tournaments (all players
    // are members) are applied server-side; checked carries the host's explicit picks.
    const [checkedTournamentIds, setCheckedTournamentIds] = useState<string[]>([]);
    const tournamentDate = useMemo(() => new Date(), []);
    const tournamentPlayerIds = useMemo(() => gameState.players.map(p => p.id), [gameState.players]);
    const {
        active: activeTournamentsForSave,
        isMandatory: isTournamentMandatory,
        idsToSubmit: tournamentIdsToSubmit,
    } = useTournamentSelection(tournamentPlayerIds, tournamentDate);
    const toggleTournament = (id: string, checked: boolean) =>
        setCheckedTournamentIds(prev =>
            checked ? [...new Set([...prev, id])] : prev.filter(t => t !== id),
        );

    const iawwGame = useMemo(
        () => games.find(g => g.name.toLowerCase().includes("эбм")),
        [games]
    );

    function resetGame() {
        setGameState(INITIAL);
        setSetupPlayerIds([]);
        setSaveError("");
    }

    function startScoring() {
        const players = setupPlayerIds
            .map(id => allPlayers.find(p => p.id === id))
            .filter(Boolean)
            .map(p => ({ id: p!.id, name: playerDisplayName(p!) }));
        if (players.length < 2) return;
        setGameState({ ...INITIAL, phase: "scoring", players });
    }

    function handleEdit(target: EditTarget) {
        setEditTarget(target);
    }

    function handleSaveCell(target: EditTarget, value: number | CellValue) {
        if (target.kind === "direct") {
            setGameState({
                ...gameState,
                directVP: { ...gameState.directVP, [target.playerId]: value as number },
            });
        } else {
            const row = gameState.multipliers[target.rowId] ?? {};
            setGameState({
                ...gameState,
                multipliers: {
                    ...gameState.multipliers,
                    [target.rowId]: { ...row, [target.playerId]: value as CellValue },
                },
            });
        }
    }

    async function saveGame() {
        const gameId = iawwGame?.id ?? gameState.fallbackGameId;
        if (!gameId) return;
        setSaving(true);
        setSaveError("");
        try {
            const score: Record<string, number> = {};
            gameState.players.forEach(p => {
                score[p.id] = playerTotal(gameState, p.id);
            });
            const result = await submitMatch({
                game_id: gameId,
                score,
                tournament_ids: tournamentIdsToSubmit(checkedTournamentIds),
                calculator_kind: CALCULATOR_KIND,
                calculator_data: toStorage(gameState) as unknown as Record<string, never>,
            });
            localStorage.removeItem(LS_KEY);
            // The match was either saved on the server or queued offline; either way
            // its id is final. The view page shows the pending or saved card by id.
            if (!offline) {
                invalidateMatches();
                invalidatePlayers();
            }
            router.push(`/matches/view?id=${result.id}`);
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    }

    // ── Setup phase ───────────────────────────────────────────────────────────

    if (gameState.phase === "setup") {
        return (
            <main className="max-w-sm mx-auto p-4 space-y-4">
                <PageHeader title="Этот Безумный Мир" />
                <div className="space-y-3">
                    <PlayerMultiSelect value={setupPlayerIds} onChange={setSetupPlayerIds} />
                    <Button
                        className="w-full"
                        disabled={setupPlayerIds.length < 2}
                        onClick={startScoring}
                    >
                        Начать подсчёт
                    </Button>
                </div>
            </main>
        );
    }

    // ── Scoring phase ─────────────────────────────────────────────────────────

    return (
        <main className="p-3 sm:p-4 space-y-4 max-w-5xl mx-auto">
            <AuthWarning />
            <PageHeader title="Этот Безумный Мир" action={
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm">Новая партия</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Начать новую партию?</AlertDialogTitle>
                            <AlertDialogDescription>
                                Введённые данные будут удалены.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Отмена</AlertDialogCancel>
                            <AlertDialogAction onClick={resetGame}>Начать</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            } />

            <ScoringTable state={gameState} onEdit={handleEdit} />

            <EditDialog
                target={editTarget}
                state={gameState}
                onClose={() => setEditTarget(null)}
                onSave={handleSaveCell}
            />

            {/* Save section */}
            <div className="space-y-2 pt-2">
                {!iawwGame && (
                    <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">
                            Игра «ЭБМ» не найдена. Выберите вручную:
                        </p>
                        <GameCombobox
                            value={gameState.fallbackGameId}
                            onChange={id => setGameState({ ...gameState, fallbackGameId: id })}
                        />
                    </div>
                )}

                <TournamentCheckboxes
                    active={activeTournamentsForSave}
                    checked={checkedTournamentIds}
                    isMandatory={isTournamentMandatory}
                    onToggle={toggleTournament}
                />

                {saveError && <p className="text-sm text-red-600">{saveError}</p>}

                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button
                            className="w-full"
                            disabled={saving || (!iawwGame && !gameState.fallbackGameId) || !me.canEdit}
                        >
                            {saving ? "Сохранение…" : "Сохранить партию"}
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Сохранить партию?</AlertDialogTitle>
                            <AlertDialogDescription asChild>
                                <span className="space-y-1 mt-1 flex flex-col">
                                    {gameState.players.map(p => (
                                        <span key={p.id} className="flex items-center justify-between gap-4">
                                            <span>{p.name}</span>
                                            <VictoryPoints value={playerTotal(gameState, p.id)} />
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
        </main>
    );
}
