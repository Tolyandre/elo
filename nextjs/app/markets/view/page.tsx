"use client"
import React, { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toBase58ID } from "@/lib/id";
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
import { BackButton } from "@/components/back-button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useMarketPricesSSE } from "@/hooks/useMarketsSSE";
import { outcomeDisplayName } from "@/app/markets/marketTypes";
import { outcomeColors } from "@/app/markets/outcomeColors";
import { sharesForAmount } from "@/app/markets/lmsr";
import { formatAmount } from "@/app/markets/format";
import { usePlayers } from "@/app/players/PlayersContext";
import { ChartPricePoint, mergePriceHistory } from "@/app/markets/priceHistory";

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

// Buy modes: "share" buys exactly one voice at the current LMSR price;
// "amount" stakes a fixed 1 elo and buys however many voices that costs
// (the share count comes from inverting the LMSR cost client side).
type BuyMode = "share" | "amount";

function OutcomeColumn({
    label,
    titleColor,
    price,
    betShares,
    buyMode,
    myStaked,
    myShares,
    canBuy,
    onBuy,
    buying,
    isWinner,
}: {
    label: string;
    titleColor?: string;
    price: number;
    /** Shares a fixed 1-elo bet buys at the current q — the multiplier the bet actually realizes. */
    betShares?: number;
    buyMode: BuyMode;
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
                <h3 className="font-semibold text-lg truncate" style={{ color: titleColor }} title={label}>{isWinner ? "✓ " : ""}{label}</h3>
                <p className="text-2xl font-bold leading-tight">
                    {buyMode === "amount" && betShares != null && Number.isFinite(betShares)
                        ? `×${betShares.toFixed(2)}`
                        : price.toFixed(2)}
                </p>
            </div>
            <div className="text-sm space-y-1">
                {myShares !== undefined && myShares > 0 && (
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Куплено голосов:</span>
                        <span>{formatAmount(myShares)}</span>
                    </div>
                )}
                {myStaked !== undefined && myStaked > 0 && (
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Поставлено:</span>
                        <span>{formatAmount(myStaked)}</span>
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
                    {buying ? "..." : buyMode === "amount" ? "Поставить 1" : "Купить 1 голос"}
                </Button>
            )}
        </div>
    );
}

function MarketPageContent() {
    const searchParams = useSearchParams();
    const id = toBase58ID(searchParams.get("id") ?? "");
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
    // The buy mode is a view preference — keep the user's choice across markets.
    const [buyMode, setBuyMode] = useLocalStorage<BuyMode>("market-buy-mode", "share");

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

    // Fixed-amount buys (and their headline multiplier) derive from the live
    // q vector: 1 elo buys `sharesForAmount` shares, and that share count is
    // what the bet actually delivers. Unlike the instantaneous 1/price, it
    // accounts for the price walk within the buy (LMSR is path-independent,
    // so a batch buy costs exactly what step-by-step buys would — the modes
    // stay equally priced).
    const qVec = displayMarket.outcomes.map((o) => o.shares);
    const liquidityB = displayMarket.liquidity_b;

    // Shares-driven buy (ADR-10): the AMM prices the elo cost. In the share
    // mode each purchase buys exactly 1 share; in the amount mode the LMSR
    // cost is inverted client side to buy as many shares as 1 elo buys. The
    // displayed price is sent along so the server can reject the buy if it
    // has moved (409); the spend limit is enforced server side (422); on
    // failure we refresh.
    async function handleBuy(outcome: MarketOutcome) {
        setBuyingOutcome(outcome.id);
        try {
            let shares = 1;
            if (buyMode === "amount") {
                const idx = displayMarket.outcomes.findIndex((o) => o.id === outcome.id);
                shares = sharesForAmount(qVec, liquidityB, idx, 1);
            }
            await placeBetPromise(id!, outcome.id, outcome.price, shares);
            invalidate();
            invalidateHistory();
        } catch {
            invalidate();
            invalidateHistory();
        } finally {
            setBuyingOutcome(null);
        }
    }

    // Pair the outcome titles with their chart colors, the same way the
    // resolution description rows pair with the donut/price lines.
    const colors = outcomeColors(displayMarket.outcomes);
    const stakedByOutcome = new Map((displayMarket.my_positions ?? []).map((p) => [p.outcome_id, p.staked]));
    const sharesOwnedByOutcome = new Map((displayMarket.my_positions ?? []).map((p) => [p.outcome_id, p.shares]));
    const resolvedOutcome = displayMarket.status === "resolved" ? displayMarket.resolution_outcome_id : null;

    const reserved = displayMarket.reserved;
    const betLimit = displayMarket.bet_limit;
    return (
        <main className="max-w-sm mx-auto space-y-4">
            <BackButton href="/markets" label="Назад к ставкам" />
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

            <p className="text-sm text-muted-foreground text-center">
                Каждый голос принесёт 1 рейтинг, если исход сбудется.
            </p>

            <Tabs value={buyMode} onValueChange={(v) => setBuyMode(v as BuyMode)}>
                <TabsList className="grid grid-cols-2 w-full">
                    <TabsTrigger value="share">Цена голоса</TabsTrigger>
                    <TabsTrigger value="amount">Коэффициент</TabsTrigger>
                </TabsList>
            </Tabs>

            <div className="grid grid-cols-2 gap-3">
                {displayMarket.outcomes.map((o, i) => (
                    <OutcomeColumn
                        key={o.id}
                        label={nameOf(o)}
                        titleColor={colors.get(o.id)}
                        price={o.price}
                        betShares={sharesForAmount(qVec, liquidityB, i, 1)}
                        buyMode={buyMode}
                        myStaked={stakedByOutcome.get(o.id)}
                        myShares={sharesOwnedByOutcome.get(o.id)}
                        canBuy={canBuy}
                        onBuy={isOpen ? () => handleBuy(o) : undefined}
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
                    Поставлено {formatAmount(reserved)} из лимита {formatAmount(betLimit)}
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
