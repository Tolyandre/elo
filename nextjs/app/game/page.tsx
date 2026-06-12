"use client"
import { Game, GameMatch, getGameMatchesPromise, getGamePromise, Match } from "@/app/api";
import { PageHeader } from "@/app/pageHeaderContext";
import { useSearchParams } from "next/navigation";
import React, { Suspense, useEffect, useState } from "react";
import { usePlayers } from "@/app/players/PlayersContext";
import { useMe } from "@/app/meContext";
import { useSettings } from "@/app/settingsContext";
import { winsNeededForAmateur } from "@/app/eloCalculation";
import { MatchCard } from "@/components/match-card";
import { PendingMatchCard } from "@/components/pending-match-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useOffline } from "@/app/offline/OfflineContext";

// We cannot use /games/<GAME_ID> path in exported application.
// So use query parameters instead /game?id=<GAME_ID>
export default function GamePage() {
  return (
    <Suspense>
      <GameWrapped />
    </Suspense>
  )
}

function GameWrapped() {
  const searchParams = useSearchParams()
  const id = searchParams.get('id')

  const [game, setGame] = useState<Game | null>(null);
  const [gameMatches, setGameMatches] = useState<GameMatch[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(true);
  const { players: allPlayers } = usePlayers();
  const { roundToInteger } = useMe();
  const { pendingMatches } = useOffline();
  const { newbieLeagueGoalGap, startingRatingGameArena, startingElo,
          eloConstK, eloConstD, newbieLeagueEarnedMax, newbieLeagueEarnedTau } = useSettings();

  const [typicalWinsLower, typicalWinsUpper] = winsNeededForAmateur(
    startingElo - startingRatingGameArena,
    newbieLeagueGoalGap, eloConstK, newbieLeagueEarnedMax, newbieLeagueEarnedTau, eloConstD
  );

  useEffect(() => {
    if (!id) return;
    getGamePromise(id)
      .then((data) => {
        setGame(data);
      });
  }, [id]);

  useEffect(() => {
    if (!id) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading indicator before async fetch
    setLoadingMatches(true);
    getGameMatchesPromise(id)
      .then((data) => {
        setGameMatches(data);
      })
      .finally(() => setLoadingMatches(false));
  }, [id]);

  if (!id) {
    return (
      <main className="space-y-8 max-w-sm mx-auto">
        <PageHeader title="Игра" />
        <p className="text-gray-600">Please provide a game id in the query string, e.g. ?id=GAME_ID</p>
      </main>
    );
  }

  // Convert GameMatch to Match format for MatchCard reuse,
  // mapping game Elo values into the score record.
  function toMatchCardFormat(gm: GameMatch): Match {
    const score: Match["score"] = {};
    for (const p of gm.players) {
      score[p.id] = {
        ratingStaked: p.rating_staked,
        ratingEarned: p.rating_earned,
        score: p.score,
        ratingAfter: p.rating_after,
      };
    }
    return {
      id: gm.id,
      game_id: id!,
      game_name: game?.name ?? "",
      date: gm.date,
      score,
      has_markets: false,
    };
  }

  return (
    <main className="max-w-sm mx-auto">
      <div className="space-y-4">
        <div className=" max-w-sm">
          <PageHeader title={game?.name ?? ""} />

          <p className="text-gray-600">Партий: {game?.total_matches}</p>

          <p className="text-sm text-muted-foreground mt-1">
            Это рейтинг по партиям одной игры, рассчитывается независимо от
            общего рейтинга по тем же формулам.
          </p><p className="text-sm text-muted-foreground mt-1">
            Если бы все играли только в {game?.name}, то значения совпадали бы с общим рейтингом.
          </p>
        </div>

        {(["amateur", "newbie"] as const).map((league) => {
          const leaguePlayers = game?.players.filter(p => p.league === league) ?? [];
          const title = league === "amateur" ? "Любители" : "Новички";
          return (
            <div key={league}>
              <h2 className="text-lg font-semibold mb-2 mt-4">{title}</h2>
              {leaguePlayers.length === 0
                ? <p className="text-sm text-muted-foreground mb-2">Нет игроков</p>
                : <table className="table-auto border-collapse mb-2">
                  <tbody>
                    {leaguePlayers.map((player) => (
                      <tr key={player.id}>
                        <td className="px-1 py-2"><span>{player.rank}</span></td>
                        <td className="px-4 py-2">
                          {allPlayers.find(p => p.id === player.id)?.name}
                          {player.wins_needed_for_amateur != null && player.wins_needed_for_amateur > 0 && (
                            <span className="text-xs text-muted-foreground ml-1">
                              ещё ~{player.wins_needed_for_amateur}{player.wins_needed_for_amateur_upper != null && player.wins_needed_for_amateur_upper > player.wins_needed_for_amateur ? `–${player.wins_needed_for_amateur_upper}` : ""} побед
                            </span>
                          )}
                        </td>
                        <td className="px-1 py-2">{player.rating.toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
              {league === "amateur" && (
                <p className="text-xs text-muted-foreground mb-2">
                  Для Лиги Любителей нужно совпадение рейтинга с эло (эло − рейтинг ≤ {newbieLeagueGoalGap}), примерно {typicalWinsLower}–{typicalWinsUpper} побед
                </p>
              )}
            </div>
          );
        })}

        <h2 className="text-xl font-semibold">История партий</h2>
        {pendingMatches
          .filter((pm) => pm.gameId === id)
          .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((pm) => (
            <PendingMatchCard key={pm.clientId} match={pm} />
          ))}
        {loadingMatches ? (
          <>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-xl" />
            ))}
          </>
        ) : (
          [...gameMatches].reverse().map((gm) => (
            <MatchCard key={gm.id} match={toMatchCardFormat(gm)} roundToInteger={roundToInteger} />
          ))
        )}
      </div>
    </main>
  );
}
