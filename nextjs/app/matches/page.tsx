/* app/matches/page.tsx (или src/app/matches/page.tsx) */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getMatchesPromise } from "../api";

type PlayerScore = {
  eloPay: number;
  eloEarn: number;
  score: number;
};

type Match = {
  id: number;
  game: string;
  date: string | null;
  score: Record<string, PlayerScore>;
};

type MatchPlayer = {
  name: string;
  eloPay: number;
  eloEarn: number;
  score: number;
  eloChange: number;
};

const fetchMatches = async (): Promise<Match[]> => {
//   const res = await fetch("/matches");
//   if (!res.ok) {
//     throw new Error(`Ошибка ${res.status}`);
//   }
//   return res.json();
  return getMatchesPromise();
};
 

export default function MatchesPage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchMatches();
        const sorted = data.sort((a, b) => b.id - a.id);
        setMatches(sorted);
      } catch (e: any) {
        setError(e.message ?? "Неизвестная ошибка");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) return <p className="text-center">Загрузка партий…</p>;
  if (error) return <p className="text-red-500 text-center">Ошибка: {error}</p>;

  return (
    <main className="space-y-8">
      <h1 className="text-2xl font-semibold mb-4">Партии</h1>
      <Link
        href="/add-game"
        className="inline-block bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-center w-full"
      >
        Добавить партию
      </Link>
      {matches.map((m) => (
        <MatchCard key={m.id} match={m} />
      ))}
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Компонент, который отрисовывает один матч */
function MatchCard({ match }: { match: Match }) {
  // Преобразуем объект score в массив и отсортируем по score
  const players: MatchPlayer[] = Object.entries(match.score)
    .map(([name, data]) => ({
      name,
      eloPay: data.eloPay,
      eloEarn: data.eloEarn,
      score: data.score,
      eloChange: data.eloPay + data.eloEarn,
    }))
    .sort((a, b) => b.score - a.score);

  // Для bar‑диаграммы найдём максимум по eloEarn
  const maxEarn = Math.max(...players.map((p) => p.eloEarn));

  return (
    <div className="border border-gray-200 rounded p-4">{/* bg-white */}
      <h2 className="text-xl font-medium mb-2">{match.game}</h2>

      <ul className="space-y-2">
        {players.map((p, idx) => (
          <li
            key={p.name}
            className="flex items-center justify-between gap-4 px-2 py-1 rounded hover:bg-gray-50 transition-colors"
          >
            {/* Список игроков */}
            <div className="flex items-center gap-2 min-w-[140px]">
              <span className="font-semibold">{idx + 1}.</span>
              <span>{p.name}</span>
            </div>

            {/* Итоговый score */}
            <div className="text-center min-w-[50px]">{p.score}</div>

            {/* Изменение Elo */}
            <div className="text-right min-w-[110px]">
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

            {/* Бар‑диаграмма */}
            <div className="flex-1 h-4 bg-gray-200 rounded">
              <div
                style={{ width: `${(p.eloEarn / maxEarn) * 100}%` }}
                className="h-full bg-blue-400 rounded"
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}