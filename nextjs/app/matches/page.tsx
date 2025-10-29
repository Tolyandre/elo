"use client";

import Link from "next/link";
import { useMatches, Match } from "./MatchesContext";

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
  const maxEarn = Math.max(...players.map((p) => p.eloEarn));

  return (
    <div className="border border-gray-200 rounded p-4">
      <h2 className="text-xl font-medium mb-2">
        <Link href={`/games?id=${match.game}`} className="underline">
          {match.game}
        </Link>
      </h2>

      <ul className="space-y-2">
        {players.map((p, idx) => (
          <li
            key={p.name}
            className="flex items-center gap-4 px-2 py-1 rounded transition-colors"
          >
            {/* Список игроков */}
            <div className="gap-2 min-w-[100px]">
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
            <div className="text-center min-w-[50px] text-3xl">{p.score}</div>

            {/* Изменение Elo */}
            <div className="text-right min-w-[60px]">
              <span
                className={`font-semibold ${
                  p.eloChange > 0
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

export default function MatchesPage() {
  return (
      <main className="space-y-8">
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