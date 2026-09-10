"use client";

import { useEffect, useRef, useState } from "react";
import { createSSEConnection, parseSSEEnvelope, type SSEEnvelope } from "@/lib/sse-connection";

export type { SSEEnvelope };

export type UseSSEOptions = {
    /** Dispatches one parsed event envelope. Malformed frames are ignored. */
    onEvent: (event: SSEEnvelope) => void;
    /**
     * The stream may have missed events — it reopened after an error or a
     * forced recreate, or the tab became visible / the navigator came back
     * online. Refetch to catch up.
     */
    onRecover?: () => void;
};

/**
 * The single SSE subscription primitive for the per-entity realtime streams
 * (a game table, a market). The app-global topics (data-change signals, both
 * lobbies, per-user events) share one multiplexed connection instead — see
 * useSSETopic.
 *
 * Returns whether the stream is currently open. While disconnected the
 * consumer's data is a frozen snapshot of the last received state — live
 * tables surface this as a "no connection" hint instead of letting the user
 * wonder why nothing moves.
 *
 * Connection self-healing (heartbeat liveness watchdog, rejected-connection
 * backoff, reopen-after-error refetch, visibility/online catch-up) lives in
 * lib/sse-connection.ts; this hook only adapts it to React.
 */
export function useSSE(url: string | null, options: UseSSEOptions): boolean {
    const [connected, setConnected] = useState(false);
    // Keep the latest handlers without resubscribing when they change identity.
    // Updated in a layout-less effect (runs after every render, before any
    // async SSE event can fire) instead of during render.
    const optionsRef = useRef(options);
    useEffect(() => {
        optionsRef.current = options;
    });

    useEffect(() => {
        if (!url) return;

        const connection = createSSEConnection(url, {
            onMessage: (payload) => {
                const parsed = parseSSEEnvelope(payload);
                if (parsed) {
                    optionsRef.current.onEvent(parsed);
                }
            },
            // Evaluated once per subscription: consumers either always pass
            // onRecover (table streams) or never do (market prices), so
            // setup-time presence matches lifetime presence.
            onRecover: optionsRef.current.onRecover
                ? () => optionsRef.current.onRecover?.()
                : undefined,
            onConnectedChange: setConnected,
        });
        return () => {
            connection.close();
        };
    }, [url]);

    return connected;
}
