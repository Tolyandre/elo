"use client";
import type { Base58ID } from "@/lib/id";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";

type Props = {
    /** Participants in their current order (the order the game starts with). */
    playerIds: Base58ID[];
    onChange: (ids: Base58ID[]) => void;
    /** Display name for a participant id (falls back to the id itself). */
    resolveName: (id: Base58ID) => string;
};

/**
 * The ordered participant list under the player picker: drag a row (native
 * HTML5 DnD) or use the chevron buttons to change the seating order — the
 * order the game starts with (per-game meaning: first bidder, column order).
 */
export function PlayerOrderList({ playerIds, onChange, resolveName }: Props) {
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
        const newIds = [...playerIds];
        const [moved] = newIds.splice(from, 1);
        newIds.splice(index, 0, moved);
        onChange(newIds);
        dragIndexRef.current = null;
        setDragOverIndex(null);
    }

    function handleDragEnd() {
        dragIndexRef.current = null;
        setDragOverIndex(null);
    }

    function movePlayer(index: number, delta: number) {
        const target = index + delta;
        if (target < 0 || target > playerIds.length - 1) return;
        const newIds = [...playerIds];
        [newIds[index], newIds[target]] = [newIds[target], newIds[index]];
        onChange(newIds);
    }

    return (
        <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Порядок:</p>
            {playerIds.map((id, index) => {
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
                        <span className="flex-1 text-sm">{index + 1}. {resolveName(id)}</span>
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
                            disabled={index === playerIds.length - 1}
                            onClick={() => movePlayer(index, 1)}
                        >
                            <ChevronDown className="h-4 w-4" />
                        </Button>
                    </div>
                );
            })}
        </div>
    );
}
