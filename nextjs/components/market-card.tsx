"use client"
import React from "react";
import { Market, SettlementDetail } from "@/app/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePlayers } from "@/app/players/PlayersContext";
import { useGames } from "@/app/gamesContext";
import { getMarketTitle } from "@/app/market/marketTypes";

export function statusLabel(status: Market["status"], resolutionOutcome?: string | null): string {
    if (status === "resolved") {
        if (resolutionOutcome === "yes") return "Да";
        if (resolutionOutcome === "no") return "Нет";
        return resolutionOutcome ?? "Разрешён";
    }
    if (status === "cancelled") return "Отменён";
    return "Открыт";
}

export function statusVariant(status: Market["status"], resolutionOutcome?: string | null): "default" | "secondary" | "destructive" | "outline" {
    if (status === "resolved") {
        return resolutionOutcome === "no" ? "secondary" : "default";
    }
    if (status === "cancelled") return "destructive";
    return "default";
}

function PoolBar({ yesPool, noPool, yesCoeff, noCoeff }: {
    yesPool: number; noPool: number; yesCoeff: number; noCoeff: number;
}) {
    const total = yesPool + noPool;
    const yesPercent = total > 0 ? (yesPool / total) * 100 : 50;
    const noPercent = 100 - yesPercent;

    return (
        <div className="space-y-1.5">
            <div className="flex h-5 rounded overflow-hidden text-xs font-medium">
                <div
                    className="flex items-center justify-start pl-1.5 bg-green-500 text-white overflow-hidden whitespace-nowrap transition-all"
                    style={{ width: `${yesPercent}%` }}
                >
                    {yesPercent > 15 && `${yesPool.toFixed(1)} (${Math.round(yesPercent)}%)`}
                </div>
                <div className="flex items-center justify-end pr-1.5 bg-red-400 text-white overflow-hidden whitespace-nowrap flex-1 transition-all">
                    {noPercent > 15 && `${noPool.toFixed(1)} (${Math.round(noPercent)}%)`}
                </div>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
                <span>Да {yesCoeff.toFixed(2)}x</span>
                <span>Нет {noCoeff.toFixed(2)}x</span>
            </div>
        </div>
    );
}

function SettlementList({ details }: { details: SettlementDetail[] }) {
    return (
        <div className="space-y-1 pt-2 border-t">
            {details.map(d => {
                const delta = d.earned - d.staked;
                const positive = delta >= 0;
                return (
                    <div key={d.player_id} className="flex justify-between text-xs gap-2">
                        <span className="text-muted-foreground">{d.player_name}</span>
                        <span className="flex gap-2 shrink-0">
                            <span className="text-muted-foreground">({d.staked.toFixed(1)} → {d.earned.toFixed(1)})</span>
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

export function MarketCard({ market, className }: { market: Market; className?: string }) {
    const { players, playerDisplayName } = usePlayers();
    const { games } = useGames();
    const title = getMarketTitle(market, players, games, playerDisplayName);
    const isOpen = market.status === "open";
    const date = isOpen
        ? (market.closes_at ? new Date(market.closes_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null)
        : (market.resolved_at ? new Date(market.resolved_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null);
    const dateLabel = isOpen ? "Закрывается" : market.status === "cancelled" ? "Отменён" : "Разрешён";

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
                    yesCoeff={market.yes_coefficient}
                    noCoeff={market.no_coefficient}
                />
                {market.settlement && market.settlement.length > 0 && (
                    <SettlementList details={market.settlement} />
                )}
            </CardContent>
        </Card>
    );
}
