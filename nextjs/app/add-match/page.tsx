"use client";

import React, { Suspense, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/app/pageHeaderContext";
import { useRouter, useSearchParams } from "next/navigation";
import { usePlayers } from "../players/PlayersContext";
import { useMatches } from "../matches/MatchesContext";
import { useMe } from "../meContext";
import { useOffline } from "../offline/OfflineContext";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircleIcon, CloudOff } from "lucide-react";
import { LoginLink } from "@/components/login-link";
import { PlayerMultiSelect } from "@/components/player-multi-select";
import { GameCombobox } from "@/components/game-combobox";
import { useSessionStorage } from "@/hooks/useSessionStorage";
import { VoiceInput } from "@/components/voice-input";
import { PendingMatch } from "@/lib/offline/types";

type Participant = {
    id: string;
    name: string;
    points: string;
};

function AddGameForm({ editMatch }: { editMatch?: PendingMatch }) {
    const { players, playerDisplayName, loading } = usePlayers();
    const { pendingPlayers, isOnline, submitMatch, updatePendingMatch } = useOffline();
    const [draftParticipants, setDraftParticipants] = useSessionStorage<Participant[]>("add-match/participants", []);
    const [draftGameId, setDraftGameId] = useSessionStorage<string | undefined>("add-match/selectedGameId", undefined);
    // Editing a pending match keeps its own state so the regular add-match draft survives.
    const [editParticipants, setEditParticipants] = useState<Participant[]>([]);
    const [editGameId, setEditGameId] = useState<string | undefined>(undefined);
    const [success, setSuccess] = useState(false);
    const [errors, setErrors] = useState<Record<string, boolean>>({});
    const [bottomErrorMessage, setBottomErrorMessage] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const router = useRouter();

    const participants = editMatch ? editParticipants : draftParticipants;
    const setParticipants = editMatch ? setEditParticipants : setDraftParticipants;
    const selectedGameId = editMatch ? editGameId : draftGameId;
    const setSelectedGameId = editMatch ? setEditGameId : setDraftGameId;

    const { invalidate: invalidateMatches } = useMatches();
    const { invalidate: invalidatePlayers } = usePlayers();

    const resolvePlayerName = (id: string): string => {
        const pending = pendingPlayers.find((p) => p.clientId === id);
        if (pending) return `${pending.name} (офлайн)`;
        const found = players.find((pl) => pl.id === id);
        return found ? playerDisplayName(found) : "Unknown";
    };

    // Prefill once from the pending match being edited (after players are known).
    const editInitializedRef = useRef<string | null>(null);
    useEffect(() => {
        if (!editMatch || loading || editInitializedRef.current === editMatch.clientId) return;
        editInitializedRef.current = editMatch.clientId;
        setEditParticipants(
            Object.entries(editMatch.score).map(([id, points]) => ({
                id,
                points: String(points),
                name: resolvePlayerName(id),
            })),
        );
        setEditGameId(editMatch.gameId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editMatch, loading]);

    const handleVoiceResult = (gameId: string | undefined, scores: { playerId: string; points: number }[]) => {
        if (gameId) setSelectedGameId(gameId);
        if (scores.length > 0) {
            const merged = [...participants];
            for (const { playerId, points } of scores) {
                const existing = merged.find((p) => p.id === playerId);
                if (existing) {
                    existing.points = String(points);
                } else {
                    merged.push({ id: playerId, points: String(points), name: resolvePlayerName(playerId) });
                }
            }
            setParticipants(merged);
        }
    };

    const handlePlayersChange = (newIds: string[]) => {
        setParticipants(
            newIds.map((id) => {
                const existing = participants.find((p) => p.id === id);
                return existing ?? { id, points: "", name: resolvePlayerName(id) };
            })
        );
    };

    const handlePointsChange = (id: string, value: string) => {
        setParticipants(
            participants.map((p) =>
                p.id === id ? { ...p, points: value } : p
            )
        );

        setErrors((prev) => ({ ...prev, [id]: !isNumber(value) }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        if (!selectedGameId) return;
        if (participants.length === 0) return;
        // Проверка ошибок
        if (Object.values(errors).some(Boolean)) return;

        const score: Record<string, number> = {};
        participants.forEach(p => {
            score[p.id] = Number(p.points);
        });

        setSubmitting(true);
        try {
            if (editMatch) {
                updatePendingMatch(editMatch.clientId, { gameId: selectedGameId, score });
                router.push("/matches");
                return;
            }

            const result = await submitMatch({ game_id: selectedGameId, score });
            setSuccess(true);
            sessionStorage.removeItem("add-match/participants");
            sessionStorage.removeItem("add-match/selectedGameId");
            if (result.kind === "online") {
                invalidateMatches();
                invalidatePlayers();
                router.push(`/match?id=${result.id}`);
            } else {
                // Saved locally — the pending card is shown at the top of the match list.
                router.push("/matches");
            }
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

    if (loading && isOnline) return <div className="p-4">Загрузка игроков...</div>;

    const offlineMode = !isOnline;

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {offlineMode && (
                <Alert>
                    <CloudOff />
                    <AlertTitle>Нет сети — партия будет сохранена офлайн</AlertTitle>
                    <AlertDescription>
                        Результат сохранится на этом устройстве и автоматически отправится на
                        сервер, когда появится интернет. Не очищайте данные браузера до синхронизации.
                    </AlertDescription>
                </Alert>
            )}
            <div>
                <VoiceInput onResult={handleVoiceResult} />
            </div>
            <div>
                <label className="block font-semibold mb-2" htmlFor="gameName">
                    Название игры:
                </label>
                <GameCombobox value={selectedGameId} onChange={setSelectedGameId} />
            </div>
            <div>
                <h2 className="font-semibold mb-2">Участники:</h2>
                <PlayerMultiSelect value={participants.map(p => p.id)} onChange={handlePlayersChange} />

            </div>
            {participants.length > 0 && (
                <div>
                    <h2 className="font-semibold mb-2">Укажите очки для каждого:</h2>
                    <div className="grid grid-cols-1 gap-2">
                        {participants.map((p) => (
                            <div key={p.id} className="flex flex-col gap-1">
                                <div className="flex items-center gap-2">
                                    <span className="w-40">
                                        <div>{p.name}</div>
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
                disabled={participants.length === 0 || !selectedGameId || submitting}
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
                    editMatch ? 'Сохранить изменения' : offlineMode ? 'Сохранить офлайн' : 'Сохранить результат'
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
        <Suspense>
            <AddGamePageWrapped />
        </Suspense>
    );
}

function AddGamePageWrapped() {
    const me = useMe();
    const { pendingMatches, ready } = useOffline();
    const searchParams = useSearchParams();
    const editClientId = searchParams.get("edit");
    const editMatch = editClientId ? pendingMatches.find((m) => m.clientId === editClientId) : undefined;

    return (
        <main className="max-w-sm mx-auto p-4">
            <PageHeader title={editMatch ? "Редактирование офлайн-партии" : "Результат партии"} />

            {!me.id && (
                <Alert>
                    <AlertCircleIcon />
                    <AlertTitle>Чтобы добавить партию, выполните вход</AlertTitle>
                    <AlertDescription>
                        <LoginLink />
                    </AlertDescription>
                </Alert>
            )}
            {me.id && !me.canEdit && (
                <Alert>
                    <AlertCircleIcon />
                    <AlertTitle><b>{me.name}</b> пока не можете добавлять партии</AlertTitle>
                    <AlertDescription>
                        <p>Кто-то должен разрешить вам доступ</p>
                    </AlertDescription>
                </Alert>
            )}
            {editClientId && ready && !editMatch ? (
                <Alert>
                    <AlertCircleIcon />
                    <AlertTitle>Партия не найдена</AlertTitle>
                    <AlertDescription>
                        Возможно, она уже синхронизирована с сервером или удалена.
                    </AlertDescription>
                </Alert>
            ) : (
                <AddGameForm key={editMatch?.clientId ?? "new"} editMatch={editMatch} />
            )}
        </main>
    );
}

function isNumber(value?: string | number): boolean {
    return ((value != null) &&
        (value !== '') &&
        !isNaN(Number(value.toString())));
}
