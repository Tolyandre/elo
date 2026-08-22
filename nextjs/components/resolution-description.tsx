"use client"
import React from "react";
import { Market } from "@/app/api";
import { usePlayers } from "@/app/players/PlayersContext";
import { useGames } from "@/app/gamesContext";
import { getMarketResolutionDescription } from "@/app/market/marketTypes";
import { outcomeColors } from "@/app/market/outcomeColors";

export function ResolutionDescription({ market }: { market: Market }) {
    const { players, playerDisplayName } = usePlayers();
    const { games } = useGames();
    const { outcomes, cancel } = getMarketResolutionDescription(market, players, games, playerDisplayName);
    const colors = outcomeColors(market.outcomes);
    const resolvedOutcome = market.status === "resolved" ? market.resolution_outcome_id : null;

    return (
        <div className="text-sm space-y-1.5 p-3 rounded-lg bg-muted/50">
            {outcomes.map((o) => {
                const isWinner = resolvedOutcome != null && resolvedOutcome === o.id;
                // The label uses the outcome's chart color so the description
                // rows and the chart/donut lines are visually paired.
                const color = colors.get(o.id) ?? "var(--muted-foreground)";
                return (
                    <div key={o.id} className="flex gap-2">
                        <span
                            className={`font-medium shrink-0 w-20 truncate ${isWinner ? "" : "opacity-80"}`}
                            style={{ color }}
                            title={o.label}
                        >
                            {isWinner ? "✓ " : ""}{o.label}:
                        </span>
                        <span className="text-muted-foreground">{o.node}</span>
                    </div>
                );
            })}
            <div className="flex gap-2">
                <span className="font-medium text-muted-foreground shrink-0 w-20">Отмена:</span>
                <span className="text-muted-foreground">{cancel}</span>
            </div>
        </div>
    );
}
