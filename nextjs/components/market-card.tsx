"use client"
import React from "react";
import {
    CartesianGrid,
    Line,
    LineChart,
    XAxis,
    YAxis,
} from "recharts";
import { Market, SettlementDetail } from "@/app/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from "@/components/ui/chart";
import { usePlayers } from "@/app/players/PlayersContext";
import { useGames } from "@/app/gamesContext";
import { getMarketTitle } from "@/app/market/marketTypes";
import { ChartPricePoint } from "@/app/market/priceHistory";
import { ClubIcons } from "@/components/player-name";
import { formatDateTime, formatTime } from "@/lib/datetime";

export function statusLabel(status: Market["status"], resolutionOutcome?: string | null): string {
    if (status === "resolved") {
        if (resolutionOutcome === "yes") return "Да";
        if (resolutionOutcome === "no") return "Нет";
        return resolutionOutcome ?? "Разрешён";
    }
    if (status === "cancelled") return "Отменён";
    if (status === "betting_closed") return "Ставки закрыты";
    return "Открыт";
}

export function statusVariant(status: Market["status"], resolutionOutcome?: string | null): "default" | "secondary" | "destructive" | "outline" {
    if (status === "resolved") {
        return resolutionOutcome === "no" ? "secondary" : "default";
    }
    if (status === "cancelled") return "destructive";
    if (status === "betting_closed") return "outline";
    return "default";
}

// payoutMultiplier returns the display coefficient for an outcome price: 1/price,
// i.e. how much a win returns per 1 elo of buying cost (each winning share pays 1).
// Returns null when the price is not usable (defensive — LMSR prices are in (0,1)).
function payoutMultiplier(price: number): number | null {
    if (!Number.isFinite(price) || price <= 0) return null;
    return 1 / price;
}

// formatShares renders share counts without decimals when they are whole
// numbers (live LMSR buys are always whole shares; fractional values only
// exist for backfilled historical data).
function formatShares(v: number): string {
    return Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(1);
}

function PoolBar({ yesPool, noPool, yesPrice, noPrice, yesShares, noShares }: {
    yesPool: number; noPool: number; yesPrice: number; noPrice: number;
    yesShares: number; noShares: number;
}) {
    // The bar reflects the live price (probability) split — p_yes + p_no = 1.
    const yesPct = Math.max(0, Math.min(100, yesPrice * 100));
    const noPct = 100 - yesPct;
    const yesMult = payoutMultiplier(yesPrice);
    const noMult = payoutMultiplier(noPrice);

    return (
        <div className="space-y-1.5">
            <div className="flex h-5 rounded overflow-hidden text-xs font-medium">
                <div
                    className="flex items-center justify-start pl-1.5 bg-green-500 text-white overflow-hidden whitespace-nowrap transition-all"
                    style={{ width: `${yesPct}%` }}
                >
                    {yesPct > 18 && `Да ${Math.round(yesPct)}%`}
                </div>
                <div className="flex items-center justify-end pr-1.5 bg-red-400 text-white overflow-hidden whitespace-nowrap flex-1 transition-all">
                    {noPct > 18 && `Нет ${Math.round(noPct)}%`}
                </div>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
                <div>
                    <div>
                        {yesMult != null && `Коэффициент: ${yesMult.toFixed(1)}x`}
                    </div>
                    <div>
                        Голоса: {formatShares(yesShares)}
                    </div>
                    <div>
                        Потрачено: {yesPool.toFixed(1)}
                    </div>
                </div>
                <div>
                    <div>
                        {noMult != null && `Коэффициент: ${noMult.toFixed(1)}x`}
                    </div>
                    <div>
                        Голоса: {formatShares(noShares)}
                    </div>
                    <div>
                        Потрачено: {noPool.toFixed(1)}
                    </div>
                </div>
            </div>
        </div>
    );
}

// axisTicks derives X-axis tick positions from the unique point timestamps,
// capped at 4 evenly spaced values. Explicit ticks avoid a recharts quirk:
// auto-generated ticks get duplicate React keys when several points share a
// timestamp (e.g. bets placed in the same second).
function axisTicks(points: ChartPricePoint[]): number[] {
    const unique = Array.from(new Set(points.map(p => p.t)));
    if (unique.length <= 4) return unique;
    const step = (unique.length - 1) / 3;
    return [0, 1, 2, 3].map(i => unique[Math.round(i * step)]);
}

