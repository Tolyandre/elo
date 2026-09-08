"use client";

import { useEffect, useRef, useState } from "react";

// Must stay above the backend's 15s heartbeat tick (pkg/api/sse.go): if no
// frame — data or named heartbeat — arrives within this window, the stream is
// silently dead (NAT/VPN reaped it) and we force a fresh EventSource.
const SSE_LIVENESS_TIMEOUT_MS = 45_000;
// After the server rejects a connection outright (non-200 → readyState CLOSED),
// retry with capped exponential backoff instead of stopping: the rejection may
// be transient (502 from a proxy during a backend restart) even when it looks
// permanent (404 table deleted). Consumers that know a resource is gone
// unsubscribe by nulling the url.
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/** One parsed SSE frame: {"type": "...", "data": ...}. */
export type SSEEnvelope = {
    type: string;
    data?: unknown;
};

export type UseSSEOptions = {
    /** Dispatches one parsed event envelope. Malformed frames are ignored. */
    onEvent: (event: SSEEnvelope) => void;
    /**
     * The stream may have missed events — it reopened after an error or a
     * forced recreate, or the tab became visible / the navigator came back
     * online. Refetch to catch up. Streams whose server resends the current
     * state on every (re)connect (table snapshots, market prices) can treat
     * this as a cheap extra refresh.
     */
    onRecover?: () => void;
};

/**
 * The single SSE subscription primitive for every realtime stream
 * (markets, game tables, data-change signals, user events).
 *
 * Returns whether the stream is currently open. While disconnected the
 * consumer's data is a frozen snapshot of the last received state — live
 * tables surface this as a "no connection" hint instead of letting the user
 * wonder why nothing moves.
 *
 * Self-heals four dropout scenarios the browser's built-in EventSource
 * reconnect does not cover:
 *
 *   1. Silent connection death (VPN/NAT reaping an idle stream): the backend
 *      sends a 15s heartbeat as a *named* event (`event: heartbeat`); if no
 *      frame arrives at all for SSE_LIVENESS_TIMEOUT_MS, the EventSource is
 *      closed and recreated. (Comment frames can't be used for this — the
 *      SSE spec discards them before any handler runs, so they are invisible
 *      to JS.)
 *   2. Server rejection (non-200 → readyState CLOSED): the browser never
 *      auto-reconnects in this state, so the hook retries itself with capped
 *      exponential backoff. A permanently gone resource (404 table deleted)
 *      keeps retrying harmlessly until the consumer unsubscribes; a transient
 *      5xx during a restart recovers on its own.
 *   3. Reconnect after an error or forced recreate — onRecover fires on every
 *      reopen that follows a gap, so consumers refetch what they missed.
 *   4. Tab regained visibility / navigator came back online — onRecover fires
 *      again (only when onRecover is provided; listeners are not attached
 *      otherwise).
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

        let es: EventSource | null = null;
        let livenessTimer: ReturnType<typeof setTimeout> | null = null;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        let retryAttempt = 0;
        let closedByUs = false;
        // Whether events could have been missed since the last successful open
        // (an error, a forced recreate, a rejected connection). The next open
        // fires onRecover; avoids firing it on a clean first connect, where
        // consumers already fetch on mount.
        let missedSinceOpen = false;

        const clearTimers = () => {
            if (livenessTimer) {
                clearTimeout(livenessTimer);
                livenessTimer = null;
            }
            if (retryTimer) {
                clearTimeout(retryTimer);
                retryTimer = null;
            }
        };

        const handleVisibilityOrOnline = () => {
            // Refetch to catch up on anything missed while backgrounded; the
            // SSE connection (if still alive) keeps streaming after.
            if (document.visibilityState === "visible") {
                optionsRef.current.onRecover?.();
            }
        };

        const createEventSource = (): EventSource => {
            const source = new EventSource(url, { withCredentials: true });

            // The backend's heartbeat is a named event (see sse.go): named
            // events never reach onmessage, so listen for the name. Any frame
            // — heartbeat or data — proves the connection is alive.
            source.addEventListener("heartbeat", armLivenessTimer);

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
                setConnected(true);
                retryAttempt = 0;
                if (missedSinceOpen) {
                    missedSinceOpen = false;
                    optionsRef.current.onRecover?.();
                }
            };

            source.onerror = () => {
                setConnected(false);
                if (source.readyState === EventSource.CLOSED) {
                    // The server rejected the connection (non-200). The
                    // browser will not reconnect on its own; retry with
                    // backoff. Probe via onRecover right away: if the
                    // resource is permanently gone, the consumer detects it
                    // and unsubscribes; onopen never fires on a rejected
                    // connection, so waiting for it would never catch up.
                    missedSinceOpen = true;
                    optionsRef.current.onRecover?.();
                    if (closedByUs) return;
                    // Drop any pending liveness recreate/retry so backoff is
                    // the only reconnection path from here.
                    if (livenessTimer) {
                        clearTimeout(livenessTimer);
                        livenessTimer = null;
                    }
                    if (retryTimer) clearTimeout(retryTimer);
                    const delay = Math.min(RETRY_BASE_MS * 2 ** retryAttempt, RETRY_MAX_MS);
                    retryAttempt += 1;
                    retryTimer = setTimeout(() => {
                        retryTimer = null;
                        es = createEventSource();
                    }, delay);
                    return;
                }
                // CONNECTING: the browser auto-reconnects (server `retry:`
                // hint); mark the gap so the reopen triggers catch-up. The
                // liveness timer forces a recreate if it stalls for too long.
                missedSinceOpen = true;
            };

            return source;
        };

        function armLivenessTimer() {
            if (livenessTimer) clearTimeout(livenessTimer);
            livenessTimer = setTimeout(() => {
                // No frames received (not even heartbeats) — the stream is
                // silently dead. Force a fresh EventSource; the recreate marks
                // a gap so the next open triggers catch-up.
                missedSinceOpen = true;
                setConnected(false);
                es?.close();
                if (closedByUs) return;
                es = createEventSource();
            }, SSE_LIVENESS_TIMEOUT_MS);
        }

        armLivenessTimer();
        es = createEventSource();
        if (optionsRef.current.onRecover) {
            document.addEventListener("visibilitychange", handleVisibilityOrOnline);
            window.addEventListener("online", handleVisibilityOrOnline);
        }

        return () => {
            closedByUs = true;
            clearTimers();
            es?.close();
            document.removeEventListener("visibilitychange", handleVisibilityOrOnline);
            window.removeEventListener("online", handleVisibilityOrOnline);
            // Teardown also runs right before a url change: the new
            // subscription starts out "disconnected" until its first open.
            setConnected(false);
        };
    }, [url]);

    return connected;
}
