"use client"
import React from "react";
import {
    CartesianGrid,
    Cell,
    Line,
    LineChart,
    Pie,
    PieChart,
    XAxis,
    YAxis,
} from "recharts";
import { Market, MarketOutcome, SettlementDetail } from "@/app/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from "@/components/ui/chart";
import { usePlayers } from "@/app/players/PlayersContext";
import { useGames } from "@/app/gamesContext";
import { getMarketTitle, outcomeDisplayName } from "@/app/market/marketTypes";
import { outcomeColors } from "@/app/market/outcomeColors";
import { ChartPricePoint } from "@/app/market/priceHistory";
import { ClubIcons } from "@/components/player-name";
import { formatDateTime, formatTime } from "@/lib/datetime";

export function statusLabel(market: Market, resolutionOutcomeName?: string | null): string {
    if (market.status === "resolved") {
        return resolutionOutcomeName ?? "Разрешён";
    }
    if (market.status === "cancelled") return "Отменён";
    if (market.status === "betting_closed") return "Ставки закрыты";
    return "Открыт";
}

export function statusVariant(market: Market): "default" | "secondary" | "destructive" | "outline" {
    if (market.status === "cancelled") return "destructive";
    if (market.status === "betting_closed") return "outline";
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

// OutcomeDonut renders the live probability split as a circle graph: one
// segment per outcome, sized by its LMSR price (the segments sum to 100%).
function OutcomeDonut({ market, nameOf }: { market: Market; nameOf: (o: MarketOutcome) => string }) {
    const colors = outcomeColors(market.outcomes);
    const data = market.outcomes.map((o) => ({
        id: o.id,
        name: nameOf(o),
        value: Math.max(o.price, 0) * 100,
        color: colors.get(o.id) ?? "#94a3b8",
    }));

    return (
        <div className="flex items-center gap-3">
            <ChartContainer
                className="h-28 w-28 shrink-0 aspect-square"
                config={Object.fromEntries(data.map((d) => [d.id, { label: d.name, color: d.color }]))}
            >
                <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <ChartTooltip
                        content={(props) => (
                            <ChartTooltipContent
                                active={props.active}
                                payload={props.payload}
                                label={props.label}
                                coordinate={props.coordinate}
                                accessibilityLayer={props.accessibilityLayer}
                                activeIndex={props.activeIndex}
                                formatter={(value, _name, item) => (
                                    <>
                                        <span style={{ color: item.color }}>{item.payload?.name}</span>
                                        <span className="font-mono font-medium tabular-nums" style={{ color: item.color }}>
                                            {Number(value).toFixed(0)}%
                                        </span>
                                    </>
                                )}
                            />
                        )}
                    />
                    <Pie
                        data={data}
                        dataKey="value"
                        nameKey="name"
                        innerRadius="55%"
                        outerRadius="100%"
                        paddingAngle={data.length > 1 ? 1 : 0}
                        stroke="var(--card)"
                        strokeWidth={2}
                        isAnimationActive={false}
                    >
                        {data.map((d) => (
                            <Cell key={d.id} fill={d.color} />
                        ))}
                    </Pie>
                </PieChart>
            </ChartContainer>
            <div className="flex-1 min-w-0 space-y-1.5">
                {data.map((d, i) => {
                    const o = market.outcomes[i];
                    const mult = payoutMultiplier(o.price);
                    return (
                        <div key={d.id} className="text-xs leading-tight">
                            <div className="flex items-center gap-1.5">
                                <span className="inline-block size-2 rounded-full shrink-0" style={{ background: d.color }} />
                                <span className="font-medium truncate">{d.name}</span>
                                <span className="text-muted-foreground  flex gap-2"> {mult != null && <span>×{mult.toFixed(1)}</span>}</span>
                                <span className="ml-auto font-mono tabular-nums text-muted-foreground shrink-0">{Math.round(d.value)}%</span>
                            </div>
                            <div className="text-muted-foreground pl-3.5 flex gap-2">
                                {/* <span>Голоса: {formatShares(o.shares)}</span>
                                <span>Потрачено: {o.pool.toFixed(1)}</span> */}
                            </div>
                        </div>
                    );
                })}
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

// PriceChart renders every outcome's probability over time, one step line per
// outcome. Prices move in discrete steps (one per bet), hence stepAfter;
// animation is off so live SSE appends don't re-animate the whole chart.
function PriceChart({ points, outcomes, nameOf }: { points: ChartPricePoint[]; outcomes: MarketOutcome[]; nameOf: (o: MarketOutcome) => string }) {
    const colors = outcomeColors(outcomes);
    const rows = points.map((p) => ({ t: p.t, ...p.prices }));
    return (
        <ChartContainer
            className="h-36 pt-2 -mx-2 aspect-auto w-full"
            config={Object.fromEntries(outcomes.map((o) => [o.id, { label: nameOf(o), color: colors.get(o.id) ?? "#94a3b8" }]))}
        >
            <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
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
                            // The built-in label resolves to a config label, so
                            // read the bet timestamp off the payload datum.
                            labelFormatter={(_, payload) =>
                                formatDateTime(new Date(Number(payload?.[0]?.payload?.t)))}
                            formatter={(value, name) => (
                                <>
                                    <span style={{ color: colors.get(String(name)) }}>
                                        {outcomes.find((o) => o.id === name) ? nameOf(outcomes.find((o) => o.id === String(name))!) : String(name)}
                                    </span>
                                    <span className="font-mono font-medium tabular-nums" style={{ color: colors.get(String(name)) }}>
                                        {(Number(value) * 100).toFixed(1)}%
                                    </span>
                                </>
                            )}
                        />
                    )}
                />
                {outcomes.map((o) => (
                    <Line
                        key={o.id}
                        type="stepAfter"
                        dataKey={o.id}
                        name={o.id}
                        stroke={colors.get(o.id) ?? "#94a3b8"}
                        strokeWidth={2}
                        dot={points.length <= 50 ? { r: 0.1 } : false}
                        isAnimationActive={false}
                    />
                ))}
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
    const nameOf = React.useCallback(
        (o: MarketOutcome) => outcomeDisplayName(o, players, playerDisplayName),
        [players, playerDisplayName],
    );
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
    const resolutionOutcomeName = market.status === "resolved" && market.resolution_outcome_id
        ? nameOf(market.outcomes.find((o) => o.id === market.resolution_outcome_id) ?? {
            id: market.resolution_outcome_id,
            kind: "other" as const,
            name: "Разрешён",
            price: 0,
            shares: 0,
            pool: 0,
        })
        : undefined;

    return (
        <Card className={className}>
            <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{title}</CardTitle>
                    <Badge variant={statusVariant(market)} className="shrink-0">
                        {statusLabel(market, resolutionOutcomeName)}
                    </Badge>
                </div>
                {date && (
                    <p className="text-sm text-muted-foreground">{dateLabel}: {date}</p>
                )}
            </CardHeader>
            <CardContent>
                <OutcomeDonut market={market} nameOf={nameOf} />
                {priceHistory && priceHistory.length > 0 && (
                    <PriceChart points={priceHistory} outcomes={market.outcomes} nameOf={nameOf} />
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
