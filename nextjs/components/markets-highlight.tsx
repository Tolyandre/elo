"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getMarketsPagePromise, type Market } from "@/app/api";
import { useMarketsLobbySSE } from "@/hooks/useMarketsSSE";
import { MarketCard } from "@/components/market-card";

// Markets resolved within this window ride the main page's «Ставки» section.
const RESOLVED_HIGHLIGHT_MS = 24 * 60 * 60 * 1000;

/**
 * The section's content: every active market (open or betting-locked) plus
 * the markets resolved within the last day, cancelled ones excluded.
 */
export function highlightMarkets(active: Market[], closed: Market[], now: number): Market[] {
    return [
        ...active,
        ...closed.filter(
            (m) =>
                m.status === "resolved" &&
                !!m.resolved_at &&
                now - new Date(m.resolved_at).getTime() < RESOLVED_HIGHLIGHT_MS,
        ),
    ];
}

/**
 * The market cards on the main page, right after «Сейчас играют»: every
 * active market (open or betting-locked — the active bucket is small and
 * bounded, so the lobby returns it in full) plus the markets resolved within
 * the last day, cancelled ones excluded. This replaces the /markets lobby
 * page. Hidden entirely when there is nothing to show; refreshes on the
 * markets-lobby SSE signal so openings and resolutions appear live.
 */
export function MarketsHighlight() {
    const [markets, setMarkets] = useState<Market[] | null>(null);
    const tick = useMarketsLobbySSE(true);

    useEffect(() => {
        let cancelled = false;
        // A generous closed page: enough resolved markets to cover the whole
        // day window unless a very large burst of cancellations shares it.
        getMarketsPagePromise({ limit: 100 })
            .then((page) => {
                if (cancelled) return;
                setMarkets(highlightMarkets(page.active, page.closed, Date.now()));
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [tick]);

    if (markets === null || markets.length === 0) return null;

    return (
        // Same column as the «Сейчас» block above and the arena tabs below;
        // the hover treatment matches every other clickable card in the feed.
        <div className="max-w-sm mx-auto py-4 space-y-2">
            {markets.map((m) => (
                <Link key={m.id} href={`/markets/view?id=${m.id}`} className="block">
                    <MarketCard
                        market={m}
                        className="hover:bg-accent transition-colors cursor-pointer"
                    />
                </Link>
            ))}
        </div>
    );
}
