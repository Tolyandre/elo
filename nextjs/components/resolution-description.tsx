"use client"
import React from "react";
import { Market } from "@/app/api";
import { usePlayers } from "@/app/players/PlayersContext";
import { useGames } from "@/app/gamesContext";
import { getMarketResolutionDescription } from "@/app/market/marketTypes";

export function ResolutionDescription({ market }: { market: Market }) {
    const { players, playerDisplayName } = usePlayers();
    const { games } = useGames();
    const { yes, no, cancel } = getMarketResolutionDescription(market, players, games, playerDisplayName);

    return (
        <div className="text-sm space-y-1.5 p-3 rounded-lg bg-muted/50">
            <div className="flex gap-2">
                <span className="font-medium text-green-600 dark:text-green-400 shrink-0 w-15">ДА:</span>
                <span className="text-muted-foreground">{yes}</span>
            </div>
            <div className="flex gap-2">
                <span className="font-medium text-red-500 dark:text-red-400 shrink-0 w-15">НЕТ:</span>
                <span className="text-muted-foreground">{no}</span>
            </div>
            <div className="flex gap-2">
                <span className="font-medium text-muted-foreground shrink-0 w-15">Отмена:</span>
                <span className="text-muted-foreground">{cancel}</span>
            </div>
        </div>
    );
}
