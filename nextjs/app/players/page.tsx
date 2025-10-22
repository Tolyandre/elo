"use client";

import React from "react";
import Link from "next/link";
import { usePlayers } from "./PlayersContext";
import { deleteCache } from "../api";

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

    const onRefresh = async () => {
        await deleteCache();
        // trigger local refetch
        invalidate();
    };
    return (
        <main>
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-2xl font-semibold">Игроки</h1>
                <button
                    onClick={onRefresh}
                    aria-label="Refresh players"
                    className="ml-3 p-2 rounded text-gray-700 hover:bg-gray-200"
                    title="Обновить"
                >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
                        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M21 3V8M21 8H16M21 8L18 5.29168C16.4077 3.86656 14.3051 3 12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21C16.2832 21 19.8675 18.008 20.777 14"/>
                    </svg>
                </button>
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