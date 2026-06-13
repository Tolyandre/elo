"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlayers } from "../players/PlayersContext";
import { useMatches } from "./MatchesContext";
import { useMe } from "../meContext";
import { useOffline } from "../offline/OfflineContext";
import { Match, updateMatchPromise } from "../api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircleIcon, CloudOff } from "lucide-react";
import { LoginLink } from "@/components/login-link";
import { PlayerMultiSelect } from "@/components/player-multi-select";
import { GameCombobox } from "@/components/game-combobox";
import { useSessionStorage } from "@/hooks/useSessionStorage";
import { VoiceInput } from "@/components/voice-input";
import { PendingMatch } from "@/lib/offline/types";
import { toast } from "sonner";

type Participant = {
    id: string;
    name: string;
    points: string;
};

/** Login / permission alerts shown above the form on both the new and edit pages. */
export function MatchFormAuthAlerts() {
    const me = useMe();
    return (
        <>
            {!me.loading && !me.id && (
                <Alert>
                    <AlertCircleIcon />
                    <AlertTitle>Чтобы добавить партию, выполните вход</AlertTitle>
                    <AlertDescription>
                        <LoginLink />
                    </AlertDescription>
                </Alert>
            )}
            {!me.loading && me.id && !me.canEdit && (
                <Alert>
                    <AlertCircleIcon />
                    <AlertTitle><b>{me.name}</b> пока не можете добавлять партии</AlertTitle>
                    <AlertDescription>
                        <p>Кто-то должен разрешить вам доступ</p>
                    </AlertDescription>
                </Alert>
            )}
        </>
    );
}

