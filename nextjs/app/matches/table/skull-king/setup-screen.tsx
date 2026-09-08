"use client";
import type { Base58ID } from "@/lib/id";

import React, { useState } from "react";
import { Player as PlayerType } from "@/app/api";
import { PlayerMultiSelect } from "@/components/player-multi-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown, ChevronUp, GripVertical, Loader2 } from "lucide-react";

type Props = {
    players: PlayerType[];
    playerDisplayName: (player: PlayerType) => string;
    /** Authenticated with a linked player — required to host a table. */
    canCreate: boolean;
    setupPlayerIds: Base58ID[];
    onSetupPlayerIdsChange: (ids: Base58ID[]) => void;
    isSubmitting: boolean;
    onStart: () => void;
};

/**
 * The "Новая партия" card: pick and order players, then host a new table.
 * Joining existing tables happens on /matches (the running-tables list);
 * player ordering (drag + buttons) is local to this component.
 */
export function SetupScreen({
    players,
    playerDisplayName,
    canCreate,
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
                    disabled={setupPlayerIds.length < 2 || isSubmitting || !canCreate}
                    onClick={onStart}
                    title={!canCreate
                        ? "Для создания стола нужна авторизация и привязка к игроку"
                        : undefined}
                >
                    {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Начать игру"}
                </Button>
            </CardContent>
        </Card>
    );
}
