"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getMarketsPagePromise, type Market } from "@/app/api";
import type { Base58ID } from "@/lib/id";
import { useMarketsLobbySSE } from "@/hooks/useMarketsSSE";
import { useTenantScope } from "@/app/tenantScopeContext";
import { MarketCard } from "@/components/market-card";

// Markets resolved within this window ride the main page's «Ставки» section.
const RESOLVED_HIGHLIGHT_MS = 24 * 60 * 60 * 1000;

/**
 * The section's content: the tenant's active markets (open or betting-locked)
 * plus its markets resolved within the last day, cancelled ones excluded. The
 * lobby is global, but a market belongs to exactly one tenant (ADR-36) and the
 * feed shows only the current one's — the cards above it must not disagree.
 */
export function highlightMarkets(active: Market[], closed: Market[], now: number, tenantId: string): Market[] {
    const isTenantMarket = (m: Market) => m.tenant_id === tenantId;
    return [
        ...active.filter(isTenantMarket),
        ...closed.filter(
            (m) =>
                isTenantMarket(m) &&
                m.status === "resolved" &&
                !!m.resolved_at &&
                now - new Date(m.resolved_at).getTime() < RESOLVED_HIGHLIGHT_MS,
        ),
    ];
}

/**
 * The market cards on the main page, right after «Сейчас играют»: every active
 * market of the current tenant (open or betting-locked — the active bucket is
 * small and bounded, so the lobby returns it in full) plus its markets
 * resolved within the last day, cancelled ones excluded. This replaces the
 * /markets lobby page. Hidden entirely when there is nothing to show;
 * refreshes on the markets-lobby SSE signal so openings and resolutions appear
 * live, and refetches when the tenant switches.
 */
export function MarketsHighlight() {
    const { tenant } = useTenantScope();
    // Tagged with the tenant whose lobby page produced it: until the refetch
    // for a switched tenant lands, the stale page must not render.
    const [page, setPage] = useState<{ tenantId: Base58ID; markets: Market[] } | null>(null);
    const tick = useMarketsLobbySSE(true);

    useEffect(() => {
        if (!tenant) return;
        let cancelled = false;
        // A generous closed page: enough resolved markets to cover the whole
        // day window unless a very large burst of cancellations shares it.
        getMarketsPagePromise({ limit: 100 })
            .then((res) => {
                if (cancelled) return;
                setPage({
                    tenantId: tenant.id,
                    markets: highlightMarkets(res.active, res.closed, Date.now(), tenant.id),
                });
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [tick, tenant]);

    if (tenant == null || page === null || page.tenantId !== tenant.id || page.markets.length === 0) return null;
    const markets = page.markets;

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
