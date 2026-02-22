"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePlayers } from "@/app/players/PlayersContext";
import { Match } from "@/app/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

type MatchCardProps = {
  match: Match;
  roundToInteger?: boolean;
  clickable?: boolean;
  compact?: boolean;
};

export function MatchCard({ match, roundToInteger = false, clickable = false, compact = false }: MatchCardProps) {
  const { players: playersFromContext = [] } = usePlayers();
  const router = useRouter();

  const players = Object.entries(match.score)
    .map(([playerId, data]) => {
      const ctxPlayer = playersFromContext.find((p) => p.id === playerId);
      const name = ctxPlayer?.name || "Unknown";
      return {
        name,
        playerId,
        eloPay: data.eloPay,
        eloEarn: data.eloEarn,
        score: data.score,
        eloChange: data.eloPay + data.eloEarn,
      };
    })
    .sort((a, b) => b.score - a.score);

  const ranks = players.map((v) => players.findIndex((p) => p.score === v.score) + 1);

  const totalEarn = players.map((p) => p.eloEarn).reduce((a, b) => a + b, 0) || 1;
  const totalPay = players.map((p) => p.eloPay).reduce((a, b) => a + b, 0) || 1;

  const handleClick = () => {
    if (clickable) {
      router.push(`/match?match_id=${match.id}`);
    }
  };

  return (
    <Card
      className={clickable ? "cursor-pointer hover:bg-accent/50 transition-colors" : ""}
      onClick={handleClick}
    >
      <CardHeader>
        <CardTitle className="flex items-center justify-between w-full">
          <Link
            href={`/game?id=${match.game_id}`}
            className="underline"
            onClick={(e) => clickable && e.stopPropagation()}
          >
            {match.game_name}
          </Link>
          {match.date && (
            <span className="text-muted-foreground text-sm">
              {match.date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            </span>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent>
        <ul className={compact ? "space-y-2" : "space-y-4"}>
          {players.map((p, idx) => (
            <li key={p.playerId} className="flex items-center gap-4">
              <div className={compact ? "gap-2 w-30" : "flex-1"}>
                <div className={compact ? "" : "flex items-center gap-2 mb-1"}>
                  <span className="font-semibold">{ranks[idx]}. </span>
                  <span>{p.name}</span>
                </div>

                <div className="relative h-2 bg-gray-200 rounded mt-1 overflow-hidden">
                  {/* Earned Elo indicator */}
                  <div
                    className="absolute top-0 h-1 bg-green-400"
                    style={{ width: `${(p.eloEarn / totalEarn) * 100}%` }}
                  />
                  {/* Paid Elo indicator */}
                  <div
                    className="absolute bottom-0 h-1 bg-red-400"
                    style={{ width: `${(Math.abs(p.eloPay) / Math.abs(totalPay)) * 100}%` }}
                  />
                </div>
              </div>

              <div className={`text-center ${compact ? "w-15 text-3xl" : "w-20 text-3xl font-semibold"}`}>
                {p.score}
              </div>

              <div className={`text-right ${compact ? "w-15" : "w-24"}`}>
                <div
                  className={`font-semibold ${compact ? "" : "text-lg"} ${
                    p.eloChange > 0 ? "text-green-600" : p.eloChange < 0 ? "text-red-600" : "text-gray-600"
                  }`}
                >
                  {p.eloChange >= 0 ? "+" : ""}
                  {p.eloChange.toFixed(roundToInteger ? 0 : 1)}
                </div>
                <div className="text-xs text-muted-foreground text-nowrap">
                  ({p.eloPay.toFixed(roundToInteger ? 0 : 1)} + {p.eloEarn.toFixed(roundToInteger ? 0 : 1)})
                </div>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
