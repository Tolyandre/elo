"use client";
import type { PendingConflictField } from "@/lib/offline/types";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SplitSquareHorizontal } from "lucide-react";

/**
 * Field-level conflict resolution for one queued item (ADR-37): each row shows
 * what this device queued (`ours`) against what the server holds (`theirs`)
 * with keep-mine / take-theirs buttons. The queue page renders this — sync
 * never opens merge dialogs mid-UX; the user comes here when ready.
 */
export function ConflictPanel({
    fields,
    onResolve,
    disabled = false,
}: {
    fields: PendingConflictField[];
    /** Called once per decided field with `{ [field]: chosenRawValue }`. */
    onResolve: (resolutions: Record<string, string>) => void;
    disabled?: boolean;
}) {
    if (fields.length === 0) return null;

    return (
        <div className="mt-2 space-y-2">
            {fields.map((f) => (
                <div
                    key={f.field}
                    className="rounded-md border border-warning/40 bg-warning/5 p-3 space-y-2"
                >
                    <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline">
                            <SplitSquareHorizontal />
                            {f.label}
                        </Badge>
                        <span className="text-sm">
                            <span className="text-muted-foreground">здесь: </span>
                            <span className="font-medium">{f.ours}</span>
                            <span className="text-muted-foreground"> · на сервере: </span>
                            <span className="font-medium">{f.theirs}</span>
                        </span>
                    </div>
                    <div className="flex gap-2">
                        <Button
                            variant="secondary"
                            size="xs"
                            disabled={disabled}
                            onClick={() => onResolve({ [f.field]: f.ours })}
                        >
                            Оставить моё
                        </Button>
                        <Button
                            variant="secondary"
                            size="xs"
                            disabled={disabled}
                            onClick={() => onResolve({ [f.field]: f.theirs })}
                        >
                            Взять с сервера
                        </Button>
                    </div>
                </div>
            ))}
        </div>
    );
}
