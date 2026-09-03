"use client";
import type { Base58ID } from "@/lib/id";

import React, { forwardRef, useImperativeHandle, useState } from "react";
import { useClubs } from "@/app/clubsContext";
import { useMe } from "@/app/meContext";
import { useOffline } from "@/app/offline/OfflineContext";
import { Button } from "@/components/ui/button";
import { ClubIcon } from "@/components/club-icon";
import { cn } from "@/lib/utils";

/**
 * Result of a create attempt. `created` is true once the player is queued (its
 * final id is the pending entry's clientId; the sync pushes it to the server).
 */
export type AddPlayerResult = { created: true; id: string; name: string } | { created: false };

/**
 * Shared "create a player" form: a name field plus toggleable club chips.
 *
 * Used in two layouts:
 *  - standalone (admin inline row): renders its own submit button.
 *  - embedded inside a confirmation dialog: `hideSubmit` hides the button and
 *    the parent drives submission via the imperative `submit()` handle.
 *
 * Creates always queue — the pending player's clientId is its final server id
 * — together with the chosen club ids; the sync engine applies the memberships
 * right after the create (AddClubMember is idempotent, so retries are safe).
 */
export type AddPlayerFormHandle = {
    /** Run the create flow. Resolves once the player is created or queued. */
    submit: () => Promise<AddPlayerResult>;
    /** Whether a create is currently in flight. */
    isBusy: () => boolean;
};

export const AddPlayerForm = forwardRef<AddPlayerFormHandle, {
    /** Called once the player is created (online or queued offline). */
    onCreated?: (playerId: Base58ID, name: string) => void;
    /** Compact layout for use inside a dropdown/bottom-sheet. */
    compact?: boolean;
    /** Hide the built-in submit button (parent drives submit via the ref). */
    hideSubmit?: boolean;
    submitLabel?: string;
    /** Pre-fill the name field (e.g. from the picker's current search text). */
    initialName?: string;
    /** Autofocus the name input on mount. */
    autoFocus?: boolean;
}>(function AddPlayerForm(
    { onCreated, compact = false, hideSubmit = false, submitLabel, initialName = "", autoFocus = false },
    ref,
) {
    const { clubs, clubDisplayName } = useClubs();
    const { canEdit } = useMe();
    const { offline, addPendingPlayer } = useOffline();

    const [name, setName] = useState(initialName);
    const [selectedClubs, setSelectedClubs] = useState<Set<Base58ID>>(new Set());

    const sortedClubs = React.useMemo(
        () => [...clubs].sort((a, b) =>
            clubDisplayName(a).localeCompare(clubDisplayName(b), undefined, { sensitivity: "base" })
        ),
        [clubs, clubDisplayName],
    );

    function toggleClub(clubId: Base58ID) {
        setSelectedClubs((prev) => {
            const next = new Set(prev);
            if (next.has(clubId)) next.delete(clubId);
            else next.add(clubId);
            return next;
        });
    }

    async function submit(): Promise<AddPlayerResult> {
        const trimmed = name.trim();
        if (!trimmed) return { created: false };

        // Creates always queue: the pending player's clientId is its final
        // server id, so a lost response or retry can never mint a second id
        // and end up stuck behind the unique-name index. The chosen clubs are
        // queued with it and applied by the sync engine right after the create.
        const player = addPendingPlayer(trimmed, [...selectedClubs]);
        setName("");
        setSelectedClubs(new Set());
        onCreated?.(player.clientId, trimmed);
        return { created: true, id: player.clientId, name: trimmed };
    }

    // Rebind every render so the exposed `submit` always closes over the latest
    // name/clubs state (the dialog's confirm button calls it via the ref).
    useImperativeHandle(ref, () => ({
        submit,
        isBusy: () => false,
    }));

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            submit();
        }
    };

    return (
        <div className={cn("flex flex-col gap-2", compact ? "" : "sm:flex-row sm:items-stretch sm:gap-2")}>
            <div className={cn("flex", compact ? "flex-col gap-2" : "flex-col sm:flex-row sm:items-center")}>
                <input
                    className="border rounded p-2 flex-1 min-w-0"
                    placeholder="Имя игрока"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    autoFocus={autoFocus}
                    aria-label="Имя нового игрока"
                />
                {!hideSubmit && (
                    <div className={compact ? "" : "sm:w-auto"}>
                        <Button
                            type="button"
                            onClick={() => submit()}
                            disabled={!canEdit || !name.trim()}
                        >
                            {offline ? "Добавить офлайн" : (submitLabel ?? "Добавить")}
                        </Button>
                    </div>
                )}
            </div>

            {sortedClubs.length > 0 && (
                <div className="flex flex-wrap gap-1 items-center">
                    {sortedClubs.map((club) => {
                        const selected = selectedClubs.has(club.id);
                        return (
                            <button
                                key={club.id}
                                type="button"
                                onClick={() => toggleClub(club.id)}
                                disabled={!canEdit}
                                className={cn(
                                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                                    selected
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-border bg-transparent text-muted-foreground hover:bg-accent",
                                    !canEdit && "opacity-50 cursor-not-allowed",
                                )}
                                aria-pressed={selected}
                            >
                                <ClubIcon club={club} />
                                {clubDisplayName(club)}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
});
