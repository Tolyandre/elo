"use client";

import { useEffect, useRef, useState } from "react";
import type { SSEEnvelope } from "@/lib/sse-connection";
import { subscribeTopic } from "@/lib/sse-mux";

export type UseSSETopicOptions = {
    /** Dispatches one parsed event envelope. Malformed frames are ignored. */
    onEvent: (event: SSEEnvelope) => void;
    /**
     * The shared stream may have missed events — it reopened (e.g. because
     * another component's subscription changed the topic set), or the tab
     * became visible / the navigator came back online. Refetch to catch up.
     */
    onRecover?: () => void;
};

/**
 * Subscribes to one topic of the app-wide multiplexed SSE connection (see
 * lib/sse-mux.ts) — the app-global topics: "data", "lobby:tables",
 * "lobby:markets" and "me". API mirrors useSSE so consumers migrate 1:1:
 * passing null (e.g. while signed out) unsubscribes; the hook returns
 * whether the shared connection is currently open.
 */
export function useSSETopic(topic: string | null, options: UseSSETopicOptions): boolean {
    const [connected, setConnected] = useState(false);
    // Keep the latest handlers without resubscribing when they change identity.
    // Updated in a layout-less effect (runs after every render, before any
    // async SSE event can fire) instead of during render.
    const optionsRef = useRef(options);
    useEffect(() => {
        optionsRef.current = options;
    });

    useEffect(() => {
        if (!topic) return;

        const unsubscribe = subscribeTopic(topic, {
            onEvent: (event) => optionsRef.current.onEvent(event),
            // Evaluated once per subscription: consumers either always pass
            // onRecover (lobby tick counters) or never do (toast streams),
            // so setup-time presence matches lifetime presence.
            onRecover: optionsRef.current.onRecover
                ? () => optionsRef.current.onRecover?.()
                : undefined,
            onConnectedChange: setConnected,
        });
        return () => {
            unsubscribe();
            // Teardown also runs right before a topic change: the new
            // subscription starts out "disconnected" until the first open.
            setConnected(false);
        };
    }, [topic]);

    return connected;
}
