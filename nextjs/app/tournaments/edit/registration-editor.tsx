"use client";

import { useEffect, useState } from "react";
import type { Tournament, TournamentGame } from "@/app/api";
import type { Base58ID } from "@/lib/id";
import { updateTournamentPromise } from "@/app/api";
import { useGames } from "@/app/gamesContext";
import { PlayerMultiSelect } from "@/components/player-multi-select";
import { GameCombobox } from "@/components/game-combobox";
import { Button } from "@/components/ui/button";

function toDatetimeLocal(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type FormState = {
    name: string;
    deadline: string;
    pool: TournamentGame[];
    participantIds: Base58ID[];
};

function formFrom(t: Tournament): FormState {
    return {
        name: t.name,
        deadline: t.grand_final_deadline ? toDatetimeLocal(t.grand_final_deadline) : "",
        pool: t.games,
        participantIds: t.participant_ids ?? [],
    };
}

/**
 * Registration-time configuration (ADR-26 §UI): name, grand-final deadline,
 * the game pool (wholesale-rewritten) and the participant set — one «Сохранить»,
 * one PUT. The shape picker reads the SAVED pool and participants, so a save
 * is what refreshes the offered bracket shapes.
 */
export function RegistrationEditor({
    tournament: t,
    onSaved,
    onUnsavedChange = () => {},
}: {
    tournament: Tournament;
    onSaved: () => void;
    /** Reported whenever the draft starts/stops differing from the saved tournament (ADR-26 §UI: start is gated on it). */
    onUnsavedChange?: (unsaved: boolean) => void;
}) {
    const { games } = useGames();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    // One editable form state, seeded from the fetched tournament. When a
    // refetch delivers a different snapshot (after a save), reset it during
    // render — the "adjust state when a prop changes" pattern, so the form
    // always shows the server state between edits.
    const [form, setForm] = useState<FormState>(() => formFrom(t));
    const [seed, setSeed] = useState(t);
    if (seed !== t) {
        setSeed(t);
        setForm(formFrom(t));
    }

    const update = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

    // The draft is unsaved while it differs from the fetched snapshot; the
    // shape picker gates the start button on this (a stale plan would silently
    // drop the draft — e.g. a just-added participant).
    const unsaved = JSON.stringify(form) !== JSON.stringify(formFrom(t));
    useEffect(() => {
        onUnsavedChange(unsaved);
        return () => onUnsavedChange(false);
    }, [unsaved, onUnsavedChange]);

    const addGame = (gameId?: Base58ID) => {
        if (!gameId || form.pool.some((g) => g.game_id === gameId)) return;
        update({ pool: [...form.pool, { game_id: gameId, min_players: 2, max_players: 4 }] });
    };

    const updateRow = (gameId: Base58ID, patch: Partial<TournamentGame>) => {
        update({ pool: form.pool.map((g) => (g.game_id === gameId ? { ...g, ...patch } : g)) });
    };

    const gameName = (gameId: Base58ID): string =>
        games.find((g) => g.id === gameId)?.name ?? gameId;

    const handleSave = async () => {
        setSaving(true);
        setError("");
        try {
            await updateTournamentPromise(t.id, {
                id: t.id,
                name: form.name.trim() || t.name,
                grand_final_deadline: form.deadline ? new Date(form.deadline).toISOString() : null,
                games: form.pool.map((g) => ({
                    game_id: g.game_id,
                    min_players: Math.max(2, g.min_players),
                    max_players: Math.max(Math.max(2, g.min_players), g.max_players),
                })),
                participant_ids: form.participantIds,
            });
            onSaved();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <label htmlFor="t-name" className="block font-semibold mb-2">Название:</label>
                <input
                    id="t-name"
                    value={form.name}
                    onChange={(e) => update({ name: e.target.value })}
                    className="border rounded px-2 py-1 w-full"
                />
            </div>

            <div>
                <label htmlFor="t-deadline" className="block font-semibold mb-2">
                    Дедлайн гранд-финала (необязательно):
                </label>
                <input
                    id="t-deadline"
                    type="datetime-local"
                    value={form.deadline}
                    onChange={(e) => update({ deadline: e.target.value })}
                    className="border rounded px-2 py-1 w-full"
                />
            </div>

            <div>
                <h2 className="font-semibold mb-2">Пул игр (вместимость столов):</h2>
                <div className="space-y-2">
                    {form.pool.map((g) => (
                        <div key={g.game_id} className="flex items-center gap-2">
                            <span className="min-w-0 truncate flex-1">{gameName(g.game_id)}</span>
                            <label className="text-xs text-muted-foreground whitespace-nowrap">
                                от{" "}
                                <input
                                    type="number"
                                    min={2}
                                    value={g.min_players}
                                    onChange={(e) => updateRow(g.game_id, { min_players: Number(e.target.value) })}
                                    className="border rounded px-1 py-0.5 w-14"
                                />
                            </label>
                            <label className="text-xs text-muted-foreground whitespace-nowrap">
                                до{" "}
                                <input
                                    type="number"
                                    min={g.min_players}
                                    value={g.max_players}
                                    onChange={(e) => updateRow(g.game_id, { max_players: Number(e.target.value) })}
                                    className="border rounded px-1 py-0.5 w-14"
                                />
                            </label>
                            <button
                                type="button"
                                aria-label={`Убрать ${gameName(g.game_id)}`}
                                className="text-red-600 text-sm px-1"
                                onClick={() => update({ pool: form.pool.filter((row) => row.game_id !== g.game_id) })}
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                </div>
                <div className="mt-2">
                    <GameCombobox value={undefined} onChange={addGame} />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                    От 2 игроков за стол.
                </p>
            </div>

            <div>
                <h2 className="font-semibold mb-2">Участники: {form.participantIds.length}</h2>
                <PlayerMultiSelect value={form.participantIds} onChange={(ids) => update({ participantIds: ids })} />
            </div>

            {error && <div className="text-red-600 text-sm">{error}</div>}
            <Button onClick={handleSave} disabled={saving} aria-busy={saving}>
                {saving ? "Сохранение..." : "Сохранить"}
            </Button>
        </div>
    );
}
