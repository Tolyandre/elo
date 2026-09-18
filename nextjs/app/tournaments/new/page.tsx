"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createTournamentPromise } from "@/app/api";
import { useMe } from "@/app/meContext";
import { PageHeader } from "@/app/pageHeaderContext";
import { ErrorAlert } from "@/components/error-alert";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * Tournament creation (ADR-26): name, elimination type and the optional
 * grand-final deadline — the pool, participants and the bracket shape are
 * the organizer edit page's job during registration.
 */
export default function NewTournamentPage() {
    const { canEdit } = useMe();
    const router = useRouter();
    const [name, setName] = useState("");
    const [elimination, setElimination] = useState<"single" | "double">("single");
    const [deadline, setDeadline] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    if (!canEdit) {
        return (
            <main className="max-w-sm mx-auto space-y-4">
                <PageHeader title="Новый турнир" />
                <ErrorAlert message="Создавать турниры могут только редакторы" />
            </main>
        );
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        if (!name.trim()) {
            setError("Укажите название турнира");
            return;
        }
        setSubmitting(true);
        setError("");
        try {
            const created = await createTournamentPromise({
                name: name.trim(),
                elimination,
                grand_final_deadline: deadline ? new Date(deadline).toISOString() : null,
            });
            toast.success("Турнир создан — добавьте пул игр и участников");
            router.push(`/tournaments/edit?id=${created.id}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className="max-w-sm mx-auto space-y-6">
            <PageHeader title="Новый турнир" />
            <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                    <label htmlFor="tournament-name" className="block font-semibold mb-2">Название:</label>
                    <input
                        id="tournament-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="border rounded px-2 py-1 w-full"
                        required
                    />
                </div>
                <div>
                    <h2 className="font-semibold mb-2">Тип сетки:</h2>
                    <div className="flex flex-col gap-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="radio"
                                name="elimination"
                                className="h-4 w-4"
                                checked={elimination === "single"}
                                onChange={() => setElimination("single")}
                            />
                            <span>Одиночное выбывание</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="radio"
                                name="elimination"
                                className="h-4 w-4"
                                checked={elimination === "double"}
                                onChange={() => setElimination("double")}
                            />
                            <span>Двойное выбывание (WB + LB)</span>
                        </label>
                    </div>
                </div>
                <div>
                    <label htmlFor="tournament-deadline" className="block font-semibold mb-2">
                        Дедлайн гранд-финала (необязательно):
                    </label>
                    <input
                        id="tournament-deadline"
                        type="datetime-local"
                        value={deadline}
                        onChange={(e) => setDeadline(e.target.value)}
                        className="border rounded px-2 py-1 w-full"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                        Если к дедлайну финал не сыгран, турнир автоматически отменяется.
                    </p>
                </div>
                {error && <div className="text-red-600 text-sm">{error}</div>}
                <Button type="submit" disabled={submitting} aria-busy={submitting}>
                    {submitting ? "Создание..." : "Создать турнир"}
                </Button>
            </form>
        </main>
    );
}
