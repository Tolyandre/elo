"use client"
import { Game, getGamePromise } from "@/app/api";
import { useSearchParams } from "next/navigation";
import React, { Suspense, useEffect, useState } from "react";

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

  useEffect(() => {
    getGamePromise(id)
      .then((data) => {
        setGame(data);
      });
  }, [id]);

  return (
    <main className="space-y-8">
      <h1 className="text-2xl font-semibold mb-4">{game?.id}</h1>
      <p className="text-gray-600">Партий: {game?.total_matches}</p>

      <table className="w-full table-auto border-collapse mb-6">
        <tbody>
          {game?.players.map((player) => {
            return (
              <tr key={player.id}>
                <td className="px-1 py-2">
                  <div className="flex items-center gap-2">
                    <span>{player.rank}</span>
                  </div>
                </td>
                <td className="px-4 py-2">{player.id}</td>
                <td className="px-1 py-2">{player.elo.toFixed(0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