export function MatchForm({ editPending, editSaved }: { editPending?: PendingMatch; editSaved?: Match }) {
    const { players, playerDisplayName, loading } = usePlayers();
    const { pendingPlayers, offline, isSyncing, submitMatch, updatePendingMatch } = useOffline();
    const isEdit = !!editPending || !!editSaved;
    // Block saving an offline (pending) edit while a sync is running — the sync
    // could remove/rewrite this very match mid-flight. Creating and editing saved
    // matches are unaffected.
    const syncBlocked = !!editPending && isSyncing;

    // The whole form draft is persisted per target (a brand-new match, an offline
    // pending match, or a saved match), so a refresh keeps in-progress edits and
    // the three targets never share state.
    const draftKey = editPending?.clientId ?? (editSaved ? `saved:${editSaved.id}` : "new");
    const [participants, setParticipants] = useSessionStorage<Participant[]>(`match-form:${draftKey}:participants`, []);
    const [selectedGameId, setSelectedGameId] = useSessionStorage<string | undefined>(`match-form:${draftKey}:game`, undefined);
    const [editDate, setEditDate] = useSessionStorage<string>(`match-form:${draftKey}:date`, "");
    // Persisted so the one-time prefill from the edited match survives a refresh
    // instead of clobbering the user's draft.
    const [seeded, setSeeded] = useSessionStorage<boolean>(`match-form:${draftKey}:seeded`, false);
    const [success, setSuccess] = useState(false);
    const [errors, setErrors] = useState<Record<string, boolean>>({});
    const [bottomErrorMessage, setBottomErrorMessage] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const router = useRouter();

    const { invalidate: invalidateMatches } = useMatches();
    const { invalidate: invalidatePlayers } = usePlayers();

    const clearDraft = () => {
        sessionStorage.removeItem(`match-form:${draftKey}:participants`);
        sessionStorage.removeItem(`match-form:${draftKey}:game`);
        sessionStorage.removeItem(`match-form:${draftKey}:date`);
        sessionStorage.removeItem(`match-form:${draftKey}:seeded`);
    };

    const resolvePlayerName = (id: string): string => {
        const pending = pendingPlayers.find((p) => p.clientId === id);
        if (pending) return `${pending.name} (офлайн)`;
        const found = players.find((pl) => pl.id === id);
        return found ? playerDisplayName(found) : "Unknown";
    };

    // Prefill once from the match being edited (after players are known). `seeded`
    // is persisted, so on a later refresh the saved draft is used as-is.
    useEffect(() => {
        if (loading || !isEdit || seeded) return;
        if (editPending) {
            setParticipants(
                Object.entries(editPending.score).map(([id, points]) => ({
                    id,
                    points: String(points),
                    name: resolvePlayerName(id),
                })),
            );
            setSelectedGameId(editPending.gameId);
            setEditDate(toDatetimeLocal(new Date(editPending.createdAt)));
        } else if (editSaved) {
            setParticipants(
                Object.entries(editSaved.score).map(([id, data]) => ({
                    id,
                    points: String(data.score),
                    name: resolvePlayerName(id),
                })),
            );
            setSelectedGameId(editSaved.game_id);
            setEditDate(editSaved.date ? toDatetimeLocal(editSaved.date) : "");
        }
        setSeeded(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editPending, editSaved, loading, isEdit, seeded]);

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
        if (isEdit && !editDate) {
            setBottomErrorMessage("Укажите дату партии");
            return;
        }

        const score: Record<string, number> = {};
        participants.forEach(p => {
            score[p.id] = Number(p.points);
        });

        setSubmitting(true);
        try {
            if (editSaved) {
                await updateMatchPromise(editSaved.id, {
                    game_id: selectedGameId,
                    score,
                    date: new Date(editDate).toISOString(),
                });
                clearDraft();
                invalidateMatches();
                invalidatePlayers();
                toast.success("Партия обновлена");
                router.push(`/matches/view?id=${editSaved.id}`);
                return;
            }
            if (editPending) {
                updatePendingMatch(editPending.clientId, {
                    gameId: selectedGameId,
                    score,
                    createdAt: new Date(editDate).toISOString(),
                });
                clearDraft();
                router.push(`/matches/view?id=${encodeURIComponent(editPending.clientId)}`);
                return;
            }

            const result = await submitMatch({ game_id: selectedGameId, score });
            setSuccess(true);
            clearDraft();
            if (result.kind === "online") {
                invalidateMatches();
                invalidatePlayers();
                router.push(`/matches/view?id=${result.id}`);
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

    if (loading && !offline) return <div className="p-4">Загрузка игроков...</div>;

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {offline && (editSaved ? (
                <Alert variant="destructive">
                    <CloudOff />
                    <AlertTitle>Нет связи с сервером — редактирование сохранённой партии недоступно</AlertTitle>
                    <AlertDescription>
                        Попробуйте снова, когда соединение восстановится.
                    </AlertDescription>
                </Alert>
            ) : (
                <Alert>
                    <CloudOff />
                    <AlertTitle>Офлайн — партия будет сохранена на устройстве</AlertTitle>
                    <AlertDescription>
                        Партия автоматически отправится на сервер, когда связь
                        восстановится.
                    </AlertDescription>
                </Alert>
            ))}
            <div>
                <VoiceInput onResult={handleVoiceResult} />
            </div>
            {isEdit && (
                <div>
                    <label className="block font-semibold mb-2" htmlFor="matchDate">
                        Дата и время:
                    </label>
                    <input
                        id="matchDate"
                        type="datetime-local"
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
                        className="border rounded px-2 py-1 w-full"
                        required
                    />
                </div>
            )}
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
                disabled={participants.length === 0 || !selectedGameId || submitting || syncBlocked}
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
                    isEdit ? 'Сохранить изменения' : offline ? 'Сохранить офлайн' : 'Сохранить результат'
                )}
            </button>
            {syncBlocked && (
                <div className="text-muted-foreground text-sm">Идёт синхронизация — подождите…</div>
            )}
            {success && (
                <div className="text-green-600 font-semibold mt-2">
                    Партия добавлена! Перенаправление...
                </div>
            )}
        </form>
    );
}

function isNumber(value?: string | number): boolean {
    return ((value != null) &&
        (value !== '') &&
        !isNaN(Number(value.toString())));
}

function toDatetimeLocal(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}
