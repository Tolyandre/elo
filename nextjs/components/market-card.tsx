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
import { ChartContainer } from "@/components/ui/chart";
import { usePlayers } from "@/app/players/PlayersContext";
import { useGames } from "@/app/gamesContext";
import { getMarketTitle, outcomeDisplayName } from "@/app/markets/marketTypes";
import { outcomeColors } from "@/app/markets/outcomeColors";
import { ChartPricePoint } from "@/app/markets/priceHistory";
import { ClubIcons } from "@/components/player-name";
import { formatDateTime, formatDayMonth, formatTime } from "@/lib/datetime";

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
                {data.map((d) => (
                    <div key={d.id} className="text-xs leading-tight">
                        <div className="flex items-center gap-1.5">
                            <span className="inline-block size-2 rounded-full shrink-0" style={{ background: d.color }} />
                            <span className="font-medium truncate">{d.name}</span>
                            <span className="ml-auto font-mono tabular-nums text-muted-foreground shrink-0">{Math.round(d.value)}%</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// axisTicks picks ≤4 evenly spaced point indices for the X axis. Indices are
// unique by construction (same-second bets get distinct positions), so this
// only avoids label clutter.
function axisTicks(count: number): number[] {
    if (count <= 4) return Array.from({ length: Math.max(count, 1) }, (_, i) => i);
    const step = (count - 1) / 3;
    return [0, 1, 2, 3].map(i => Math.round(i * step));
}

// PriceChart renders every outcome's probability over time, one step line per
// outcome. Prices move in discrete steps (one per bet), hence stepAfter;
// animation is off so live SSE appends don't re-animate the whole chart.
function PriceChart({ points, outcomes, nameOf }: { points: ChartPricePoint[]; outcomes: MarketOutcome[]; nameOf: (o: MarketOutcome) => string }) {
    const colors = outcomeColors(outcomes);
    // X position is the point index (equal spacing regardless of bet timing);
    // the real bet timestamp travels along as `time` for ticks and the tooltip.
    const rows = points.map((p, i) => ({ t: i, time: p.t, ...p.prices }));
    // Precomputed per-tick labels: time for every tick, prefixed with the day
    // on the first tick of each day, so multi-day histories stay readable.
    // Precomputing (instead of deriving inside tickFormatter) keeps the
    // formatter pure — recharts may call it multiple times per tick.
    const tickIdxs = axisTicks(rows.length);
    const tickLabels = new Map<number, string>();
    let lastDay = "";
    for (const i of tickIdxs) {
        const d = new Date(points[i]?.t ?? 0);
        const day = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        tickLabels.set(i, day === lastDay ? formatTime(d) : `${formatDayMonth(d)} ${formatTime(d)}`);
        lastDay = day;
    }
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
                    domain={["dataMin", "dataMax"]}
                    ticks={tickIdxs}
                    tickFormatter={(t: number) => tickLabels.get(t) ?? ""}
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    stroke="var(--muted-foreground)"
                />
                <YAxis
                    // domain={[0, 1]}
                    domain={["dataMin", "dataMax"]}
                    // ticks={[0, 0.5, 1]}
                    tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                    width={34}
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    stroke="var(--muted-foreground)"
                />
                {outcomes.map((o) => (
                    <Line
                        key={o.id}
                        type="monotone"
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
                    {/* Open is the unremarkable default — only final/intermediate
                        statuses get a badge. */}
                    {!isOpen && (
                        <Badge variant={statusVariant(market)} className="shrink-0">
                            {statusLabel(market, resolutionOutcomeName)}
                        </Badge>
                    )}
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
