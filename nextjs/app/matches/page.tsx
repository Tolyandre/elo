"use client";

import React from "react";
import Link from "next/link";
import { useMatches, Match } from "./MatchesContext";
import { PlayerCombobox } from "@/components/player-combobox";

export default function MatchesPage() {
  const [selectedPlayerId, setSelectedPlayerId] = React.useState<string | undefined>(undefined);

  function LoadingOrError() {
    const { loading, error } = useMatches();
    if (loading) return <p className="text-center">Загрузка партий…</p>;
    if (error) return <p className="text-red-500 text-center">Ошибка: {error}</p>;
    return null;
  }

  function MatchesList() {
    const { matches } = useMatches();
    if (!matches) return null; // ещё нет данных

    const filtered = selectedPlayerId
      ? matches.filter((m) => Object.prototype.hasOwnProperty.call(m.score, selectedPlayerId))
      : matches

    return (
      <>
        <PlayerCombobox value={selectedPlayerId} onChange={setSelectedPlayerId} />
        {filtered.map((m) => (
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

    const totalEarn = players.map((p) => p.eloEarn).reduce((a, b) => a + b, 0);
    const totalPay = players.map((p) => p.eloPay).reduce((a, b) => a + b, 0);

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

                <div className="relative h-2 bg-gray-200 rounded mt-1 overflow-hidden">

                  {/* Индикатор победных очков */}
                  <div
                    className="absolute top-0 h-1 bg-green-400"
                    style={{ width: `${(p.eloEarn / totalEarn) * 100}%` }}
                  />

                  {/* Индикатор вероятности победы (сколько очко вычитаем) */}
                  <div
                    className="absolute bottom-0 h-1 bg-red-400"
                    style={{ width: `${(p.eloPay / totalPay) * 100}%` }}
                  />

                </div>

              </div>

              {/* Итоговый score */}
              <div className="text-center w-20 text-3xl">{p.score}</div>

              {/* Изменение Elo */}
              <div className="text-right w-21">
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