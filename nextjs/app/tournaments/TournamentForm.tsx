"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
    Tournament,
    createTournamentPromise,
    updateTournamentPromise,
    deleteTournamentPromise,
} from "@/app/api";
import { useTournaments } from "@/app/tournamentsContext";
import { useMe } from "@/app/meContext";
import { useOffline } from "@/app/offline/OfflineContext";
import { PlayerMultiSelect } from "@/components/player-multi-select";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ConfirmDialog, useConfirmAction } from "@/components/confirm-dialog";
import { CloudOff } from "lucide-react";

function toDatetimeLocal(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Shared create/edit form. `existing` switches it to edit mode (adds delete). */
export function TournamentForm({ existing }: { existing?: Tournament }) {
    const router = useRouter();
    const { canEdit } = useMe();
    const { offline } = useOffline();
    const { invalidate } = useTournaments();
    const isEdit = !!existing;

    const [name, setName] = useState(existing?.name ?? "");
    const [startDate, setStartDate] = useState(existing ? toDatetimeLocal(existing.start_date) : "");
    const [endDate, setEndDate] = useState(existing ? toDatetimeLocal(existing.end_date) : "");
    const [playerIds, setPlayerIds] = useState<string[]>(existing ? existing.player_ids : []);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    const del = useConfirmAction(async (t: Tournament) => {
        await deleteTournamentPromise(t.id);
        invalidate();
        router.push("/tournaments");
    });

    const canSubmit = name.trim() !== "" && startDate !== "" && endDate !== "" && !submitting && canEdit && !offline;

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!canSubmit) return;
        if (new Date(endDate) <= new Date(startDate)) {
            setError("Дата окончания должна быть позже даты начала");
            return;
        }
        setError("");
        setSubmitting(true);
        try {
            const payload = {
                name: name.trim(),
                start_date: new Date(startDate).toISOString(),
                end_date: new Date(endDate).toISOString(),
                player_ids: playerIds,
            };
            if (existing) {
                await updateTournamentPromise(existing.id, payload);
                invalidate();
                toast.success("Турнир обновлён");
                router.push(`/tournament?id=${existing.id}`);
            } else {
                const created = await createTournamentPromise(payload);
                invalidate();
                toast.success("Турнир создан");
                router.push(`/tournament?id=${created.id}`);
            }
        } catch (err) {
            // The API helper already shows a toast; surface the message inline too.
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {offline && (
                <Alert variant="destructive">
                    <CloudOff />
                    <AlertTitle>Нет связи с сервером — управление турнирами недоступно</AlertTitle>
                    <AlertDescription>Попробуйте снова, когда соединение восстановится.</AlertDescription>
                </Alert>
            )}

            <div>
                <label className="block font-semibold mb-2" htmlFor="tournamentName">Название:</label>
                <input
                    id="tournamentName"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="border rounded px-2 py-1 w-full"
                    required
                />
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                    <label className="block font-semibold mb-2" htmlFor="startDate">Дата начала:</label>
                    <input
                        id="startDate"
                        type="datetime-local"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="border rounded px-2 py-1 w-full"
                        required
                    />
                </div>
                <div className="flex-1">
                    <label className="block font-semibold mb-2" htmlFor="endDate">Дата окончания:</label>
                    <input
                        id="endDate"
                        type="datetime-local"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="border rounded px-2 py-1 w-full"
                        required
                    />
                </div>
            </div>

            <div>
                <h2 className="font-semibold mb-2">Участники:</h2>
                <PlayerMultiSelect value={playerIds} onChange={setPlayerIds} />
            </div>

            {error && <div className="text-red-600 text-sm">{error}</div>}

            <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={!canSubmit}>
                    {submitting ? "Сохранение..." : isEdit ? "Сохранить изменения" : "Создать турнир"}
                </Button>
                {isEdit && (
                    <Button type="button" variant="destructive" onClick={() => del.trigger(existing)} disabled={!canEdit || offline}>
                        Удалить турнир
                    </Button>
                )}
            </div>

            <ConfirmDialog
                open={del.open}
                onOpenChange={del.onOpenChange}
                title="Удалить турнир"
                description="Удалить турнир можно только если в нём нет участников. Сначала уберите всех участников."
                confirmText="Удалить"
                confirmVariant="destructive"
                loading={del.pending}
                onConfirm={del.confirm}
            />
        </form>
    );
}
