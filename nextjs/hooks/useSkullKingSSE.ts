"use client";

import { useEffect, useRef, useState } from "react";
import {
    EloWebServiceBaseUrl,
    getSkullKingTablePromise,
    listSkullKingTablesPromise,
    SkullKingTableSummary,
} from "@/app/api";

export type SkullKingSSE = {
    table: SkullKingTableSummary | null;
    /** Set when the host saves the match — connected players redirect to it. */
    savedMatchId: string | null;
};

// Heartbeat interval must match the backend (skull_king_tables.go) so that if we
// stop receiving *any* bytes — including comment frames — within this window, we
// treat the stream as dead and force a reconnect. Kept a bit above the server's
// 15s tick to allow for latency without false positives.
const SSE_LIVENESS_TIMEOUT_MS = 45_000;

/**
 * Subscribes to a Skull King table over SSE and keeps the local view in sync.
 *
 * Beyond the initial connect, this hook self-heals three common dropout
 * scenarios that the browser's built-in EventSource reconnect does NOT cover:
 *
 *   1. Silent connection death (VPN/NAT reaping an idle stream). The backend
 *      sends a 15s heartbeat comment frame; if we receive nothing at all for
 *      SSE_LIVENESS_TIMEOUT_MS, we close and recreate the EventSource.
 *   2. Reconnect after an error — on every (re)open we refetch the full table
 *      so a client that missed broadcasts while disconnected catches up.
 *   3. Tab regained visibility / navigator came back online — same refetch.
 */
export function useSkullKingSSE(tableId: string | null): SkullKingSSE {
    const [state, setState] = useState<SkullKingTableSummary | null>(null);
    const [savedMatchId, setSavedMatchId] = useState<string | null>(null);
    // Whether we've seen at least one error since the last successful open.
    // Used to avoid refetching on the very first (clean) connect.
    const erroredSinceOpenRef = useRef(false);

    useEffect(() => {
        if (!tableId) return;

        let es: EventSource | null = null;
        let livenessTimer: ReturnType<typeof setTimeout> | null = null;
        let closedByUs = false;

        const refetchState = () => {
            getSkullKingTablePromise(tableId)
                .then(setState)
                .catch(() => {
                    // table may have been deleted; leave current state in place
                });
        };

        const armLivenessTimer = () => {
            if (livenessTimer) clearTimeout(livenessTimer);
            livenessTimer = setTimeout(() => {
                // No bytes received (not even a heartbeat) — the stream is
                // silently dead. Force a fresh EventSource; onopen will refetch.
                es?.close();
                if (closedByUs) return;
                es = createEventSource();
            }, SSE_LIVENESS_TIMEOUT_MS);
        };

        const handleVisibilityOrOnline = () => {
            if (document.visibilityState === "visible") {
                // Refetch to catch up on anything missed while backgrounded; the
                // SSE connection (if still alive) will keep streaming after.
                refetchState();
            }
        };

        const createEventSource = () => {
            const source = new EventSource(
                `${EloWebServiceBaseUrl}/skull-king/tables/${tableId}/events`,
                { withCredentials: true }
            );

            const resetLiveness = () => armLivenessTimer();

            // Any message — state, saved, or even a comment frame reaching
            // onmessage — proves the connection is alive.
            source.onmessage = (event) => {
                resetLiveness();
                try {
                    const parsed = JSON.parse(event.data);
                    if (parsed.type === "state" && parsed.data) {
                        setState(parsed.data);
                    } else if (parsed.type === "saved" && parsed.data?.match_id) {
                        setSavedMatchId(parsed.data.match_id as string);
                    }
                } catch {
                    // ignore malformed events
                }
            };

            source.onopen = () => {
                resetLiveness();
                // On reconnect (not the first clean open), refetch to recover
                // any events missed while the connection was down.
                if (erroredSinceOpenRef.current) {
                    erroredSinceOpenRef.current = false;
                    refetchState();
                }
            };

            source.onerror = () => {
                erroredSinceOpenRef.current = true;
                // EventSource auto-reconnects; nothing to do here. The liveness
                // timer will force a recreate if it stalls for too long.
            };

            return source;
        };

        armLivenessTimer();
        es = createEventSource();
        document.addEventListener("visibilitychange", handleVisibilityOrOnline);
        window.addEventListener("online", handleVisibilityOrOnline);

        return () => {
            closedByUs = true;
            if (livenessTimer) clearTimeout(livenessTimer);
            es?.close();
            document.removeEventListener("visibilitychange", handleVisibilityOrOnline);
            window.removeEventListener("online", handleVisibilityOrOnline);
        };
    }, [tableId]);

    return { table: state, savedMatchId };
}

/**
 * Subscribes to the Skull King lobby SSE channel while `enabled`.
 * Returns a tick counter that increments on every "tables-changed" signal,
 * so callers can refetch the table list by depending on it.
 *
 * Carries the same self-healing as useSkullKingSSE: heartbeat-driven liveness
 * and recovery on reconnect/visibility/online.
 */
export function useSkullKingLobbySSE(enabled: boolean): number {
    const [tick, setTick] = useState(0);

    useEffect(() => {
        if (!enabled) return;

        let es: EventSource | null = null;
        let livenessTimer: ReturnType<typeof setTimeout> | null = null;
        let closedByUs = false;
        const erroredSinceOpenRef = { current: false };

        const refetchList = () => {
            listSkullKingTablesPromise()
                .then(() => setTick((t) => t + 1))
                .catch(() => {
                    // ignore — the SSE stream will signal again on next change
                });
        };

        const armLivenessTimer = () => {
            if (livenessTimer) clearTimeout(livenessTimer);
            livenessTimer = setTimeout(() => {
                es?.close();
                if (closedByUs) return;
                es = createEventSource();
            }, SSE_LIVENESS_TIMEOUT_MS);
        };

        const handleVisibilityOrOnline = () => {
            if (document.visibilityState === "visible") {
                refetchList();
            }
        };

        const createEventSource = () => {
            const source = new EventSource(
                `${EloWebServiceBaseUrl}/skull-king/lobby/events`,
                { withCredentials: true }
            );

            const resetLiveness = () => armLivenessTimer();

            source.onmessage = (event) => {
                resetLiveness();
                try {
                    const parsed = JSON.parse(event.data);
                    if (parsed.type === "tables-changed") {
                        setTick((t) => t + 1);
                    }
                } catch {
                    // ignore malformed events
                }
            };

            source.onopen = () => {
                resetLiveness();
                if (erroredSinceOpenRef.current) {
                    erroredSinceOpenRef.current = false;
                    refetchList();
                }
            };

            source.onerror = () => {
                erroredSinceOpenRef.current = true;
            };

            return source;
        };

        armLivenessTimer();
        es = createEventSource();
        document.addEventListener("visibilitychange", handleVisibilityOrOnline);
        window.addEventListener("online", handleVisibilityOrOnline);

        return () => {
            closedByUs = true;
            if (livenessTimer) clearTimeout(livenessTimer);
            es?.close();
            document.removeEventListener("visibilitychange", handleVisibilityOrOnline);
            window.removeEventListener("online", handleVisibilityOrOnline);
        };
    }, [enabled]);

    return tick;
}
