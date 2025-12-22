"use client";

import React from "react";
import Link from "next/link";
import { usePlayers } from "./PlayersContext";
import { useState } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";

function LoadingOrError() {
    const { loading, error } = usePlayers();
    if (loading) return <div>Загрузка...</div>;
    if (error) return <div>Ошибка: {error}</div>;
    return null;
}

function RankChangeIndicator({ currentRank, previousRank }: { currentRank: number; previousRank: number | undefined }) {
    const changed = previousRank !== undefined && previousRank !== currentRank;

    if (!changed) return null;

    const delta = previousRank - currentRank;
    const diff = Math.abs(delta);

    if (delta > 0) {
        // Rank improved (number decreased) - show up green
        return (
            <span className="text-green-600 text-xs" aria-label={`Rank up ${diff}`}>
                <span className="mr-1">▴</span>
                <span>{diff}</span>
            </span>
        );
    }

    // Rank worsened (number increased) - show down red
    return (
        <span className="text-red-600 text-xs" aria-label={`Rank down ${diff}`}>
            <span className="mr-1">▾</span>
            <span>{diff}</span>
        </span>
    );
}

function EloValueAndDiff({ currentElo, previousElo }: { currentElo: number; previousElo: number }) {
    const diff = currentElo - previousElo;
    if (diff === 0) return (
        <>
            {currentElo.toFixed(0)}
        </>
    )
    return (
        <span className="line-clamp-1">
            {currentElo.toFixed(0)} <span className="text-sm text-gray-500">({diff > 0 ? "+" : ""}{diff.toFixed(1)})</span>
        </span>
    )
}

function PlayersTable() {
    const { players, loading, error } = usePlayers();
    const [period, setPeriod] = useLocalStorage<"day" | "week">("players-period", "day");
    if (loading || error) return null;
    return (
        <>
            <div className="flex gap-2 items-center mb-3">
                <a
                    href="#"
                    onClick={(e) => {
                        e.preventDefault();
                        setPeriod("day");
                    }}
                    className={`px-3 py-1 rounded ${period === "day" ? "" : "text-blue-600 underline decoration-dashed"}`}
                >
                    за день
                </a>
                <a
                    href="#"
                    onClick={(e) => {
                        e.preventDefault();
                        setPeriod("week");
                    }}
                    className={`px-3 py-1 rounded ${period === "week" ? "" : "text-blue-600 underline decoration-dashed"}`}
                >
                    за неделю
                </a>
            </div>
            <table className="table-auto border-collapse mb-6">
                <tbody>
                    {players.map((player) => {
                        return (
                            <tr key={player.id}>
                                <td className="py-2 text-center align-top min-w-7">{player.now.rank}</td>
                                <td className="py-2 text-center align-top min-w-7">
                                    <RankChangeIndicator
                                        currentRank={player.now.rank}
                                        previousRank={period === "day" ? player.day_ago.rank : player.week_ago.rank}
                                    />
                                </td>
                                <td className="py-2 px-1 min-w-50">{player.id}</td>
                                <td className="py-2 px-1 align-top min-w-25">
                                    <EloValueAndDiff currentElo={player.now.elo} previousElo={period === "day" ? player.day_ago.elo : player.week_ago.elo} />
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </>
    );
}

export default function PlayersPage() {
    return (
        <main>
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-semibold mb-4 mx-auto">Игроки</h1>
            </div>
            <LoadingOrError />
            <PlayersTable />
            <Link
                href="/add-match"
                className="inline-block bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-center w-full"
            >
                Добавить партию
            </Link>
        </main>
    );
}
