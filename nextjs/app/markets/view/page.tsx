"use client"
import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toBase58ID } from "@/lib/id";
import { PageHeader } from "@/app/pageHeaderContext";
import {
    MarketDetail,
    MarketOutcome,
    getMarketByIdPromise,
    getMarketProbabilityHistoryPromise,
    placeBetPromise,
} from "@/app/api";
import { useMe } from "@/app/meContext";
import { Button } from "@/components/ui/button";
import { MarketCard } from "@/components/market-card";
import { MarketRelatedMatches } from "@/components/market-related-matches";
import { ResolutionDescription } from "@/components/resolution-description";
import { BackButton } from "@/components/back-button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TriangleAlertIcon } from "lucide-react";
import { MarketGuarantees } from "@/components/market-guarantees";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useMarketProbabilitiesSSE } from "@/hooks/useMarketsSSE";
import { outcomeDisplayName } from "@/app/markets/marketTypes";
import { outcomeColors } from "@/app/markets/outcomeColors";
import { sharesForTotal, buyQuote } from "@/app/markets/lmsr";
import { formatAmount } from "@/app/markets/format";
import { usePlayers } from "@/app/players/PlayersContext";
import { ProbabilityPoint, mergeProbabilityHistory } from "@/app/markets/probabilityHistory";

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

function formatPercent(rate: number): string {
    const pct = (rate * 100).toFixed(1).replace(/\.0$/, "");
    return `${pct}%`;
}

