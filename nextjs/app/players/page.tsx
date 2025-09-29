"use client";

import React, { useEffect, useState } from "react";

type Player = {
    id: string;
    elo: number;
};

export default function PlayersPage() {
    const [players, setPlayers] = useState<Player[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [pingError, setPingError] = useState(false);

    useEffect(() => {
        fetch("https://toly.is-cool.dev/elo-web-service/players")
            .then((res) => {
                if (!res.ok) throw new Error("Failed to fetch players");
                return res.json();
            })
            .then((data) => {
                const sorted = [...data].sort((a, b) => b.elo - a.elo);
                setPlayers(sorted);
                setLoading(false);
            })
            .catch((err) => {
                setError(err.message);
                setLoading(false);
            });

        fetch("https://toly.is-cool.dev/elo-web-service/ping")
            .catch((err) => {
                setPingError(true);
            });

    }, []);

    function LoadingOrError() {
        if (loading) return <div>Загрузка...</div>;
        if (error) return <div>Ошибка: {error}</div>;
        if (pingError) return <div>Сервер хостится на ПК и бывает выключен. Попробуйте утром</div>

        return;
    }

    return (
        <div className="min-h-screen flex items-center justify-center">
            <main className="font-sans items-center p-8 rounded-lg shadow-md max-w-sm w-full">
                <h1 className="text-2xl font-semibold  mb-4">
                    Игроки
                </h1>
                <LoadingOrError />

                <table className="w-full table-auto border-collapse">
                    <tbody>
                        {players.map((player) => (
                            <tr key={player.id} >
                                <td className="px-4 py-2">{player.id}</td>
                                <td className="px-4 py-2">{player.elo}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </main>
        </div>
    );
}