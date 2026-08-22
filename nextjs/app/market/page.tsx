"use client"
import React, { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/app/pageHeaderContext";
import {
    MarketDetail,
    MarketOutcome,
    getMarketByIdPromise,
    getMarketPriceHistoryPromise,
    placeBetPromise,
} from "@/app/api";
import { useMe } from "@/app/meContext";
import { Button } from "@/components/ui/button";
import { MarketCard } from "@/components/market-card";
import { ResolutionDescription } from "@/components/resolution-description";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useMarketPricesSSE } from "@/hooks/useMarketsSSE";
import { outcomeDisplayName } from "@/app/market/marketTypes";
import { usePlayers } from "@/app/players/PlayersContext";
import { ChartPricePoint, mergePriceHistory } from "@/app/market/priceHistory";

function DeltaRow({ label, net, earned, totalStaked }: { label: string; net: number; earned: number; totalStaked: number }) {
    const positive = net >= 0;
    return (
        <div className="flex justify-between text-sm gap-2">
            <span className="text-muted-foreground truncate" title={label}>{label}</span>
            <span className="flex gap-2 shrink-0">
                <span className="text-muted-foreground">({totalStaked.toFixed(1)} → {earned.toFixed(1)})</span>
                <span className={`w-12 text-right font-medium ${positive ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                    {positive ? "+" : ""}{net.toFixed(1)}
                </span>
            </span>
        </div>
    );
}

function ProjectedOutcome({ market, nameOf }: { market: MarketDetail; nameOf: (o: MarketOutcome) => string }) {
    const positions = market.my_positions ?? [];
    const totalStaked = positions.reduce((sum, p) => sum + p.staked, 0);
    if (totalStaked === 0 && positions.length === 0) return null;

    // If an outcome wins, its shares pay out 1 each; the other outcomes' spent
    // elo is lost. One row per market outcome.
    const sharesByOutcome = new Map(positions.map((p) => [p.outcome_id, p.shares]));
    return (
        <div className="text-sm space-y-1.5 p-3 rounded-lg bg-muted/50">
            <p className="text-sm text-muted-foreground font-medium tracking-wide mb-2">Ваш выигрыш при исходах:</p>
            {market.outcomes.map((o) => {
                const myShares = sharesByOutcome.get(o.id) ?? 0;
                const net = myShares - totalStaked;
                return (
                    <DeltaRow
                        key={o.id}
                        label={nameOf(o)}
                        net={net}
                        earned={myShares}
                        totalStaked={totalStaked}
                    />
                );
            })}
        </div>
    );
}

// formatShares renders share counts without decimals when they are whole
// numbers (new buys are always whole shares; fractional shares only exist in
// backfilled historical data).
function formatShares(v: number): string {
    return Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(1);
}

function OutcomeColumn({
    label,
    price,
    myStaked,
    myShares,
    canBuy,
    onBuy,
    buying,
    isWinner,
}: {
    label: string;
    price: number;
    myStaked?: number;
    myShares?: number;
    canBuy: boolean;
    onBuy?: () => void;
    buying: boolean;
    isWinner: boolean;
}) {
    return (
        <div className={`flex-1 flex flex-col p-3 border rounded-lg gap-2 ${isWinner ? "border-green-500" : ""}`}>
            <div className="text-center min-w-0">
                <h3 className="font-semibold text-lg truncate" title={label}>{isWinner ? "✓ " : ""}{label}</h3>
                <p className="text-2xl font-bold leading-tight">{price.toFixed(2)}</p>
            </div>
            <div className="text-sm space-y-1">
                {myShares !== undefined && myShares > 0 && (
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Куплено голосов:</span>
                        <span>{formatShares(myShares)}</span>
                    </div>
                )}
                {myStaked !== undefined && myStaked > 0 && (
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Потрачено:</span>
                        <span>{myStaked.toFixed(2)}</span>
                    </div>
                )}
            </div>
            {onBuy && (
                <Button
                    size="sm"
                    className="w-full mt-auto"
                    onClick={onBuy}
                    disabled={!canBuy || buying}
                >
                    {buying ? "..." : "Купить"}
                </Button>
            )}
        </div>
    );
}

function MarketPageContent() {
    const searchParams = useSearchParams();
    const id = searchParams.get("id") ?? "";
    const me = useMe();
    const { players, playerDisplayName } = usePlayers();

    const { data: market, loading, invalidate } = useAsyncResource(
        () => (id ? getMarketByIdPromise(id) : Promise.reject(new Error('no id'))),
        [id],
    );
    const { data: fetchedHistory, invalidate: invalidateHistory } = useAsyncResource(
        () => (id ? getMarketPriceHistoryPromise(id) : Promise.reject(new Error('no id'))),
        [id],
    );
    // Live LMSR prices/pools streamed after every purchase (ours and others').
    const ssePrices = useMarketPricesSSE(id || null);

    // Live points appended onto the replayed history as SSE prices tick. A
    // point whose price vector matches the previous one is dropped by the
    // merge — that is the connect frame echoing the current state, or a bet a
    // history refetch has already picked up.
    const [livePoints, setLivePoints] = useState<ChartPricePoint[]>([]);
    useEffect(() => {
        /* eslint-disable react-hooks/set-state-in-effect -- the SSE hook surfaces the latest prices as a value, so recording each new value in an effect is the standard stream-to-state bridge */
        if (!ssePrices) return;
        const prices: Record<string, number> = {};
        for (const o of ssePrices.outcomes) prices[o.id] = o.price;
        setLivePoints(prev => [...prev, { t: Date.now(), prices }]);
        /* eslint-enable react-hooks/set-state-in-effect */
    }, [ssePrices]);

    const priceHistory = mergePriceHistory(
        (fetchedHistory ?? []).map(p => ({
            t: new Date(p.t).getTime(),
            prices: Object.fromEntries(p.prices.map(op => [op.outcome_id, op.price])),
        })),
        livePoints,
    );

    const [buyingOutcome, setBuyingOutcome] = useState<string | null>(null);

    const nameOf = useMemo(
        () => (o: MarketOutcome) => outcomeDisplayName(o, players, playerDisplayName),
        [players, playerDisplayName],
    );

    if (loading || !market) {
        return (
            <main className="max-w-sm mx-auto">
                <p className="text-muted-foreground">{loading ? "Загрузка..." : "Рынок не найден"}</p>
            </main>
        );
    }

    // SSE overrides the REST snapshot so prices/voice counts/pools tick live
    // while the market is open.
    const liveById = new Map((ssePrices?.outcomes ?? []).map((o) => [o.id, o]));
    const displayMarket: MarketDetail = ssePrices
        ? {
            ...market,
            outcomes: market.outcomes.map((o) => {
                const live = liveById.get(o.id);
                return live ? { ...o, price: live.price, shares: live.shares, pool: live.pool } : o;
            }),
        }
        : market;

    const isOpen = displayMarket.status === "open";
    const hasPlayer = !!(me.playerId);
    const isLoggedIn = me.isAuthenticated;
    const canBuy = isOpen && isLoggedIn && hasPlayer;

    const buyDisabledReason = !isLoggedIn
        ? "Авторизуйтесь и привяжите игрока в Настройках"
        : !hasPlayer
            ? "Привяжите игрока в Настройках"
            : "";

    // Shares-driven buy (ADR-10): each purchase buys exactly 1 share of the
    // outcome; the AMM prices the elo cost (≈ the current price shown on the
    // column). The displayed price is sent along so the server can reject the
    // buy if it has moved (409); on failure we refresh.
    async function handleBuy(outcomeId: string, expectedPrice: number) {
        setBuyingOutcome(outcomeId);
        try {
            await placeBetPromise(id, outcomeId, expectedPrice);
            invalidate();
            invalidateHistory();
        } catch {
            invalidate();
            invalidateHistory();
        } finally {
            setBuyingOutcome(null);
        }
    }

    const stakedByOutcome = new Map((displayMarket.my_positions ?? []).map((p) => [p.outcome_id, p.staked]));
    const sharesOwnedByOutcome = new Map((displayMarket.my_positions ?? []).map((p) => [p.outcome_id, p.shares]));
    const resolvedOutcome = displayMarket.status === "resolved" ? displayMarket.resolution_outcome_id : null;

    const reserved = displayMarket.reserved;
    const betLimit = displayMarket.bet_limit;
    return (
        <main className="max-w-sm mx-auto space-y-4">
            <PageHeader title="Ставки" />
            <MarketCard market={displayMarket} priceHistory={priceHistory} />

            {displayMarket.resolution_match_id && (
                <p className="text-sm text-muted-foreground text-center">
                    Партия, разрешившая рынок:{" "}
                    <Link className="underline underline-offset-2 hover:text-foreground" href={`/matches/view?id=${displayMarket.resolution_match_id}`}>
                        открыть
                    </Link>
                </p>
            )}

            <div className="grid grid-cols-2 gap-3">
                {displayMarket.outcomes.map((o) => (
                    <OutcomeColumn
                        key={o.id}
                        label={nameOf(o)}
                        price={o.price}
                        myStaked={stakedByOutcome.get(o.id)}
                        myShares={sharesOwnedByOutcome.get(o.id)}
                        canBuy={canBuy}
                        onBuy={isOpen ? () => handleBuy(o.id, o.price) : undefined}
                        buying={buyingOutcome === o.id}
                        isWinner={resolvedOutcome != null && resolvedOutcome === o.id}
                    />
                ))}
            </div>

            {isOpen && <ProjectedOutcome market={displayMarket} nameOf={nameOf} />}

            {isOpen && !canBuy && buyDisabledReason && (
                <p className="text-sm text-muted-foreground text-center">{buyDisabledReason}</p>
            )}

            {isOpen && reserved != null && betLimit != null && (
                <p className="text-sm text-muted-foreground text-center">
                    Потрачено на {reserved.toFixed(1)} из лимита {betLimit.toFixed(1)}
                </p>
            )}

            <ResolutionDescription market={displayMarket} />
        </main>
    );
}

export default function MarketPage() {
    return (
        <Suspense>
            <MarketPageContent />
        </Suspense>
    );
}