function OutcomeColumn({
    label,
    titleColor,
    probability,
    pricePerShare,
    multiplier,
    fee,
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
    /** Probability (LMSR marginal price) in (0,1) — what the donut and the chart show. */
    probability: number;
    /** All-in elo per share of the pending buy (LMSR cost + maker fee) — the "за 1 голос" price. */
    pricePerShare?: number;
    /** Voices per 1 elo of the pending buy (1/pricePerShare) — the ×multiplier headline. */
    multiplier?: number;
    /** Maker fee part of one share's price (ADR-20), same per-voice units as pricePerShare. */
    fee?: number;
    buyMode: BuyMode;
    myStaked?: number;
    myShares?: number;
    canBuy: boolean;
    onBuy?: () => void;
    buying: boolean;
    isWinner: boolean;
}) {
    // The card quotes the pending buy — a ×multiplier headline (voices per
    // elo) over its per-share price; the two are reciprocals. The modes
    // differ in what the buy button actually spends: the price of one share
    // ("По одному голосу") or a fixed 1 elo ("По стоимости 1").
    const headline = multiplier != null && Number.isFinite(multiplier)
        ? `×${multiplier.toFixed(2)}`
        : probability.toFixed(2);
    const headlineCaption = pricePerShare != null && Number.isFinite(pricePerShare)
        ? `${formatAmount(pricePerShare)} за 1 голос`
        : null;
    const buyLabel = buyMode === "amount"
        ? "Поставить 1"
        : pricePerShare != null && Number.isFinite(pricePerShare)
            ? `Поставить ${formatAmount(pricePerShare)}`
            : "Поставить";
    return (
        <div className={`flex-1 flex flex-col p-3 border rounded-lg gap-2 ${isWinner ? "border-green-500" : ""}`}>
            <div className="text-center min-w-0">
                <h3 className="font-semibold text-lg truncate" style={{ color: titleColor }} title={label}>{isWinner ? "✓ " : ""}{label}</h3>
                <p className="text-2xl font-bold leading-tight">{headline}</p>
                {headlineCaption && (
                    <p className="text-xs text-muted-foreground leading-tight">{headlineCaption}</p>
                )}
                {fee != null && fee > 0 && (
                    <p className="text-xs text-muted-foreground leading-tight">в т.ч. комиссия {formatAmount(fee)}</p>
                )}
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
                    {buying ? "..." : buyLabel}
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
        () => (id ? getMarketProbabilityHistoryPromise(id) : Promise.reject(new Error('no id'))),
        [id],
    );
    // Live LMSR probabilities/pools streamed after every purchase (ours and
    // others'); a guarantor join publishes "guarantees-changed" (prices are
    // preserved by the rescale, but liquidity/limits change → refetch).
    const sseProbabilities = useMarketProbabilitiesSSE(id || null, invalidate);

    // Live points appended onto the replayed history as SSE probabilities tick.
    // A point whose probability vector matches the previous one is dropped by
    // the merge — that is the connect frame echoing the current state, or a bet
    // a history refetch has already picked up.
    const [livePoints, setLivePoints] = useState<ProbabilityPoint[]>([]);
    useEffect(() => {
        /* eslint-disable react-hooks/set-state-in-effect -- the SSE hook surfaces the latest probabilities as a value, so recording each new value in an effect is the standard stream-to-state bridge */
        if (!sseProbabilities) return;
        const probabilities: Record<string, number> = {};
        for (const o of sseProbabilities.outcomes) probabilities[o.id] = o.probability;
        setLivePoints(prev => [...prev, { t: Date.now(), probabilities }]);
        /* eslint-enable react-hooks/set-state-in-effect */
    }, [sseProbabilities]);

    const probabilityHistory = mergeProbabilityHistory(
        (fetchedHistory ?? []).map(p => ({
            t: new Date(p.t).getTime(),
            probabilities: Object.fromEntries(p.probabilities.map(op => [op.outcome_id, op.probability])),
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

    // SSE overrides the REST snapshot so probabilities/voice counts/pools tick
    // live while the market is open.
    const liveById = new Map((sseProbabilities?.outcomes ?? []).map((o) => [o.id, o]));
    const displayMarket: MarketDetail = sseProbabilities
        ? {
            ...market,
            outcomes: market.outcomes.map((o) => {
                const live = liveById.get(o.id);
                return live ? { ...o, probability: live.probability, shares: live.shares, pool: live.pool } : o;
            }),
        }
        : market;

    const isOpen = displayMarket.status === "open";
    const hasPlayer = !!(me.playerId);
    const isLoggedIn = me.isAuthenticated;
    // Without guarantors (liquidity_b = 0) there is nothing to trade against
    // (ADR-20): the b→0 LMSR limit would hand out free longshot shares with
    // nobody to pay the winners.
    const awaitsGuarantors = displayMarket.liquidity_b <= 0;
    const canBuy = isOpen && isLoggedIn && hasPlayer && !awaitsGuarantors;

    const buyDisabledReason = !isLoggedIn
        ? "Авторизуйтесь и привяжите игрока в Настройках"
        : !hasPlayer
            ? "Привяжите игрока в Настройках"
            : awaitsGuarantors
                ? "Рынок ждёт поручителей — ставки пока недоступны"
                : "";

    // Fixed-amount buys (and their headline multiplier) derive from the live
    // q vector: 1 elo buys `sharesForAmount` shares, and that share count is
    // what the bet actually delivers. Unlike the instantaneous 1/probability,
    // it accounts for the price walk within the buy (LMSR is path-independent,
    // so a batch buy costs exactly what step-by-step buys would — the modes
    // stay equally priced).
    const qVec = displayMarket.outcomes.map((o) => o.shares);
    const liquidityB = displayMarket.liquidity_b;
    // The market's maker fee (risk-weighted mean of the guarantor wagers'
    // rates, ADR-20) — added to the LMSR price as p + 4c·p(1−p) per share.
    const feeRate = displayMarket.fee_rate ?? 0;

    // Shares-driven buy (ADR-10): the AMM prices the elo cost. In the share
    // mode each purchase buys exactly 1 share; in the amount mode the 1 elo
    // covers the LMSR cost AND the maker fee (the share count solves
    // cost(s) + fee(s) = 1 client side). The displayed probability is sent
    // along so the server can reject the buy if it has moved (409); the spend
    // limit is enforced server side (422); on failure we refresh.
    async function handleBuy(outcome: MarketOutcome) {
        setBuyingOutcome(outcome.id);
        try {
            let shares = 1;
            if (buyMode === "amount") {
                const idx = displayMarket.outcomes.findIndex((o) => o.id === outcome.id);
                shares = sharesForTotal(qVec, liquidityB, idx, 1, feeRate);
            }
            await placeBetPromise(id!, outcome.id, outcome.probability, shares);
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
            <MarketCard market={displayMarket} probabilityHistory={probabilityHistory} />

            <p className="text-sm text-muted-foreground text-center">
                Каждый голос принесёт 1 рейтинг, если исход сбудется.
            </p>

            {awaitsGuarantors && (
                <Alert variant="warning">
                    <TriangleAlertIcon />
                    <AlertTitle>Рынок ждёт поручителей</AlertTitle>
                    <AlertDescription>
                        Ставки откроются, когда появится первый поручитель.
                    </AlertDescription>
                </Alert>
            )}

            <Tabs value={buyMode} onValueChange={(v) => setBuyMode(v as BuyMode)}>
                <TabsList className="grid grid-cols-2 w-full">
                    <TabsTrigger value="share">По одному голосу</TabsTrigger>
                    <TabsTrigger value="amount">По стоимости 1</TabsTrigger>
                </TabsList>
            </Tabs>

            <div className="grid grid-cols-2 gap-3">
                {displayMarket.outcomes.map((o, i) => {
                    const quote = buyQuote(qVec, liquidityB, i, buyMode, feeRate);
                    return (
                        <OutcomeColumn
                            key={o.id}
                            label={nameOf(o)}
                            titleColor={colors.get(o.id)}
                            probability={o.probability}
                            pricePerShare={quote.pricePerShare}
                            multiplier={quote.multiplier}
                            fee={quote.fee}
                            buyMode={buyMode}
                            myStaked={stakedByOutcome.get(o.id)}
                            myShares={sharesOwnedByOutcome.get(o.id)}
                            canBuy={canBuy}
                            onBuy={isOpen ? () => handleBuy(o) : undefined}
                            buying={buyingOutcome === o.id}
                            isWinner={resolvedOutcome != null && resolvedOutcome === o.id}
                        />
                    );
                })}
            </div>

            {/* The fee line accompanies the buy cards on open markets and keeps
                explaining the settled bets' fees on closed ones (only a
                cancelled market never charged one). */}
            {feeRate > 0 && displayMarket.status !== "cancelled" && (
                <p className="text-sm text-muted-foreground text-center">
                    Комиссия рынка: {formatPercent(feeRate)} — идёт поручителям
                </p>
            )}

            {isOpen && <ProjectedOutcome market={displayMarket} nameOf={nameOf} />}

            <MarketGuarantees
                market={displayMarket}
                canJoin={isOpen && isLoggedIn && hasPlayer}
                disabledReason={buyDisabledReason}
                onJoined={() => {
                    invalidate();
                    invalidateHistory();
                }}
            />

            {isOpen && !canBuy && buyDisabledReason && (
                <p className="text-sm text-muted-foreground text-center">{buyDisabledReason}</p>
            )}

            {isOpen && reserved != null && betLimit != null && (
                <p className="text-sm text-muted-foreground text-center">
                    Поставлено {formatAmount(reserved)} из лимита {formatAmount(betLimit)}
                </p>
            )}

            <ResolutionDescription market={displayMarket} />

            <MarketRelatedMatches market={displayMarket} roundToInteger={me.roundToInteger} />
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
