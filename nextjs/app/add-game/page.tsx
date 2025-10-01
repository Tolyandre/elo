"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { PlayersProvider, usePlayers, Player } from "../PlayersContext";

type Participant = {
    id: string;
    points: string;
};

function AddGameForm() {
    const { players, loading } = usePlayers();
    const [participants, setParticipants] = useState<Participant[]>([]);
    const [gameName, setGameName] = useState("");
    const [success, setSuccess] = useState(false);
    const [errors, setErrors] = useState<Record<string, boolean>>({});
    const router = useRouter();

    const handleSelect = (id: string, checked: boolean) => {
        if (checked) {
            setParticipants([...participants, { id, points: "0" }]);
        } else {
            setParticipants(participants.filter((p) => p.id !== id));
        }
    };

    const handlePointsChange = (id: string, value: string) => {
        setParticipants(
            participants.map((p) =>
                p.id === id ? { ...p, points: value } : p
            )
        );
        // Проверка: разрешаем пустое поле, минус, или корректное число
        const isValid = value === "" || value === "-" || /^-?\d+$/.test(value);
        setErrors((prev) => ({ ...prev, [id]: !isValid }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!gameName.trim()) return;
        if (participants.length === 0) return;
        // Проверка ошибок
        if (Object.values(errors).some(Boolean)) return;

        const score: Record<string, number> = {};
        participants.forEach(p => {
            const num = parseInt(p.points, 10);
            score[p.id] = isNaN(num) ? 0 : num;
        });

        const payload = {
            game: gameName,
            score,
        };

        try {
            const res = await fetch("https://toly.is-cool.dev/elo-web-service/matches", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error("Ошибка при сохранении матча");
            setSuccess(true);
            setTimeout(() => {
                router.push("/");
            }, 1200);
        } catch (err) {
            setSuccess(false);
            alert("Ошибка при отправке данных");
        }
    };

    if (loading) return <div className="p-4">Загрузка игроков...</div>;

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div>
                <label className="block font-semibold mb-2" htmlFor="gameName">
                    Название игры:
                </label>
                <input
                    id="gameName"
                    type="text"
                    value={gameName}
                    onChange={e => setGameName(e.target.value)}
                    className="border rounded px-2 py-1 w-full"
                    required
                />
            </div>
            <div>
                <h2 className="font-semibold mb-2">Выберите участников:</h2>
                <div className="grid grid-cols-1 gap-2">
                    {players.map((player) => (
                        <label key={player.id} className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                value={player.id}
                                checked={participants.some((p) => p.id === player.id)}
                                onChange={(e) =>
                                    handleSelect(player.id, e.target.checked)
                                }
                                className="accent-blue-500"
                            />
                            <span>{player.id} <span className="text-gray-500">({player.elo})</span></span>
                        </label>
                    ))}
                </div>
            </div>
            {participants.length > 0 && (
                <div>
                    <h2 className="font-semibold mb-2">Укажите очки для каждого:</h2>
                    <div className="grid grid-cols-1 gap-2">
                        {participants.map((p) => (
                            <div key={p.id} className="flex flex-col gap-1">
                                <div className="flex items-center gap-2">
                                    <span className="w-32">{p.id}</span>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={p.points}
                                        onChange={(e) =>
                                            handlePointsChange(p.id, e.target.value)
                                        }
                                        className={`border rounded px-2 py-1 w-20 ${errors[p.id] ? "border-red-500" : ""}`}
                                        required
                                    />
                                    <span>очков</span>
                                </div>
                                {errors[p.id] && (
                                    <span className="text-red-600 text-sm">Некорректный формат числа</span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
            <button
                type="submit"
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                disabled={participants.length === 0 || !gameName.trim()}
            >
                Сохранить результат
            </button>
            {success && (
                <div className="text-green-600 font-semibold mt-2">
                    Партия добавлена! Перенаправление...
                </div>
            )}
        </form>
    );
}

export default function AddGamePage() {
    return (
        <PlayersProvider>
            <main className="max-w-xl mx-auto p-4">
                <h1 className="text-2xl font-bold mb-4">Результат партии</h1>
                <AddGameForm />
            </main>
        </PlayersProvider>
    );
}