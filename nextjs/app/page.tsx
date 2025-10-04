"use client";

import React from "react";
import Link from "next/link";
import { usePlayers } from "./PlayersContext";

function LoadingOrError() {
    const { loading, error } = usePlayers();
    if (loading) return <div>Загрузка...</div>;
    if (error) return <div>Ошибка: {error}</div>;
    return null;
}

function PingError() {
    const { pingError } = usePlayers();
    if (pingError) return <div>Сервер хостится на ПК и бывает выключен. Попробуйте утром</div>;
    return null;
}

function PlayersTable() {
    const { players, loading, error, pingError } = usePlayers();
    if (loading || error || pingError) return null;
    return (
        <table className="w-full table-auto border-collapse mb-6">
            <tbody>
                {players.map((player) => (
                    <tr key={player.id}>
                        <td className="px-4 py-2">{player.id}</td>
                        <td className="px-4 py-2">{player.elo}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export default function PlayersPage() {
    return (
        <div className="min-h-screen flex items-center justify-center">
            <main className="font-sans items-center p-8 rounded-lg shadow-md max-w-sm w-full">
                <h1 className="text-2xl font-semibold mb-4">Игроки</h1>
                <LoadingOrError />
                <PingError />
                <PlayersTable />
                <Link
                    href="/add-game"
                    className="inline-block bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-center w-full"
                >
                    Добавить игру
                </Link>
            </main>
        </div>
    );
}