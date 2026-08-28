"use client";
import type { Base58ID } from "@/lib/id";

import { useCallback, useState } from "react";
import {
    EloWebServiceBaseUrl,
    getSkullKingTablePromise,
    SkullKingTableSummary,
} from "@/app/api";
import { useSSE } from "@/hooks/useSSE";

export type SkullKingSSE = {
    table: SkullKingTableSummary | null;
    /** Set when the host saves the match — connected players redirect to it. */
    savedMatchId: string | null;
};

/**
 * Subscribes to a Skull King table over SSE and keeps the local view in sync.
 *
 * Connection self-healing (heartbeat liveness, reopen-after-error refetch,
 * visibility/online catch-up) lives in useSSE; this hook only supplies the
 * event dispatch and the recovery refetch of the full table state.
 */
export function useSkullKingSSE(tableId: Base58ID | null): SkullKingSSE {
    const [state, setState] = useState<SkullKingTableSummary | null>(null);
    const [savedMatchId, setSavedMatchId] = useState<string | null>(null);
    // Reset when switching tables so the old table's state never bleeds over
    // (adjust-state-during-render on id change).
    const [trackedTableId, setTrackedTableId] = useState(tableId);
    if (trackedTableId !== tableId) {
        setTrackedTableId(tableId);
        setState(null);
        setSavedMatchId(null);
    }

    const onEvent = useCallback((event: { type: string; data?: unknown }) => {
        if (event.type === "state" && event.data) {
            setState(event.data as SkullKingTableSummary);
        } else if (event.type === "saved" && (event.data as { match_id?: string } | undefined)?.match_id) {
            setSavedMatchId((event.data as { match_id: string }).match_id);
        }
    }, []);

    const onRecover = useCallback(() => {
        if (!tableId) return;
        getSkullKingTablePromise(tableId)
            .then(setState)
            .catch(() => {
                // table may have been deleted; leave current state in place
            });
    }, [tableId]);

    useSSE(tableId ? `${EloWebServiceBaseUrl}/skull-king/tables/${tableId}/events` : null, {
        onEvent,
        onRecover,
    });

    return { table: state, savedMatchId };
}

/**
 * Subscribes to the Skull King lobby SSE channel while `enabled`.
 * Returns a tick counter that increments on every "tables-changed" signal,
 * so callers refetch the table list by depending on it.
 *
 * Recovery (reopen after error, tab visible again, back online) also bumps the
 * tick — the caller's effect refetches the list; no separate fetch happens here.
 */
export function useSkullKingLobbySSE(enabled: boolean): number {
    const [tick, setTick] = useState(0);

    const onEvent = useCallback((event: { type: string }) => {
        if (event.type === "tables-changed") {
            setTick((t) => t + 1);
        }
    }, []);

    const onRecover = useCallback(() => {
        setTick((t) => t + 1);
    }, []);

    useSSE(enabled ? `${EloWebServiceBaseUrl}/skull-king/lobby/events` : null, {
        onEvent,
        onRecover,
    });

    return tick;
}
