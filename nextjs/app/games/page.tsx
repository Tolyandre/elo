"use client"
import { getGamesPromise } from "@/app/api";
import Link from "next/link";
import React from "react";
import { PageHeader } from "@/app/pageHeaderContext";
import { useAsyncResource } from "@/hooks/useAsyncResource";

export default function AllGamesList() {
  const { data: games, loading } = useAsyncResource(getGamesPromise);

  if (loading || !games) {
    return (
      <main className="space-y-8 max-w-sm mx-auto">
        <PageHeader title="Игры" />
      </main>
    );
  }

  return (
    <main className="space-y-8 max-w-sm mx-auto">
      <PageHeader title="Игры" />
      <table className="w-full table-auto border-collapse mb-6">
        <tbody>
          {games.games.map((game) => {
            return (
              <tr key={game.id}>
                <td className="px-4 py-2">
                  <Link className="underline" href={`/game?id=${game.id}`}>{game.name}</Link>
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
