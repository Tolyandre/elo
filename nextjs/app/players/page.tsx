"use client";

import React from "react";
import Link from "next/link";
import { usePlayers } from "./PlayersContext";
import RefreshButton from "../components/RefreshButton";

function LoadingOrError() {
    const { loading, error } = usePlayers();
    if (loading) return <div>Загрузка...</div>;
    if (error) return <div>Ошибка: {error}</div>;
    return null;
}

// New function to render rank change indicator
function RankChangeIndicator({ currentRank, previousRank }: { currentRank: number; previousRank: number | undefined }) {
    const changed = previousRank !== undefined && previousRank !== currentRank;

    if (!changed) return null;

    const delta = previousRank - currentRank;
    const diff = Math.abs(delta);

    if (delta > 0) {
        // Rank improved (number decreased) - show up green
        return (
            <span className="text-green-600 text-sm flex items-center" aria-label={`Rank up ${diff}`}>
                <span className="mr-1">▴</span>
                <span>+{diff}</span>
            </span>
        );
    }

    // Rank worsened (number increased) - show down red
    return (
        <span className="text-red-600 text-sm flex items-center" aria-label={`Rank down ${diff}`}>
            <span className="mr-1">▾</span>
            <span>-{diff}</span>
        </span>
    );
}

function PlayersTable() {
    const { players, loading, error } = usePlayers();
    if (loading || error) return null;
    return (
        <table className="w-full table-auto border-collapse mb-6">
            <tbody>
                {players.map((player) => {
                    return (
                        <tr key={player.id}>
                            <td className="px-1 py-2">
                                <div className="flex items-center gap-2">
                                    <span>{player.rank}</span>
                                    <RankChangeIndicator
                                        currentRank={player.rank}
                                        previousRank={player.rank_day_ago}
                                    />
                                </div>
                            </td>
                            <td className="px-4 py-2">{player.id}</td>
                            <td className="px-1 py-2">{player.elo}</td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}

export default function PlayersPage() {
    const { invalidate } = usePlayers();
    return (
        <main>
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-2xl font-semibold">Игроки</h1>
                <RefreshButton onInvalidate={invalidate} ariaLabel="Refresh players" />
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