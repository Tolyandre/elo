"use client";

import { useCallback, useState } from "react";
import { EloWebServiceBaseUrl } from "@/app/api";
import { useSSE } from "@/hooks/useSSE";

export type LiveMarketOutcome = {
    id: string;
    price: number;
    shares: number;
    pool: number;
};

export type MarketPrices = {
    outcomes: LiveMarketOutcome[];
};

/**
 * Subscribes to a market's SSE stream and returns the latest live LMSR state —
 * prices (probabilities in [0,1]), outstanding share counts and pools —
 * broadcast after every purchase. Returns null until the first frame arrives;
 * callers fall back to the REST values.
 *
 * Connection self-healing lives in useSSE. No recovery refetch is needed here:
 * the backend resends the current state on every (re)connect. Single-process
 * backend only (see ADR-10/ADR-13).
 */
export function useMarketPricesSSE(marketId: string | null): MarketPrices | null {
    const [prices, setPrices] = useState<MarketPrices | null>(null);
    // Reset when switching markets so stale prices never bleed into the new
    // page (adjust-state-during-render on id change).
    const [trackedMarketId, setTrackedMarketId] = useState(marketId);
    if (trackedMarketId !== marketId) {
        setTrackedMarketId(marketId);
        setPrices(null);
    }

    const onEvent = useCallback((event: { type: string; data?: unknown }) => {
        if (event.type === "prices" && event.data) {
            setPrices(event.data as MarketPrices);
        }
    }, []);

    useSSE(marketId ? `${EloWebServiceBaseUrl}/markets/${marketId}/events` : null, {
        onEvent,
    });

    return prices;
}

/**
 * Subscribes to the markets lobby SSE channel while `enabled`. Returns a tick
 * counter that increments on every "markets-changed" signal, so callers refetch
 * the markets list by depending on it.
 */
export function useMarketsLobbySSE(enabled: boolean): number {
    const [tick, setTick] = useState(0);

    const onEvent = useCallback((event: { type: string }) => {
        if (event.type === "markets-changed") {
            setTick((t) => t + 1);
        }
    }, []);

    useSSE(enabled ? `${EloWebServiceBaseUrl}/markets/lobby/events` : null, {
        onEvent,
    });

    return tick;
}
