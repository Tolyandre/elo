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
