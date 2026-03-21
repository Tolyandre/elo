"use client"
import { Game, GameMatch, getGameMatchesPromise, getGamePromise, Match } from "@/app/api";
import { useSearchParams } from "next/navigation";
import React, { Suspense, useEffect, useState } from "react";
import { usePlayers } from "@/app/players/PlayersContext";
import { useMe } from "@/app/meContext";
import { MatchCard } from "@/components/match-card";
import { Skeleton } from "@/components/ui/skeleton";

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

  if (!id) {
    return (
      <main className="space-y-8">
        <h1 className="text-2xl font-semibold mb-4">Missing game id</h1>
        <p className="text-gray-600">Please provide a game id in the query string, e.g. ?id=GAME_ID</p>
      </main>
    );
  }

  const [game, setGame] = useState<Game | null>(null);
  const [gameMatches, setGameMatches] = useState<GameMatch[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(true);
  const { players: allPlayers } = usePlayers();
  const { roundToInteger } = useMe();

  useEffect(() => {
    getGamePromise(id)
      .then((data) => {
        setGame(data);
      });
  }, [id]);

  useEffect(() => {
    setLoadingMatches(true);
    getGameMatchesPromise(id)
      .then((data) => {
        setGameMatches(data);
      })
      .finally(() => setLoadingMatches(false));
  }, [id]);

  // Convert GameMatch to Match format for MatchCard reuse,
  // mapping game Elo values into the score record.
  function toMatchCardFormat(gm: GameMatch): Match {
    const score: Match["score"] = {};
    for (const p of gm.players) {
      score[p.id] = {
        globalEloPay: p.game_elo_pay,
        globalEloEarn: p.game_elo_earn,
        score: p.score,
      };
    }
    return {
      id: gm.id,
      game_id: id!,
      game_name: game?.name ?? "",
      date: gm.date,
      score,
    };
  }

  return (
    <main>
      <div className="space-y-4">
        <div className=" max-w-sm">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold mb-2 mx-auto">{game?.name}</h1>
          </div>

          <p className="text-gray-600">Партий: {game?.total_matches}</p>

          <p className="text-sm text-muted-foreground mt-1">
            Это рейтинг по партиям одной игры, рассчитывается независимо от
            общего рейтинга по тем же формулам.
          </p><p className="text-sm text-muted-foreground mt-1">
            Если бы все играли только в {game?.name}, то значения совпадали бы с общим рейтингом.
          </p>
        </div>

        <table className="table-auto border-collapse">
          <tbody>
            {game?.players.map((player) => {
              return (
                <tr key={player.id}>
                  <td className="px-1 py-2">
                    <div className="flex items-center gap-2">
                      <span>{player.rank}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2">{allPlayers.find(p => p.id === player.id)?.name}</td>
                  <td className="px-1 py-2">{player.elo.toFixed(0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <h2 className="text-xl font-semibold">История партий</h2>
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
