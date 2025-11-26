"use client";

import Link from "next/link";
import { useMatches, Match } from "./MatchesContext";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useState } from "react";

export default function MatchesPage() {

  const [blueIndicatorMode, setBlueIndicatorMode] = useState(false);

  function LoadingOrError() {
    const { loading, error } = useMatches();
    if (loading) return <p className="text-center">Загрузка партий…</p>;
    if (error) return <p className="text-red-500 text-center">Ошибка: {error}</p>;
    return null;
  }

  function MatchesList() {
    const { matches } = useMatches();
    if (!matches) return null; // ещё нет данных

    return (
      <>
        <div className="flex items-center space-x-2">
          <Switch id="blue-indicator-mode" checked={blueIndicatorMode} onCheckedChange={setBlueIndicatorMode} />
          <Label htmlFor="blue-indicator-mode">Синяя полоска считается по сумме (вместо максимума)</Label>
        </div>
        {matches.map((m) => (
          <MatchCard key={m.id} match={m} />
        ))}
      </>
    );
  }

  function MatchCard({ match }: { match: Match }) {
    const players = Object.entries(match.score)
      .map(([name, data]) => ({
        name,
        eloPay: data.eloPay,
        eloEarn: data.eloEarn,
        score: data.score,
        eloChange: data.eloPay + data.eloEarn,
      }))
      .sort((a, b) => b.score - a.score);

    const ranks = players.map((v) => players.findIndex((p) => p.score === v.score) + 1);

    const maxEarn = blueIndicatorMode
      ? players.map((p) => p.eloEarn).reduce((a, b) => a + b, 0)
      : Math.max(...players.map((p) => p.eloEarn));

    return (
      <div className="border border-gray-200 rounded p-4">
        <h2 className="text-xl font-medium mb-2">
          <Link href={`/game?id=${match.game}`} className="underline">
            {match.game}
          </Link>
        </h2>

        <ul className="space-y-2">
          {players.map((p, idx) => (
            <li
              key={p.name}
              className="flex items-center gap-1 py-1 rounded transition-colors"
            >
              {/* Игрок */}
              <div className="gap-2 min-w-40">
                <span className="font-semibold">{ranks[idx]}. </span>
                <span>{p.name}</span>

                <div className="h-2 bg-gray-200 rounded mt-1">
                  <div
                    style={{ width: `${(p.eloEarn / maxEarn) * 100}%` }}
                    className="h-full bg-blue-400 rounded"
                  />
                </div>
              </div>

              {/* Итоговый score */}
              <div className="text-center w-20 text-3xl">{p.score}</div>

              {/* Изменение Elo */}
              <div className="text-right w-20">
                <span
                  className={`font-semibold ${p.eloChange > 0
                    ? "text-green-600"
                    : p.eloChange < 0
                      ? "text-red-600"
                      : "text-gray-600"
                    }`}
                >
                  {p.eloChange >= 0 ? "+" : ""}
                  {p.eloChange.toFixed(1)}
                </span>
                <br />
                <span className="text-xs text-gray-500">
                  ({p.eloPay.toFixed(1)} + {p.eloEarn.toFixed(1)})
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <main className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold mb-4 mx-auto">Партии</h1>
      </div>
      <Link
        href="/add-match"
        className="inline-block bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-center w-full"
      >
        Добавить партию
      </Link>

      <LoadingOrError />
      <MatchesList />
    </main>
  );
}