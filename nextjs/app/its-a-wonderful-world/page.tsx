"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { usePlayers } from "@/app/players/PlayersContext";
import { useGames } from "@/app/gamesContext";
import { useMatches } from "@/app/matches/MatchesContext";
import { useMe } from "@/app/meContext";
import { addMatchPromise } from "@/app/api";
import { PlayerMultiSelect } from "@/components/player-multi-select";
import { GameCombobox } from "@/components/game-combobox";
import { AuthWarning } from "@/components/auth-warning";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { VictoryPoints } from "./victory-points";
import { ScoringBadge } from "./scoring-badge";
import {
    ScienceIcon, MaterialsIcon, IndustryIcon, ExplorationIcon, MilitaryIcon,
    GeneralToken, FinancierToken, CultureToken,
} from "./iaww-icons";

// ─── Row definitions ──────────────────────────────────────────────────────────

type RowDef =
    | { id: string; kind: "direct" }
    | { id: string; kind: "single"; icon: React.ReactNode }
    | { id: string; kind: "pair"; coeff: number; icon: React.ReactNode; icon2: React.ReactNode };

const S = "1.8em";

const ROWS: RowDef[] = [
    { id: "direct", kind: "direct" },
    { id: "industry",    kind: "single", icon: <IndustryIcon size={S} /> },
    { id: "military",    kind: "single", icon: <MilitaryIcon size={S} /> },
    { id: "science",     kind: "single", icon: <ScienceIcon size={S} /> },
    { id: "exploration", kind: "single", icon: <ExplorationIcon size={S} /> },
    { id: "materials",   kind: "single", icon: <MaterialsIcon size={S} /> },
    { id: "financier",   kind: "single", icon: <FinancierToken size={S} /> },
    { id: "general",     kind: "single", icon: <GeneralToken size={S} /> },
    { id: "culture",     kind: "single", icon: <CultureToken size={S} /> },
    // Pairs with fixed score-per-set multipliers
    { id: "ind-sci",  coeff:  6, kind: "pair", icon: <IndustryIcon size={S} />,   icon2: <ScienceIcon size={S} /> },
    { id: "sci-mat",  coeff: 10, kind: "pair", icon: <ScienceIcon size={S} />,    icon2: <MaterialsIcon size={S} /> },
    { id: "ind-exp",  coeff:  7, kind: "pair", icon: <IndustryIcon size={S} />,   icon2: <ExplorationIcon size={S} /> },
    { id: "mil-exp",  coeff:  8, kind: "pair", icon: <MilitaryIcon size={S} />,   icon2: <ExplorationIcon size={S} /> },
    { id: "sci-exp",  coeff:  9, kind: "pair", icon: <ScienceIcon size={S} />,    icon2: <ExplorationIcon size={S} /> },
    { id: "exp-mat",  coeff: 12, kind: "pair", icon: <ExplorationIcon size={S} />,icon2: <MaterialsIcon size={S} /> },
    { id: "mil-sci",  coeff:  6, kind: "pair", icon: <MilitaryIcon size={S} />,   icon2: <ScienceIcon size={S} /> },
    { id: "ind-mil",  coeff:  6, kind: "pair", icon: <IndustryIcon size={S} />,   icon2: <MilitaryIcon size={S} /> },
    { id: "fin-gen",  coeff:  6, kind: "pair", icon: <FinancierToken size={S} />, icon2: <GeneralToken size={S} /> },
    { id: "mat-fin",  coeff:  6, kind: "pair", icon: <MaterialsIcon size={S} />,  icon2: <FinancierToken size={S} /> },
    { id: "mil-fin",  coeff:  6, kind: "pair", icon: <MilitaryIcon size={S} />,   icon2: <FinancierToken size={S} /> },
    { id: "exp-gen",  coeff:  6, kind: "pair", icon: <ExplorationIcon size={S} />,icon2: <GeneralToken size={S} /> },
    { id: "ind-gen",  coeff:  5, kind: "pair", icon: <IndustryIcon size={S} />,   icon2: <GeneralToken size={S} /> },
];

// ─── State ────────────────────────────────────────────────────────────────────

const LS_KEY = "iaww/state";

type CellValue = { coeff: number; count: number };

type GameState = {
    phase: "setup" | "scoring";
    players: { id: string; name: string }[];
    directVP: Record<string, number>;
    multipliers: Record<string, Record<string, CellValue>>;
    fallbackGameId?: string;
};

const INITIAL: GameState = {
    phase: "setup",
    players: [],
    directVP: {},
    multipliers: {},
};

function cellVP(cell?: CellValue): number {
    if (!cell) return 0;
    return (cell.coeff || 0) * (cell.count || 0);
}

function playerTotal(state: GameState, playerId: string): number {
    const direct = state.directVP[playerId] || 0;
    return ROWS
        .filter((r): r is RowDef & { kind: "single" | "pair" } => r.kind !== "direct")
        .reduce((sum, row) => sum + cellVP(state.multipliers[row.id]?.[playerId]), direct);
}

