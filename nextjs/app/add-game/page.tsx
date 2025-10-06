"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlayers } from "../PlayersContext";
import { addMatchPromise } from "../api";

type Participant = {
    id: string;
    points: string;
};

type EloChange = {
    id: string;
    minus: number;
    plus: number;
    delta: number;
}

function AddGameForm() {
    const { players, loading } = usePlayers();
    const [participants, setParticipants] = useState<Participant[]>([]);
    const [eloChange, setEloChange] = useState<EloChange[]>([]);
    const [gameName, setGameName] = useState("");
    const [success, setSuccess] = useState(false);
    const [errors, setErrors] = useState<Record<string, boolean>>({});
    const [bottomErrorMessage, setBottomErrorMessage] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const router = useRouter();

    const handleSelect = (id: string, checked: boolean) => {
        if (checked) {
            setParticipants([...participants, { id, points: "" }]);
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

        setErrors((prev) => ({ ...prev, [id]: !isNumber(value) }));
    };

    function getPlayerElo(playerId: string): number {
        const elo = players.find(player => player.id == playerId)?.elo;
        if (typeof (elo) == "undefined")
            throw "Cannot find player"
        return elo;
    }

    useEffect(() => {
        const d = 400;
        const k = 32;

        const newElo: EloChange[] = [];
        const playersCount = participants.length;

        const absoluteLoserScore = participants
            .map(p => Number(p.points))
            .reduce((prev, cur) => Math.min(prev, cur), Number.MAX_VALUE);

        participants.forEach((p) => {
            // (sum(
            //      map(
            //          filter(all_players_elo_range, isnumber(all_players_rank)), 
            //          LAMBDA(elo_i, 
            //              1/(1+10^((elo_i-player_elo)/d) ) 
            //          )
            //      )
            // )
            // -0.5) 
            // / (players_count*(players_count-1)/2)

            const winExpectation = (participants.map(inner_p =>
                1 / (1 + Math.pow(10, (getPlayerElo(inner_p.id) - getPlayerElo(p.id)) / d))
            ).reduce((prev, curr) => prev + curr) - 0.5) / (playersCount * (playersCount - 1) / 2);

            // (player_score-ABSOLUTE_LOSER_SCORE_2(players_score_range))
            // /(sum(players_score_range)-PLAYERS_COUNT(players_score_range)*ABSOLUTE_LOSER_SCORE_2(players_score_range))
            const normalizedScore = (Number(p.points) - absoluteLoserScore) /
                (participants.map(inner_p => Number(inner_p.points)).reduce((prev, cur) => prev + cur) - playersCount * absoluteLoserScore);
            const minus = -k * (isNaN(winExpectation) ? 1 : winExpectation);
            const plus = k * (isNaN(normalizedScore) ? 1 / playersCount : normalizedScore);

            newElo.push({
                id: p.id,
                minus: minus,
                plus: plus,
                delta: plus + minus,
            });
        });

        setEloChange(newElo);
    }, [participants, players]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        if (!gameName.trim()) return;
        if (participants.length === 0) return;
        // Проверка ошибок
        if (Object.values(errors).some(Boolean)) return;

        const score: Record<string, number> = {};
        participants.forEach(p => {
            score[p.id] = Number(p.points);
        });

        setSubmitting(true);
        try {
            await addMatchPromise({
                game: gameName,
                score,
            });
            setSuccess(true);
            setTimeout(() => {
                // TODO  revalidatePath('/posts') https://nextjs.org/docs/app/getting-started/updating-data#revalidating
                router.push("/");
            }, 1200);
        } catch (err) {
            setSuccess(false);
            if (err instanceof Error) {
                setBottomErrorMessage(err.message);
            } else {
                setBottomErrorMessage(String(err));
            }
        } finally {
            setSubmitting(false);
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
                                className="accent-blue-500 "
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
                                    <span className="w-32">{p.id}
                                        <span className="text-sm text-gray-500"> {round(eloChange.find(v => v.id == p.id)?.delta || 0, 0)} (
                                            <span className="text-red-600"> {round(eloChange.find(v => v.id == p.id)?.minus || 0, 0)} </span>
                                            <span className="text-green-600">+{round(eloChange.find(v => v.id == p.id)?.plus || 0, 0)}</span>)
                                        </span>
                                    </span>
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
                                    <span className="text-red-600 text-xs">Некорректный формат числа</span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {bottomErrorMessage && (
                <div className="text-red-600 text-sm">{bottomErrorMessage}</div>
            )}
            <button
                type="submit"
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed disabled:opacity-60 transition-colors flex items-center justify-center"
                disabled={participants.length === 0 || !gameName.trim() || submitting}
                aria-busy={submitting}
            >
                {submitting ? (
                    <>
                        <svg className="animate-spin h-4 w-4 mr-2 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                        </svg>
                        Сохранение...
                    </>
                ) : (
                    'Сохранить результат'
                )}
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
        <main className="max-w-xl mx-auto p-4">
            <h1 className="text-2xl font-bold mb-4">Результат партии</h1>
            <AddGameForm />
        </main>
    );
}

function isNumber(value?: string | number): boolean {
    return ((value != null) &&
        (value !== '') &&
        !isNaN(Number(value.toString())));
}

function round(num: number, fractionDigits: number): number {
    const factor = Math.pow(10, fractionDigits);
    return Math.round(num * factor) / factor;
}