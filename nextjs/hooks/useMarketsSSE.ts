"use client";

import { useCallback, useState } from "react";
import { EloWebServiceBaseUrl } from "@/app/api";
import { useSSE } from "@/hooks/useSSE";
import { useSSETopic } from "@/hooks/useSSETopic";

export type LiveMarketOutcome = {
    id: string;
    /** Probability (LMSR marginal price) in (0,1); probabilities sum to 1. Not the cost of a share. */
    probability: number;
    shares: number;
    pool: number;
};

export type MarketProbabilities = {
    outcomes: LiveMarketOutcome[];
};

/**
 * Subscribes to a market's SSE stream and returns the latest live LMSR state —
 * probabilities (in [0,1]), outstanding share counts and pools — broadcast
 * after every purchase. Returns null until the first frame arrives; callers
 * fall back to the REST values.
 *
 * Connection self-healing lives in useSSE. No recovery refetch is needed here:
 * the backend resends the current state on every (re)connect. Single-process
 * backend only (see ADR-10/ADR-13).
 */
export function useMarketProbabilitiesSSE(marketId: string | null): MarketProbabilities | null {
    const [probabilities, setProbabilities] = useState<MarketProbabilities | null>(null);
    // Reset when switching markets so stale probabilities never bleed into the
    // new page (adjust-state-during-render on id change).
    const [trackedMarketId, setTrackedMarketId] = useState(marketId);
    if (trackedMarketId !== marketId) {
        setTrackedMarketId(marketId);
        setProbabilities(null);
    }

    const onEvent = useCallback((event: { type: string; data?: unknown }) => {
        if (event.type === "probabilities" && event.data) {
            setProbabilities(event.data as MarketProbabilities);
        }
    }, []);

    useSSE(marketId ? `${EloWebServiceBaseUrl}/markets/${marketId}/events` : null, {
        onEvent,
    });

    return probabilities;
}

/**
 * Subscribes to the markets lobby topic of the multiplexed SSE stream while
 * `enabled`. Returns a tick counter that increments on every "markets-changed"
 * signal, so callers refetch the markets list by depending on it.
 */
export function useMarketsLobbySSE(enabled: boolean): number {
    const [tick, setTick] = useState(0);

    const onEvent = useCallback((event: { type: string }) => {
        if (event.type === "markets-changed") {
            setTick((t) => t + 1);
        }
    }, []);

    useSSETopic(enabled ? "lobby:markets" : null, {
        onEvent,
    });

    return tick;
}
