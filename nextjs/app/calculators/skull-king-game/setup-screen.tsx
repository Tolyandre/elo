"use client";
import type { Base58ID } from "@/lib/id";

import React, { useState } from "react";
import { Player as PlayerType, SkullKingTableSummary } from "@/app/api";
import { PlayerMultiSelect } from "@/components/player-multi-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown, ChevronUp, GripVertical, Loader2, Users } from "lucide-react";

type Props = {
    me: { isAuthenticated: boolean; playerId: Base58ID | undefined };
    players: PlayerType[];
    playerDisplayName: (player: PlayerType) => string;
    activeTables: SkullKingTableSummary[];
    tablesLoading: boolean;
    joiningTableId: Base58ID | null;
    onJoin: (table: SkullKingTableSummary) => void;
    setupPlayerIds: Base58ID[];
    onSetupPlayerIdsChange: (ids: Base58ID[]) => void;
    isSubmitting: boolean;
    onStart: () => void;
};

/**
 * Setup screen: the "Активные столы" lobby (join a live table as a connected
 * player) and the local "Новая партия" card (pick and order players, then
 * host a new game). Player ordering (drag + buttons) is local to this
 * component; only the resulting id list crosses the boundary.
 */
export function SetupScreen({
    me,
    players,
    playerDisplayName,
    activeTables,
    tablesLoading,
    joiningTableId,
    onJoin,
    setupPlayerIds,
    onSetupPlayerIdsChange,
    isSubmitting,
    onStart,
}: Props) {
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
        onSetupPlayerIdsChange(newIds);
        dragIndexRef.current = null;
        setDragOverIndex(null);
    }

    function handleDragEnd() {
        dragIndexRef.current = null;
        setDragOverIndex(null);
    }

    function movePlayer(index: number, delta: number) {
        const target = index + delta;
        if (target < 0 || target > setupPlayerIds.length - 1) return;
        const newIds = [...setupPlayerIds];
        [newIds[index], newIds[target]] = [newIds[target], newIds[index]];
        onSetupPlayerIdsChange(newIds);
    }

    return (
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
                                            onClick={() => onJoin(table)}
                                            title={!canJoin ? "Для входа нужна авторизация и привязка к игроку" : undefined}
                                        >
                                            {joiningTableId === table.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Войти"}
                                        </Button>
                                    </div>
                                );
                            })}
                            {!me.isAuthenticated && (
                                <div className="flex flex-col items-start gap-2">
                                    <p className="text-xs text-muted-foreground">Войдите в аккаунт и привяжите игрока, чтобы присоединиться к столу</p>
                                </div>
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
                        onChange={onSetupPlayerIdsChange}
                    />

                    {setupPlayerIds.length > 0 && (
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-muted-foreground">Порядок:</p>
                            {setupPlayerIds.map((id, index) => {
                                const player = players.find((p) => p.id === id);
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
                                            onClick={() => movePlayer(index, -1)}
                                        >
                                            <ChevronUp className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={index === setupPlayerIds.length - 1}
                                            onClick={() => movePlayer(index, 1)}
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
                        disabled={setupPlayerIds.length < 2 || isSubmitting}
                        onClick={onStart}
                    >
                        {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Начать игру"}
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
