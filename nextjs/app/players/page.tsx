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

function PlayersTable() {
    const { players, loading, error } = usePlayers();
    if (loading || error) return null;
    return (
        <table className="w-full table-auto border-collapse mb-6">
            <tbody>
                {players.map((player) => (
                    <tr key={player.id}>
                        <td className="px-1 py-2">{player.rank}</td>
                        <td className="px-4 py-2">{player.id}</td>
                        <td className="px-1 py-2">{player.elo}</td>
                    </tr>
                ))}
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