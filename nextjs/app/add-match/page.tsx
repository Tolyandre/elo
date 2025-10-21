"use client";

import React, { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { usePlayers } from "../players/PlayersContext";
import { addMatchPromise } from "../api";
import { useMatches } from "../matches/MatchesContext";
import { SettingsState, useSettings } from "../settingsContext";
import { getGamesPromise } from "../api";

type Participant = {
    id: string;
    points: string;
};

type EloChange = {
    id: string;
    minus: number;
    plus: number;
    delta: number;
};

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

    const { invalidate: invalidateMatches } = useMatches();
    const { invalidate: invalidatePlayers } = usePlayers();
    const settings = useSettings();

    const [games, setGames] = useState<string[]>([]);
    const [filteredGames, setFilteredGames] = useState<string[]>([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        getGamesPromise().then((data) => {
            if (data.games) {
                setGames(data.games);
                setFilteredGames(data.games);
            }
        });
    }, []);

    useEffect(() => {
        setFilteredGames(
            games.filter((game) =>
                game.toLowerCase().includes(gameName.toLowerCase())
            )
        );
    }, [gameName, games]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target as Node)
            ) {
                setShowDropdown(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

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
        const d = settings.eloConstD;
        const k = settings.eloConstK;

        const newElo: EloChange[] = [];
        const playersCount = participants.length;

        const absoluteLoserScore = participants
            .map(p => Number(p.points))
            .reduce((prev, cur) => Math.min(prev, cur), Number.MAX_VALUE);

        participants.forEach((p) => {

            const winExpectation = (participants.map(inner_p =>
                1 / (1 + Math.pow(10, (getPlayerElo(inner_p.id) - getPlayerElo(p.id)) / d))
            ).reduce((prev, curr) => prev + curr) - 0.5) / (playersCount * (playersCount - 1) / 2);


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
    }, [participants, players, settings]);

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
            invalidateMatches();
            invalidatePlayers();
            setTimeout(() => {
                router.push("/matches");
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
                <div className="relative">
                    <input
                        id="gameName"
                        type="text"
                        value={gameName}
                        onChange={(e) => {
                            setGameName(e.target.value);
                            setShowDropdown(true);
                        }}
                        className="border rounded px-2 py-1 w-full"
                        onFocus={() => setShowDropdown(true)}
                        required
                        autoComplete="off"
                    />
                    {showDropdown && filteredGames.length > 0 && (
                        <div
                            ref={dropdownRef}
                            className="absolute z-10 mt-1 w-full my-background border border-gray-300 rounded shadow-lg max-h-60 overflow-y-auto">
                            {filteredGames.map((game, index) => (
                                <div
                                    key={index}
                                    className="p-2 hover:bg-gray-500 cursor-pointer"
                                    onClick={() => {
                                        setGameName(game);
                                        setShowDropdown(false);
                                    }}
                                >
                                    {game}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
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
