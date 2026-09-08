"use client";
import type { Base58ID } from "@/lib/id";

import { useCallback, useState } from "react";
import {
    ApiError,
    EloWebServiceBaseUrl,
    getTablePromise,
    isNetworkFailure,
    TableSummary,
} from "@/app/api";
import { useSSE } from "@/hooks/useSSE";

export type TableSSE = {
    table: TableSummary | null;
    /** Set when the host saves the match — connected players redirect to it. */
    savedMatchId: string | null;
    /**
     * Set when the host tore the table down without saving. Connected
     * players clear their session and return to setup.
     */
    closed: boolean;
    /** Whether the SSE stream is currently open (the data above may be stale otherwise). */
    connected: boolean;
};

export type UseTableSSEOptions = {
    /**
     * The table could not be fetched during recovery (it was deleted — saved
     * while this client was offline, closed by the host, or expired). Fire
     * once per disappearance; consumers typically clear the session so the
     * subscription ends.
     */
    onTableGone?: () => void;
};

/**
 * Subscribes to a game table over SSE and keeps the local view in sync.
 *
 * Connection self-healing (heartbeat liveness, reopen-after-error refetch,
 * rejected-connection backoff, visibility/online catch-up) lives in useSSE;
 * this hook only supplies the event dispatch and the recovery refetch of the
 * full table state.
 */
export function useTableSSE(
    tableId: Base58ID | null,
    options?: UseTableSSEOptions,
): TableSSE {
    const [state, setState] = useState<TableSummary | null>(null);
    const [savedMatchId, setSavedMatchId] = useState<string | null>(null);
    const [closed, setClosed] = useState(false);
    const [tableGoneNotified, setTableGoneNotified] = useState(false);
    // Reset when switching tables so the old table's state never bleeds over
    // (adjust-state-during-render on id change).
    const [trackedTableId, setTrackedTableId] = useState(tableId);
    if (trackedTableId !== tableId) {
        setTrackedTableId(tableId);
        setState(null);
        setSavedMatchId(null);
        setClosed(false);
        setTableGoneNotified(false);
    }

    const onEvent = useCallback((event: { type: string; data?: unknown }) => {
        if (event.type === "state" && event.data) {
            setState(event.data as TableSummary);
        } else if (event.type === "saved" && (event.data as { match_id?: string } | undefined)?.match_id) {
            setSavedMatchId((event.data as { match_id: string }).match_id);
        } else if (event.type === "closed") {
            setClosed(true);
        }
    }, []);

    const onRecover = useCallback(() => {
        if (!tableId) return;
        getTablePromise(tableId)
            .then((table) => {
                setState(table);
                setClosed(false);
                setTableGoneNotified(false);
            })
            .catch((err: unknown) => {
                // Only a definitive 404 means the table is gone (deleted or
                // expired). A network failure — offline, backend restart — or
                // a transient 5xx must NOT kick the player out: the stream
                // keeps retrying and the UI shows the last known state.
                if (isNetworkFailure(err)) return;
                if (err instanceof ApiError && err.status !== 404) return;
                if (!tableGoneNotified) {
                    setTableGoneNotified(true);
                    options?.onTableGone?.();
                }
            });
    }, [tableId, tableGoneNotified, options]);

    const connected = useSSE(tableId ? `${EloWebServiceBaseUrl}/tables/${tableId}/events` : null, {
        onEvent,
        onRecover,
    });

    return { table: state, savedMatchId, closed, connected };
}

/**
 * Subscribes to the tables lobby SSE channel while `enabled`.
 * Returns a tick counter that increments on every "tables-changed" signal,
 * so callers refetch the table list by depending on it.
 *
 * Recovery (reopen after error, tab visible again, back online) also bumps the
 * tick — the caller's effect refetches the list; no separate fetch happens here.
 */
export function useTablesLobbySSE(enabled: boolean): number {
    const [tick, setTick] = useState(0);

    const onEvent = useCallback((event: { type: string }) => {
        if (event.type === "tables-changed") {
            setTick((t) => t + 1);
        }
    }, []);

    const onRecover = useCallback(() => {
        setTick((t) => t + 1);
    }, []);

    useSSE(enabled ? `${EloWebServiceBaseUrl}/tables/lobby/events` : null, {
        onEvent,
        onRecover,
    });

    return tick;
}
