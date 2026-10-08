"use client";

import React, { useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePlayers } from "@/app/players/PlayersContext";
import { useGames } from "@/app/gamesContext";
import { useMe } from "@/app/meContext";
import { Match, matchSettled } from "@/app/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GameImage } from "@/components/game-image";
import { RankIcon } from "@/components/rank-icon";
import { ClubIcons } from "@/components/player-name";
import { formatDateTime } from "@/lib/datetime";
import { Trophy } from "lucide-react";

type MatchCardProps = {
  match: Match;
  roundToInteger?: boolean;
  clickable?: boolean;
};

export const MatchCard = React.memo(function MatchCard({ match, roundToInteger = false, clickable = false }: MatchCardProps) {
  const { playerMap, playerDisplayName } = usePlayers();
  const { games } = useGames();
  const { playerId: myPlayerId } = useMe();
  const router = useRouter();

  // The match response carries only the game's name; the image comes from
  // the games list (absent offline-before-first-load — the thumb is optional
  // decoration and simply does not render).
  const gameImage = useMemo(
    () => games.find((g) => g.id === match.game_id)?.image_thumb_url ?? null,
    [games, match.game_id],
  );

  // The settlement columns are scoped to the read's tenant arena and are null
  // when the match did not settle there (ADR-36) — the card hides the rating
  // widgets instead of showing fake zeros for such a match.
  const settled = matchSettled(match);

  const { players, ranks, totalEarn, totalPay } = useMemo(() => {
    const players = Object.entries(match.score)
      .map(([playerId, data]) => {
        const ctxPlayer = playerMap.get(playerId);
        const name = ctxPlayer ? playerDisplayName(ctxPlayer) : "Unknown";
        const ratingStaked = data.ratingStaked ?? 0;
        const ratingEarned = data.ratingEarned ?? 0;
        return {
          name,
          playerId,
          ratingStaked,
          ratingEarned,
          score: data.score,
          ratingChange: ratingStaked + ratingEarned,
          ratingAfter: data.ratingAfter ?? null,
        };
      })
      .sort((a, b) => b.score - a.score);

    const ranks = players.map((v) => players.findIndex((p) => p.score === v.score) + 1);
    const totalEarn = players.reduce((sum, p) => sum + p.ratingEarned, 0) || 1;
    const totalPay = players.reduce((sum, p) => sum + Math.abs(p.ratingStaked), 0) || 1;

    return { players, ranks, totalEarn, totalPay };
  }, [match.score, playerMap, playerDisplayName]);

  const handleClick = useCallback(() => {
    if (clickable) {
      router.push(`/matches/view?id=${match.id}`);
    }
  }, [clickable, match.id, router]);

  // A coop match (ADR-33) has one shared result: no ranks, no per-player
  // scores worth showing (all zeros), no rating deltas.
  if (match.mode === "coop") {
    const won = match.game_won === true;
    return (
      <Card
        className={clickable ? "cursor-pointer hover:bg-accent transition-colors" : ""}
        onClick={handleClick}
      >
        <CardHeader>
          <CardTitle className="flex items-center justify-between w-full flex-wrap gap-2">
            <span className="flex items-center gap-2 min-w-0">
              {gameImage && <GameImage src={gameImage} alt="" className="size-7 shrink-0 rounded" />}
              <Link
                href={`/games/view?id=${match.game_id}`}
                className="underline"
                onClick={(e) => clickable && e.stopPropagation()}
              >
                {match.game_name}
              </Link>
            </span>
            {match.date && (
              <span className="text-muted-foreground text-sm">
                {formatDateTime(match.date)}
              </span>
            )}
          </CardTitle>
        </CardHeader>

        <CardContent>
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant={won ? "default" : "secondary"} className={won ? "bg-success" : ""}>
              {won ? "Победа" : "Поражение"}
            </Badge>
            {match.game_score != null && (
              <span className="text-2xl font-semibold">
                <span className="text-sm font-normal text-muted-foreground">очки: </span>
                {match.game_score}
              </span>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-1">
            {Object.entries(match.score).map(([playerId]) => {
              const ctxPlayer = playerMap.get(playerId);
              const name = ctxPlayer ? playerDisplayName(ctxPlayer) : "Unknown";
              return (
                <span
                  key={playerId}
                  className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                >
                  <ClubIcons playerId={playerId} className="mr-1" />
                  {playerId === myPlayerId ? (
                    <span className="bg-info/15 rounded px-1">{name}</span>
                  ) : (
                    name
                  )}
                </span>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={clickable ? "cursor-pointer hover:bg-accent transition-colors" : ""}
      onClick={handleClick}
    >
      <CardHeader>
        <CardTitle className="flex items-center justify-between w-full flex-wrap gap-2">
          <span className="flex items-center gap-2 min-w-0">
            {gameImage && <GameImage src={gameImage} alt="" className="size-7 shrink-0 rounded" />}
            <Link
              href={`/games/view?id=${match.game_id}`}
              className="underline"
              onClick={(e) => clickable && e.stopPropagation()}
            >
              {match.game_name}
            </Link>
          </span>
          {match.date && (
            <span className="text-muted-foreground text-sm">
              {formatDateTime(match.date)}
            </span>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent>
        <ul className="space-y-3">
          {players.map((p, idx) => (
            <li key={p.playerId} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                {/* Inline flow (not flex) so icons + name + rating wrap together and
                    long names reclaim the full width under the icons. */}
                <div className="mb-1 text-sm">
                  <RankIcon rank={ranks[idx]} className="inline-block align-middle mr-1" />
                  <ClubIcons playerId={p.playerId} className="align-middle mr-1" />
                  {p.playerId === myPlayerId
                    ? <span className="break-words align-middle bg-info/15 rounded px-1">{p.name}</span>
                    : <span className="break-words align-middle">{p.name}</span>}
                  {settled && p.ratingAfter != null && (
                    <span className="text-xs text-muted-foreground align-middle ml-1">{Math.round(p.ratingAfter)}</span>
                  )}
                </div>

                {settled && (
                  <div className="relative h-2 bg-muted rounded overflow-hidden">
                    {/* Earned Elo indicator */}
                    <div
                      className="absolute top-0 h-1 bg-success"
                      style={{ width: `${(p.ratingEarned / totalEarn) * 100}%` }}
                    />
                    {/* Staked rating indicator */}
                    <div
                      className="absolute bottom-0 h-1 bg-destructive"
                      style={{ width: `${(Math.abs(p.ratingStaked) / Math.abs(totalPay)) * 100}%` }}
                    />
                  </div>
                )}
              </div>

              <div className="text-center text-2xl font-semibold w-12 flex-shrink-0">
                {p.score}
              </div>

              {settled && (
                <div className="text-right w-16 flex-shrink-0">
                  <div
                    className={`font-semibold text-sm ${
                      p.ratingChange > 0 ? "text-success" : p.ratingChange < 0 ? "text-destructive" : "text-muted-foreground"
                    }`}
                  >
                    {p.ratingChange >= 0 ? "+" : ""}
                    {p.ratingChange.toFixed(roundToInteger ? 0 : 1)}
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    ({p.ratingStaked.toFixed(roundToInteger ? 0 : 1)} + {p.ratingEarned.toFixed(roundToInteger ? 0 : 1)})
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>

        {(match.camps.length > 0 || match.tournament) && (
          <div className="mt-3 flex flex-wrap gap-1">
            {match.camps.map((c) => (
              <Badge key={c.id} variant="secondary">{c.name}</Badge>
            ))}
            {match.tournament && (
              <Link
                href={`/tournaments/view?id=${match.tournament.id}`}
                onClick={(e) => clickable && e.stopPropagation()}
              >
                <Badge variant="outline" className="gap-1">
                  <Trophy className="h-3 w-3" />
                  {match.tournament.name}
                </Badge>
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
});