// PriceChart renders the yes-outcome probability over time. The price moves in
// discrete steps (one per bet), hence stepAfter; animation is off so live SSE
// appends don't re-animate the whole line.
function PriceChart({ points }: { points: ChartPricePoint[] }) {
    return (
        <ChartContainer
            className="h-36 pt-2 -mx-2 aspect-auto w-full"
            config={{ yes: { label: "Да", color: "#22c55e" } }}
        >
            <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis
                    dataKey="t"
                    type="number"
                    scale="time"
                    domain={["dataMin", "dataMax"]}
                    ticks={axisTicks(points)}
                    tickFormatter={(t: number) => formatTime(new Date(t))}
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    stroke="var(--muted-foreground)"
                />
                <YAxis
                    domain={[0, 1]}
                    ticks={[0, 0.5, 1]}
                    tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                    width={34}
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    stroke="var(--muted-foreground)"
                />
                <ChartTooltip
                    content={(props) => (
                        <ChartTooltipContent
                            active={props.active}
                            payload={props.payload}
                            label={props.label}
                            coordinate={props.coordinate}
                            accessibilityLayer={props.accessibilityLayer}
                            activeIndex={props.activeIndex}
                            // The built-in label resolves to the config label ("Да"),
                            // so read the bet timestamp off the payload datum.
                            labelFormatter={(_, payload) =>
                                formatDateTime(new Date(Number(payload?.[0]?.payload?.t)))}
                            formatter={(value, _name, item) => (
                                <>
                                    <span style={{ color: item.color }}>Да</span>
                                    <span className="font-mono font-medium tabular-nums" style={{ color: item.color }}>
                                        {(Number(value) * 100).toFixed(1)}%
                                    </span>
                                </>
                            )}
                        />
                    )}
                />
                <Line
                    type="stepAfter"
                    dataKey="yesPrice"
                    name="yes"
                    stroke="var(--color-yes)"
                    strokeWidth={2}
                    dot={points.length <= 50 ? { r: 0.5 } : false}
                    isAnimationActive={false}
                />
            </LineChart>
        </ChartContainer>
    );
}

function SettlementList({ details, showFlow = true }: { details: SettlementDetail[]; showFlow?: boolean }) {
    return (
        <div className="space-y-1 pt-2 border-t">
            {details.map(d => {
                const delta = d.earned - d.staked;
                const positive = delta >= 0;
                return (
                    <div key={d.player_id} className="flex justify-between text-xs gap-2">
                        <span className="text-muted-foreground inline-flex items-center gap-1">
                            <ClubIcons playerId={d.player_id} />
                            {d.player_name}
                        </span>
                        <span className="flex gap-2 shrink-0">
                            {showFlow && (
                                <span className="text-muted-foreground">({d.staked.toFixed(1)} → {d.earned.toFixed(1)})</span>
                            )}
                            <span className={`w-10 text-right font-medium ${positive ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                                {positive ? "+" : ""}{delta.toFixed(1)}
                            </span>
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

export function MarketCard({ market, priceHistory, className }: { market: Market; priceHistory?: ChartPricePoint[]; className?: string }) {
    const { players, playerDisplayName } = usePlayers();
    const { games } = useGames();
    const title = getMarketTitle(market, players, games, playerDisplayName);
    const isOpen = market.status === "open";
    const isBettingClosed = market.status === "betting_closed";
    const dateValue = isOpen
        ? market.closes_at
        : isBettingClosed
            ? (market.betting_closed_at ?? market.closes_at)
            : market.resolved_at;
    const date = dateValue ? formatDateTime(dateValue) : null;
    const dateLabel = isOpen ? "Закрывается"
        : isBettingClosed ? "Ставки закрыты"
            : market.status === "cancelled" ? "Отменён"
                : "Разрешён";

    return (
        <Card className={className}>
            <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{title}</CardTitle>
                    <Badge variant={statusVariant(market.status, market.resolution_outcome)} className="shrink-0">
                        {statusLabel(market.status, market.resolution_outcome)}
                    </Badge>
                </div>
                {date && (
                    <p className="text-sm text-muted-foreground">{dateLabel}: {date}</p>
                )}
            </CardHeader>
            <CardContent>
                <PoolBar
                    yesPool={market.yes_pool}
                    noPool={market.no_pool}
                    yesPrice={market.yes_price}
                    noPrice={market.no_price}
                    yesShares={market.yes_shares}
                    noShares={market.no_shares}
                />
                {priceHistory && priceHistory.length > 0 && (
                    <PriceChart points={priceHistory} />
                )}
                {(isOpen || isBettingClosed) && market.guarantors && market.guarantors.length > 0 && (
                    <p className="text-xs text-muted-foreground pt-2">
                        Поручители: {market.guarantors.map(g => g.player_name).join(", ")}
                    </p>
                )}
                {market.settlement && market.settlement.length > 0 && (
                    <div className="space-y-1 pt-2 border-t">
                        <p className="text-xs text-muted-foreground font-medium">Игроки</p>
                        <SettlementList details={market.settlement} />
                    </div>
                )}
                {market.guarantor_settlement && market.guarantor_settlement.length > 0 && (
                    <div className="space-y-1 pt-2 border-t">
                        <p className="text-xs text-muted-foreground font-medium">Поручители</p>
                        <SettlementList details={market.guarantor_settlement} showFlow={false} />
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