// ─── Edit dialog ──────────────────────────────────────────────────────────────

type EditTarget =
    | { kind: "direct"; playerId: string }
    | { kind: "multiplier"; rowId: string; playerId: string };

function EditDialog({
    target,
    state,
    onClose,
    onSave,
}: {
    target: EditTarget | null;
    state: GameState;
    onClose: () => void;
    onSave: (target: EditTarget, value: number | CellValue) => void;
}) {
    const row = target?.kind === "multiplier" ? ROWS.find(r => r.id === target.rowId) : null;
    const player = target ? state.players.find(p => p.id === target.playerId) : null;

    const currentDirect = target?.kind === "direct" ? (state.directVP[target.playerId] || 0) : 0;
    const currentCell = target?.kind === "multiplier"
        ? state.multipliers[target.rowId]?.[target.playerId]
        : undefined;

    const [directVal, setDirectVal] = useState(String(currentDirect || ""));
    const [coeff, setCoeff] = useState(String(currentCell?.coeff || ""));
    const [count, setCount] = useState(String(currentCell?.count || ""));

    React.useEffect(() => {
        if (!target) return;
        if (target.kind === "direct") {
            const v = state.directVP[target.playerId] || 0;
            setDirectVal(v ? String(v) : "");
        } else {
            const c = state.multipliers[target.rowId]?.[target.playerId];
            setCoeff(c?.coeff ? String(c.coeff) : "");
            setCount(c?.count ? String(c.count) : "");
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target]);

    if (!target || !player) return null;

    const isDirect = target.kind === "direct";
    const isPair = row?.kind === "pair";
    const canSave = isDirect
        ? directVal !== "" && parseInt(directVal) > 0
        : isPair
            ? count !== "" && parseInt(count) > 0
            : coeff !== "" && count !== "" && parseInt(coeff) > 0 && parseInt(count) > 0;

    // Allow only digits; blocks e, +, -, . that browsers allow in type="number"
    function onlyDigits(e: React.KeyboardEvent) {
        if (e.key === "Enter") { handleSave(); return; }
        if (e.key.length === 1 && !/\d/.test(e.key)) e.preventDefault();
    }

    function handleSave() {
        if (!target) return;
        if (isDirect) {
            onSave(target, parseInt(directVal) || 0);
        } else if (isPair && row?.kind === "pair") {
            onSave(target, { coeff: row.coeff, count: parseInt(count) || 0 });
        } else {
            onSave(target, { coeff: parseInt(coeff) || 0, count: parseInt(count) || 0 });
        }
        onClose();
    }

    function handleClear() {
        if (!target) return;
        if (isDirect) {
            onSave(target, 0);
        } else {
            onSave(target, { coeff: 0, count: 0 });
        }
        onClose();
    }

    return (
        <Dialog open={!!target} onOpenChange={v => !v && onClose()}>
            <DialogContent className="max-w-xs">
                <DialogHeader>
                    <DialogTitle>{player.name}</DialogTitle>
                </DialogHeader>

                {/* Row icon(s) */}
                <div className="flex items-center justify-center gap-2 py-1">
                    {isDirect
                        ? <VictoryPoints hideValue />
                        : row?.kind === "pair"
                            ? <ScoringBadge vp={row.coeff} icon={row.icon} icon2={row.icon2} />
                            : row?.kind === "single"
                                ? row.icon
                                : null
                    }
                </div>

                <div className="space-y-4">
                    {isDirect ? (
                        <div>
                            <label className="text-sm font-medium block mb-1">Победные очки</label>
                            <input
                                type="number" min="0" autoFocus
                                value={directVal}
                                onChange={e => setDirectVal(e.target.value.replace(/\D/g, ""))}
                                onKeyDown={onlyDigits}
                                className="w-full border rounded px-3 py-2 text-xl text-center bg-background"
                                inputMode="numeric"
                            />
                        </div>
                    ) : isPair ? (
                        <div>
                            <label className="text-sm font-medium block mb-1">Количество сетов</label>
                            <input
                                type="number" min="0" autoFocus
                                value={count}
                                onChange={e => setCount(e.target.value.replace(/\D/g, ""))}
                                onKeyDown={onlyDigits}
                                className="w-full border rounded px-3 py-2 text-xl text-center bg-background"
                                inputMode="numeric"
                            />
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-sm font-medium block mb-1">ПО за сет</label>
                                <input
                                    type="number" min="0" autoFocus
                                    value={coeff}
                                    onChange={e => setCoeff(e.target.value.replace(/\D/g, ""))}
                                    onKeyDown={onlyDigits}
                                    className="w-full border rounded px-2 py-2 text-xl text-center bg-background"
                                    inputMode="numeric"
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium block mb-1">Кол-во сетов</label>
                                <input
                                    type="number" min="0"
                                    value={count}
                                    onChange={e => setCount(e.target.value.replace(/\D/g, ""))}
                                    onKeyDown={onlyDigits}
                                    className="w-full border rounded px-2 py-2 text-xl text-center bg-background"
                                    inputMode="numeric"
                                />
                            </div>
                        </div>
                    )}


                    <div className="flex gap-2">
                        <Button variant="outline" className="flex-1" onClick={handleClear}>
                            Очистить
                        </Button>
                        <Button className="flex-1" onClick={handleSave} disabled={!canSave}>
                            Сохранить
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ─── Scoring table ────────────────────────────────────────────────────────────

function ScoringTable({
    state,
    onEdit,
}: {
    state: GameState;
    onEdit: (target: EditTarget) => void;
}) {
    return (
        <div className="overflow-x-auto">
            <table className="border-collapse text-sm">
                <thead>
                    <tr>
                        {/* Empty corner */}
                        <th className="sticky left-0 z-20 bg-background border border-border p-1 min-w-[3.5rem] sm:min-w-[5rem]" />
                        {state.players.map(p => (
                            <th key={p.id}
                                className="border border-border px-1 py-1 min-w-[4.5rem] sm:min-w-[6rem] text-center bg-muted">
                                <span className="block truncate max-w-[4rem] sm:max-w-[5.5rem] mx-auto text-xs sm:text-sm">
                                    {p.name}
                                </span>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {ROWS.map((row, rowIdx) => (
                        <tr key={row.id} className={rowIdx % 2 === 0 ? "" : "bg-muted/30"}>
                            {/* Row label */}
                            <td className="sticky left-0 z-10 bg-background border border-border p-1 text-center"
                                style={{ backgroundColor: rowIdx % 2 === 0 ? undefined : "hsl(var(--muted)/0.3)" }}>
                                {row.kind === "direct"
                                    ? <VictoryPoints hideValue />
                                    : row.kind === "pair"
                                        ? <ScoringBadge vp={row.coeff} icon={row.icon} icon2={row.icon2} />
                                        : row.icon
                                }
                            </td>

                            {/* Player cells */}
                            {state.players.map(player => {
                                let vp = 0;
                                let label: React.ReactNode = null;

                                if (row.kind === "direct") {
                                    vp = state.directVP[player.id] || 0;
                                    if (vp > 0) label = <VictoryPoints value={vp} />;
                                } else {
                                    const cell = state.multipliers[row.id]?.[player.id];
                                    vp = cellVP(cell);
                                    if (vp > 0 && cell) {
                                        label = (
                                            <div className="flex flex-col items-center gap-0.5">
                                                <span className="text-xs text-muted-foreground leading-none">
                                                    {cell.coeff}×{cell.count}
                                                </span>
                                                <VictoryPoints value={vp} />
                                            </div>
                                        );
                                    }
                                }

                                const target: EditTarget = row.kind === "direct"
                                    ? { kind: "direct", playerId: player.id }
                                    : { kind: "multiplier", rowId: row.id, playerId: player.id };

                                return (
                                    <td key={player.id}
                                        className="border border-border p-1 text-center cursor-pointer hover:bg-accent transition-colors min-w-[4.5rem] sm:min-w-[6rem]"
                                        onClick={() => onEdit(target)}>
                                        {label}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}

                    {/* Total row */}
                    <tr className="bg-muted/60 font-bold">
                        <td className="sticky left-0 z-10 bg-muted/60 border border-border p-1 text-center text-xs">
                            Итого
                        </td>
                        {state.players.map(player => {
                            const total = playerTotal(state, player.id);
                            return (
                                <td key={player.id} className="border border-border p-1 text-center">
                                    {total > 0
                                        ? <VictoryPoints value={total} />
                                        : <span className="text-muted-foreground">—</span>
                                    }
                                </td>
                            );
                        })}
                    </tr>
                </tbody>
            </table>
        </div>
    );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ItsAWonderfulWorldPage() {
    const { players: allPlayers, playerDisplayName } = usePlayers();
    const { games } = useGames();
    const me = useMe();
    const { invalidate: invalidateMatches } = useMatches();
    const { invalidate: invalidatePlayers } = usePlayers();
    const router = useRouter();

    const [gameState, setGameState] = useLocalStorage<GameState>(LS_KEY, INITIAL);
    const [setupPlayerIds, setSetupPlayerIds] = useState<string[]>(
        gameState.players.map(p => p.id)
    );
    const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState("");

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

    // ── Setup phase ───────────────────────────────────────────────────────────

    if (gameState.phase === "setup") {
        return (
            <main className="max-w-sm mx-auto p-4 space-y-4">
                <h1 className="text-2xl font-bold">Этот Безумный Мир</h1>
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
            <div className="flex items-center justify-between gap-2">
                <h1 className="text-xl sm:text-2xl font-bold">Этот Безумный Мир</h1>
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
            </div>

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
