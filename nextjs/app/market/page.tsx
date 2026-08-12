"use client"
import React, { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/app/pageHeaderContext";
import { MarketDetail, getMarketByIdPromise, placeBetPromise } from "@/app/api";
import { useMe } from "@/app/meContext";
import { Button } from "@/components/ui/button";
import { MarketCard } from "@/components/market-card";
import { ResolutionDescription } from "@/components/resolution-description";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useMarketPricesSSE } from "@/hooks/useMarketsSSE";

function DeltaRow({ label, net, earned, totalStaked }: { label: string; net: number; earned: number; totalStaked: number }) {
    const positive = net >= 0;
    return (
        <div className="flex justify-between text-sm gap-2">
            <span className="text-muted-foreground">{label}</span>
            <span className="flex gap-2 shrink-0">
                <span className="text-muted-foreground">({totalStaked.toFixed(1)} → {earned.toFixed(1)})</span>
                <span className={`w-12 text-right font-medium ${positive ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                    {positive ? "+" : ""}{net.toFixed(1)}
                </span>
            </span>
        </div>
    );
}

function ProjectedOutcome({ market }: { market: MarketDetail }) {
    const myYesStaked = market.my_yes_staked ?? 0;
    const myNoStaked = market.my_no_staked ?? 0;
    const myYesShares = market.my_yes_shares ?? 0;
    const myNoShares = market.my_no_shares ?? 0;
    const totalStaked = myYesStaked + myNoStaked;

    if (totalStaked === 0) return null;

    // If a side wins, its shares pay out 1 each; the other side's spent elo is lost.
    const netIfYes = myYesShares - totalStaked;
    const netIfNo = myNoShares - totalStaked;

    return (
        <div className="text-sm space-y-1.5 p-3 rounded-lg bg-muted/50">
            <p className="text-sm text-muted-foreground font-medium tracking-wide mb-2">Ваш выигрыш при исходах:</p>
            <DeltaRow label="ДА" net={netIfYes} earned={myYesShares} totalStaked={totalStaked} />
            <DeltaRow label="НЕТ" net={netIfNo} earned={myNoShares} totalStaked={totalStaked} />
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
}: {
    label: string;
    price: number;
    myStaked?: number;
    myShares?: number;
    canBuy: boolean;
    onBuy?: () => void;
    buying: boolean;
}) {
    return (
        <div className="flex-1 flex flex-col p-3 border rounded-lg gap-2">
            <div className="text-center">
                <h3 className="font-semibold text-lg">{label}</h3>
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
                        <span>{myStaked.toFixed(1)}</span>
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

    const { data: market, loading, invalidate } = useAsyncResource(
        () => (id ? getMarketByIdPromise(id) : Promise.reject(new Error('no id'))),
        [id],
    );
    // Live LMSR prices/pools streamed after every purchase (ours and others').
    const ssePrices = useMarketPricesSSE(id || null);
    const [buyingYes, setBuyingYes] = useState(false);
    const [buyingNo, setBuyingNo] = useState(false);

    if (loading || !market) {
        return (
            <main className="max-w-sm mx-auto">
                <p className="text-muted-foreground">{loading ? "Загрузка..." : "Рынок не найден"}</p>
            </main>
        );
    }

    // SSE overrides the REST snapshot so prices/voice counts/pools tick live
    // while the market is open.
    const displayMarket: MarketDetail = ssePrices
        ? {
            ...market,
            yes_price: ssePrices.yes_price,
            no_price: ssePrices.no_price,
            yes_shares: ssePrices.yes_shares,
            no_shares: ssePrices.no_shares,
            yes_pool: ssePrices.yes_pool,
            no_pool: ssePrices.no_pool,
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

    // Shares-driven buy (ADR-10): each purchase buys exactly 1 share; the AMM
    // prices the elo cost (≈ the current price shown on the button's column).
    // The displayed price is sent along so the server can reject the buy if it
    // has moved (409); on failure the toast shows the error and we refresh.
    async function handleBuy(outcome: "yes" | "no") {
        if (outcome === "yes") setBuyingYes(true);
        else setBuyingNo(true);
        try {
            const expectedPrice = outcome === "yes" ? displayMarket.yes_price : displayMarket.no_price;
            await placeBetPromise(id, outcome, expectedPrice);
            invalidate();
        } catch {
            invalidate();
        } finally {
            if (outcome === "yes") setBuyingYes(false);
            else setBuyingNo(false);
        }
    }

    const reserved = displayMarket.reserved;
    const betLimit = displayMarket.bet_limit;
    return (
        <main className="max-w-sm mx-auto space-y-4">
            <PageHeader title="Ставки" />
            <MarketCard market={displayMarket} />

            <div className="flex flex-col sm:flex-row gap-3">
                <OutcomeColumn
                    label="ДА"
                    price={displayMarket.yes_price}
                    myStaked={displayMarket.my_yes_staked ?? undefined}
                    myShares={displayMarket.my_yes_shares ?? undefined}
                    canBuy={canBuy}
                    onBuy={isOpen ? () => handleBuy("yes") : undefined}
                    buying={buyingYes}
                />
                <OutcomeColumn
                    label="НЕТ"
                    price={displayMarket.no_price}
                    myStaked={displayMarket.my_no_staked ?? undefined}
                    myShares={displayMarket.my_no_shares ?? undefined}
                    canBuy={canBuy}
                    onBuy={isOpen ? () => handleBuy("no") : undefined}
                    buying={buyingNo}
                />
            </div>

            <ResolutionDescription market={displayMarket} />

            {isOpen && <ProjectedOutcome market={displayMarket} />}

            {isOpen && !canBuy && buyDisabledReason && (
                <p className="text-sm text-muted-foreground text-center">{buyDisabledReason}</p>
            )}

            {isOpen && reserved != null && betLimit != null && (
                <p className="text-sm text-muted-foreground text-center">
                    Потрачено на {reserved.toFixed(1)} из лимита {betLimit.toFixed(1)}
                </p>
            )}
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
