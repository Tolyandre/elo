"use client"
import { GameList, getGamesPromise } from "@/app/api";
import Link from "next/link";
import React, { useEffect, useState } from "react";

export default function AllGamesList() {
  const [games, setGames] = useState<GameList | null>(null);

  useEffect(() => {
    getGamesPromise()
      .then((data) => {
        setGames(data);
      });
  }, []);

  if (!games) {
    return (
      <main className="space-y-8">
        <h1 className="text-2xl font-semibold mb-4">Loading games...</h1>
      </main>
    );
  }

  return (
    <main className="space-y-8">
      <h1 className="text-2xl font-semibold mb-4">Игры</h1>
      <table className="w-full table-auto border-collapse mb-6">
        <tbody>
          {games.games.map((game) => {
            return (
              <tr key={game.id}>
                <td className="px-4 py-2">
                  <Link className="underline" href={`/game?id=${game.id}`}>{game.id}</Link>
                </td>
                <td className="px-4 py-2">{game.total_matches}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}

