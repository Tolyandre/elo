"use client";

import React, { forwardRef, useImperativeHandle, useState } from "react";
import { createPlayerPromise, addClubMemberPromise, isNetworkFailure } from "@/app/api";
import { usePlayers } from "@/app/players/PlayersContext";
import { useClubs } from "@/app/clubsContext";
import { useMe } from "@/app/meContext";
import { useOffline } from "@/app/offline/OfflineContext";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ClubIcon } from "@/components/club-icon";
import { cn } from "@/lib/utils";

/**
 * Result of a create attempt. `created` is true once the player exists on the
 * server OR is queued offline (in which case the final id is the clientId).
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
 * Clubs are applied after the player exists via POST /clubs/{id}/members. When
 * offline, both the player and the chosen club ids are queued and applied
 * together during sync (the player's clientId is its final server id, and
 * AddClubMember is idempotent, so retries are safe).
 */
export type AddPlayerFormHandle = {
    /** Run the create flow. Resolves once the player is created or queued. */
    submit: () => Promise<AddPlayerResult>;
    /** Whether a create is currently in flight. */
    isBusy: () => boolean;
};

export const AddPlayerForm = forwardRef<AddPlayerFormHandle, {
    /** Called once the player is created (online or queued offline). */
    onCreated?: (playerId: string, name: string) => void;
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
    const { invalidate: invalidatePlayers } = usePlayers();
    const { clubs, clubDisplayName, invalidate: invalidateClubs } = useClubs();
    const { canEdit } = useMe();
    const { offline, addPendingPlayer } = useOffline();

    const [name, setName] = useState(initialName);
    const [selectedClubs, setSelectedClubs] = useState<Set<string>>(new Set());
    const [adding, setAdding] = useState(false);

    const sortedClubs = React.useMemo(
        () => [...clubs].sort((a, b) =>
            clubDisplayName(a).localeCompare(clubDisplayName(b), undefined, { sensitivity: "base" })
        ),
        [clubs, clubDisplayName],
    );

    function toggleClub(clubId: string) {
        setSelectedClubs((prev) => {
            const next = new Set(prev);
            if (next.has(clubId)) next.delete(clubId);
            else next.add(clubId);
            return next;
        });
    }

    async function submit(): Promise<AddPlayerResult> {
        const trimmed = name.trim();
        if (adding || !trimmed) return { created: false };
        const clubIds = [...selectedClubs];

        if (offline) {
            const player = addPendingPlayer(trimmed, clubIds);
            setName("");
            setSelectedClubs(new Set());
            onCreated?.(player.clientId, trimmed);
            return { created: true, id: player.clientId, name: trimmed };
        }

        setAdding(true);
        try {
            const created = await createPlayerPromise({ name: trimmed });
            // Apply club memberships after the player exists. Best-effort: a
            // failure on one club surfaces a toast but doesn't roll back the
            // player (created successfully). Memberships can be fixed up later
            // from the admin club page.
            for (const clubId of clubIds) {
                try {
                    await addClubMemberPromise(clubId, created.id);
                } catch {
                    // toast already shown by the API helper
                }
            }
            invalidatePlayers();
            invalidateClubs();
            setName("");
            setSelectedClubs(new Set());
            onCreated?.(created.id, created.name);
            return { created: true, id: created.id, name: created.name };
        } catch (e) {
            if (isNetworkFailure(e)) {
                // network died mid-request — queue offline instead, preserving
                // the chosen clubs so they're applied on sync.
                const player = addPendingPlayer(trimmed, clubIds);
                invalidatePlayers();
                setName("");
                setSelectedClubs(new Set());
                onCreated?.(player.clientId, trimmed);
                return { created: true, id: player.clientId, name: trimmed };
            }
            // HTTP errors: toast already shown by the API helper
            return { created: false };
        } finally {
            setAdding(false);
        }
    }

    // Rebind every render so the exposed `submit` always closes over the latest
    // name/clubs state (the dialog's confirm button calls it via the ref).
    useImperativeHandle(ref, () => ({
        submit,
        isBusy: () => adding,
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
                            disabled={!canEdit || adding || !name.trim()}
                            aria-busy={adding}
                        >
                            {adding && <Spinner className="size-4" />}
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
