"use client";

import { useEffect, useState } from "react";
import { EloWebServiceBaseUrl, SkullKingTableSummary } from "@/app/api";

export function useSkullKingSSE(tableId: string | null): SkullKingTableSummary | null {
    const [state, setState] = useState<SkullKingTableSummary | null>(null);

    useEffect(() => {
        if (!tableId) return;

        const es = new EventSource(
            `${EloWebServiceBaseUrl}/skull-king/tables/${tableId}/events`,
            { withCredentials: true }
        );

        es.onmessage = (event) => {
            try {
                const parsed = JSON.parse(event.data);
                if (parsed.type === "state" && parsed.data) {
                    setState(parsed.data);
                }
            } catch {
                // ignore malformed events
            }
        };

        es.onerror = () => {
            // EventSource auto-reconnects; no action needed here
        };

        return () => {
            es.close();
        };
    }, [tableId]);

    return state;
}

/**
 * Subscribes to the Skull King lobby SSE channel while `enabled`.
 * Returns a tick counter that increments on every "tables-changed" signal,
 * so callers can refetch the table list by depending on it.
 */
export function useSkullKingLobbySSE(enabled: boolean): number {
    const [tick, setTick] = useState(0);

    useEffect(() => {
        if (!enabled) return;

        const es = new EventSource(
            `${EloWebServiceBaseUrl}/skull-king/lobby/events`,
            { withCredentials: true }
        );

        es.onmessage = (event) => {
            try {
                const parsed = JSON.parse(event.data);
                if (parsed.type === "tables-changed") {
                    setTick((t) => t + 1);
                }
            } catch {
                // ignore malformed events
            }
        };

        es.onerror = () => {
            // EventSource auto-reconnects; no action needed here
        };

        return () => {
            es.close();
        };
    }, [enabled]);

    return tick;
}
