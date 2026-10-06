"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createTournamentPromise } from "@/app/api";
import { useMe } from "@/app/meContext";
import { PageHeader } from "@/app/pageHeaderContext";
import { ErrorAlert } from "@/components/error-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/page-container";
import { toast } from "sonner";

/**
 * Tournament creation (ADR-26): name and the optional grand-final deadline —
 * the pool, participants and the bracket shape are the organizer edit page's
 * job during registration. The elimination family is no creation field: both
 * families' plans are offered side by side in the shape picker and the chosen
 * plan's family is stamped at start.
 */
export default function NewTournamentPage() {
    const { canEdit } = useMe();
    const router = useRouter();
    const [name, setName] = useState("");
    const [deadline, setDeadline] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    if (!canEdit) {
        return (
            <PageContainer width="form">
                <PageHeader title="Новый турнир" />
                <ErrorAlert message="Создавать турниры могут только редакторы" />
            </PageContainer>
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
        <PageContainer width="form">
            <PageHeader title="Новый турнир" />
            <form onSubmit={handleSubmit}>
                <div>
                    <label htmlFor="tournament-name" className="block font-semibold mb-2">Название:</label>
                    <Input
                        id="tournament-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                    />
                </div>
                <div>
                    <label htmlFor="tournament-deadline" className="block font-semibold mb-2">
                        Дедлайн гранд-финала (необязательно):
                    </label>
                    <Input
                        id="tournament-deadline"
                        type="datetime-local"
                        value={deadline}
                        onChange={(e) => setDeadline(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                        Если к дедлайну финал не сыгран, турнир автоматически отменяется.
                    </p>
                </div>
                {error && <div className="text-destructive text-sm">{error}</div>}
                <Button type="submit" disabled={submitting} aria-busy={submitting}>
                    {submitting ? "Создание..." : "Создать турнир"}
                </Button>
            </form>
        </PageContainer>
    );
}
