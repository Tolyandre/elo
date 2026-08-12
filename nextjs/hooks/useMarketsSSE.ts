"use client";

import { useEffect, useState } from "react";
import { EloWebServiceBaseUrl } from "@/app/api";

// Heartbeat must match the backend (markets_sse.go): if we receive no bytes
// (not even a comment frame) within this window, the stream is silently dead
// and we force a fresh EventSource. Kept above the server's 15s tick.
const SSE_LIVENESS_TIMEOUT_MS = 45_000;

export type MarketPrices = {
    yes_price: number;
    no_price: number;
    yes_shares: number;
    no_shares: number;
    yes_pool: number;
    no_pool: number;
};

/**
 * Subscribes to a market's SSE stream and returns the latest live LMSR state —
 * prices (probabilities in [0,1]), outstanding share counts and pools —
 * broadcast after every purchase. Returns null until the first frame arrives;
 * callers fall back to the REST values.
 *
 * Self-heals silent connection death (VPN/NAT reaping) via the liveness timer,
 * and the backend resends the current state on every (re)connect, so no extra
 * refetch is needed on reconnect. Single-process backend only (see ADR-10).
 */
export function useMarketPricesSSE(marketId: string | null): MarketPrices | null {
    const [prices, setPrices] = useState<MarketPrices | null>(null);

    useEffect(() => {
        if (!marketId) return;

        let es: EventSource | null = null;
        let livenessTimer: ReturnType<typeof setTimeout> | null = null;
        let closedByUs = false;

        const armLivenessTimer = () => {
            if (livenessTimer) clearTimeout(livenessTimer);
            livenessTimer = setTimeout(() => {
                es?.close();
                if (closedByUs) return;
                es = createEventSource();
            }, SSE_LIVENESS_TIMEOUT_MS);
        };

        const createEventSource = () => {
            const source = new EventSource(
                `${EloWebServiceBaseUrl}/markets/${marketId}/events`,
                { withCredentials: true },
            );

            source.onmessage = (event) => {
                armLivenessTimer();
                try {
                    const parsed = JSON.parse(event.data);
                    if (parsed.type === "prices" && parsed.data) {
                        setPrices(parsed.data as MarketPrices);
                    }
                } catch {
                    // ignore malformed events
                }
            };

            source.onopen = () => armLivenessTimer();
            source.onerror = () => {
                // EventSource auto-reconnects; the liveness timer forces a
                // recreate if it stalls for too long.
            };

            return source;
        };

        armLivenessTimer();
        es = createEventSource();

        return () => {
            closedByUs = true;
            if (livenessTimer) clearTimeout(livenessTimer);
            es?.close();
        };
    }, [marketId]);

    return prices;
}

/**
 * Subscribes to the markets lobby SSE channel while `enabled`. Returns a tick
 * counter that increments on every "markets-changed" signal, so callers refetch
 * the markets list by depending on it. Mirrors useSkullKingLobbySSE.
 */
export function useMarketsLobbySSE(enabled: boolean): number {
    const [tick, setTick] = useState(0);

    useEffect(() => {
        if (!enabled) return;

        let es: EventSource | null = null;
        let livenessTimer: ReturnType<typeof setTimeout> | null = null;
        let closedByUs = false;

        const armLivenessTimer = () => {
            if (livenessTimer) clearTimeout(livenessTimer);
            livenessTimer = setTimeout(() => {
                es?.close();
                if (closedByUs) return;
                es = createEventSource();
            }, SSE_LIVENESS_TIMEOUT_MS);
        };

        const createEventSource = () => {
            const source = new EventSource(
                `${EloWebServiceBaseUrl}/markets/lobby/events`,
                { withCredentials: true },
            );

            source.onmessage = (event) => {
                armLivenessTimer();
                try {
                    const parsed = JSON.parse(event.data);
                    if (parsed.type === "markets-changed") {
                        setTick((t) => t + 1);
                    }
                } catch {
                    // ignore malformed events
                }
            };

            source.onopen = () => armLivenessTimer();
            source.onerror = () => {
                // auto-reconnect handled by EventSource
            };

            return source;
        };

        armLivenessTimer();
        es = createEventSource();

        return () => {
            closedByUs = true;
            if (livenessTimer) clearTimeout(livenessTimer);
            es?.close();
        };
    }, [enabled]);

    return tick;
}
