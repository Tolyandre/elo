"use client";

import React, { useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePlayers } from "@/app/players/PlayersContext";
import { Match } from "@/app/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { RankIcon } from "@/components/rank-icon";

type MatchCardProps = {
  match: Match;
  roundToInteger?: boolean;
  clickable?: boolean;
};

export const MatchCard = React.memo(function MatchCard({ match, roundToInteger = false, clickable = false }: MatchCardProps) {
  const { playerMap } = usePlayers();
  const router = useRouter();

  const { players, ranks, totalEarn, totalPay } = useMemo(() => {
    const players = Object.entries(match.score)
      .map(([playerId, data]) => {
        const ctxPlayer = playerMap.get(playerId);
        const name = ctxPlayer?.name || "Unknown";
        return {
          name,
          playerId,
          eloPay: data.globalEloPay,
          eloEarn: data.globalEloEarn,
          score: data.score,
          eloChange: data.globalEloPay + data.globalEloEarn,
        };
      })
      .sort((a, b) => b.score - a.score);

    const ranks = players.map((v) => players.findIndex((p) => p.score === v.score) + 1);
    const totalEarn = players.reduce((sum, p) => sum + p.eloEarn, 0) || 1;
    const totalPay = players.reduce((sum, p) => sum + Math.abs(p.eloPay), 0) || 1;

    return { players, ranks, totalEarn, totalPay };
  }, [match.score, playerMap]);

  const handleClick = useCallback(() => {
    if (clickable) {
      router.push(`/match?id=${match.id}`);
    }
  }, [clickable, match.id, router]);

  return (
    <Card
      className={clickable ? "cursor-pointer hover:bg-accent/50 transition-colors" : ""}
      onClick={handleClick}
    >
      <CardHeader>
        <CardTitle className="flex items-center justify-between w-full flex-wrap gap-2">
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
        <ul className="space-y-3">
          {players.map((p, idx) => (
            <li key={p.playerId} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1 mb-1">
                  <RankIcon rank={ranks[idx]} />
                  <span className="truncate text-sm">{p.name}</span>
                </div>

                <div className="relative h-2 bg-gray-200 rounded overflow-hidden">
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

              <div className="text-center text-2xl font-semibold w-12 flex-shrink-0">
                {p.score}
              </div>

              <div className="text-right w-16 flex-shrink-0">
                <div
                  className={`font-semibold text-sm ${
                    p.eloChange > 0 ? "text-green-600" : p.eloChange < 0 ? "text-red-600" : "text-gray-600"
                  }`}
                >
                  {p.eloChange >= 0 ? "+" : ""}
                  {p.eloChange.toFixed(roundToInteger ? 0 : 1)}
                </div>
                <div className="text-xs text-muted-foreground whitespace-nowrap">
                  ({p.eloPay.toFixed(roundToInteger ? 0 : 1)} + {p.eloEarn.toFixed(roundToInteger ? 0 : 1)})
                </div>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}, (prevProps, nextProps) => (
  prevProps.match.id === nextProps.match.id &&
  prevProps.roundToInteger === nextProps.roundToInteger &&
  prevProps.clickable === nextProps.clickable
));
