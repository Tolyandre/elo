"use client";

import { useEffect, useRef } from "react";

// Heartbeat must match the backend (pkg/api/sse.go): if we receive no bytes —
// not even a comment frame — within this window, the stream is silently dead
// and we force a fresh EventSource. Kept above the server's 15s tick.
const SSE_LIVENESS_TIMEOUT_MS = 45_000;

/** One parsed SSE frame: {"type": "...", "data": ...}. */
export type SSEEnvelope = {
    type: string;
    data?: unknown;
};

export type UseSSEOptions = {
    /** Dispatches one parsed event envelope. Malformed frames are ignored. */
    onEvent: (event: SSEEnvelope) => void;
    /**
     * The stream may have missed events — it reopened after an error, or the
     * tab became visible / the navigator came back online. Refetch to catch
     * up. Streams whose server resends the current state on every (re)connect
     * (market prices, lobby signals) can omit this.
     */
    onRecover?: () => void;
};

/**
 * The single SSE subscription primitive for every realtime stream
 * (markets, Skull King tables, data-change signals, user events).
 *
 * Self-heals three dropout scenarios the browser's built-in EventSource
 * reconnect does not cover:
 *
 *   1. Silent connection death (VPN/NAT reaping an idle stream): the backend
 *      sends a 15s heartbeat comment frame; if no bytes arrive at all for
 *      SSE_LIVENESS_TIMEOUT_MS, the EventSource is closed and recreated.
 *   2. Reconnect after an error — onRecover fires on every reopen that
 *      follows an error, so consumers refetch what they missed.
 *   3. Tab regained visibility / navigator came back online — onRecover fires
 *      again (only when onRecover is provided; listeners are not attached
 *      otherwise).
 *
 * A stream the server rejected outright (non-200 status — 404 table/market
 * gone, 401 expired session — leaves readyState CLOSED) is treated as fatal:
 * the browser already gave up, and recreating would only re-request and
 * re-fail, so the hook stops instead of retry-looping.
 */
export function useSSE(url: string | null, options: UseSSEOptions): void {
    // Keep the latest handlers without resubscribing when they change identity.
    // Updated in a layout-less effect (runs after every render, before any
    // async SSE event can fire) instead of during render.
    const optionsRef = useRef(options);
    useEffect(() => {
        optionsRef.current = options;
    });

    useEffect(() => {
        if (!url) return;

        let es: EventSource | null = null;
        let livenessTimer: ReturnType<typeof setTimeout> | null = null;
        let closedByUs = false;
        let fatal = false;
        // Whether we've seen at least one error since the last successful open;
        // avoids firing onRecover on the very first (clean) connect.
        let erroredSinceOpen = false;

        const armLivenessTimer = () => {
            if (livenessTimer) clearTimeout(livenessTimer);
            livenessTimer = setTimeout(() => {
                // No bytes received (not even a heartbeat) — the stream is
                // silently dead. Force a fresh EventSource.
                es?.close();
                if (closedByUs || fatal) return;
                es = createEventSource();
            }, SSE_LIVENESS_TIMEOUT_MS);
        };

        const handleVisibilityOrOnline = () => {
            // Refetch to catch up on anything missed while backgrounded; the
            // SSE connection (if still alive) keeps streaming after.
            if (document.visibilityState === "visible") {
                optionsRef.current.onRecover?.();
            }
        };

        const createEventSource = () => {
            const source = new EventSource(url, { withCredentials: true });

            // Any message — data or a comment frame reaching onmessage — proves
            // the connection is alive.
            source.onmessage = (event) => {
                armLivenessTimer();
                try {
                    const parsed = JSON.parse(event.data);
                    if (parsed && typeof parsed.type === "string") {
                        optionsRef.current.onEvent(parsed);
                    }
                } catch {
                    // ignore malformed events
                }
            };

            source.onopen = () => {
                armLivenessTimer();
                if (erroredSinceOpen) {
                    erroredSinceOpen = false;
                    optionsRef.current.onRecover?.();
                }
            };

            source.onerror = () => {
                if (source.readyState === EventSource.CLOSED) {
                    // Fatal (e.g. 404/401): the browser will not auto-reconnect
                    // and a recreate would just fail the same way. Stop.
                    fatal = true;
                    if (livenessTimer) clearTimeout(livenessTimer);
                    return;
                }
                erroredSinceOpen = true;
                // EventSource auto-reconnects; the liveness timer forces a
                // recreate if it stalls for too long.
            };

            return source;
        };

        armLivenessTimer();
        es = createEventSource();
        if (optionsRef.current.onRecover) {
            document.addEventListener("visibilitychange", handleVisibilityOrOnline);
            window.addEventListener("online", handleVisibilityOrOnline);
        }

        return () => {
            closedByUs = true;
            if (livenessTimer) clearTimeout(livenessTimer);
            es?.close();
            document.removeEventListener("visibilitychange", handleVisibilityOrOnline);
            window.removeEventListener("online", handleVisibilityOrOnline);
        };
    }, [url]);
}
