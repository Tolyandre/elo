"use client";

import { useMemo, useState } from "react";
import type { Tournament, TournamentPlan } from "@/app/api";
import { getTournamentBracketPlansPromise, startTournamentPromise } from "@/app/api";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { planPreview } from "../labels";
import { PlanBracketPreview } from "../plan-bracket-preview";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The bracket shape picker (ADR-26 §UI): the valid plans are a pure function
 * of (participant count, pool, elimination) — fetched from the SAVED
 * tournament state, so the list refreshes right after a config save. The
 * organizer picks one whole shape up front and starts; nothing is generated
 * lazily later.
 */
export function ShapePicker({ tournament: t, onStarted }: { tournament: Tournament; onStarted: () => void }) {
    const participants = t.participant_ids ?? [];
    const eligible = t.games.length > 0 && participants.length >= 2;
    // The saved pool + participant count + elimination determine the plans.
    const poolKey = useMemo(() => JSON.stringify(t.games), [t.games]);

    const { data, loading, error } = useAsyncResource(async () => {
        if (!eligible) return null;
        return getTournamentBracketPlansPromise(t.id);
    }, [t.id, poolKey, participants.length, t.elimination, eligible]);

    const [selected, setSelected] = useState<number | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [starting, setStarting] = useState(false);
    const [error2, setError2] = useState("");

    if (!eligible) {
        return (
            <div className="pt-4 border-t space-y-1">
                <h2 className="font-semibold">Форма сетки</h2>
                <p className="text-sm text-muted-foreground">
                    Сохраните пул игр и минимум двух участников — появятся допустимые формы сетки.
                </p>
            </div>
        );
    }

    const plan: TournamentPlan | null =
        data && selected != null ? data.plans[selected] ?? null : null;

    const start = async () => {
        if (!plan) return;
        setStarting(true);
        setError2("");
        try {
            await startTournamentPromise(t.id, plan);
            setConfirmOpen(false);
            onStarted();
        } catch (err) {
            setError2(err instanceof Error ? err.message : String(err));
        } finally {
            setStarting(false);
        }
    };

    return (
        <div className="pt-4 border-t space-y-3">
            <h2 className="font-semibold">Форма сетки</h2>
            <p className="text-xs text-muted-foreground">
                Варианты пересчитываются после сохранения изменений пула и списка участников.
            </p>
            {loading && <Skeleton className="h-24 w-full rounded-xl" />}
            {error && (
                <p className="text-sm text-muted-foreground">
                    Не удалось перечислить формы сетки — проверьте пул и участников.
                </p>
            )}
            {data && (
                <>
                    <Select
                        value={selected != null ? String(selected) : undefined}
                        onValueChange={(v) => setSelected(Number(v))}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder="Выберите форму сетки" />
                        </SelectTrigger>
                        <SelectContent>
                            {data.plans.map((p, i) => (
                                <SelectItem key={i} value={String(i)}>
                                    {planPreview(p)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {data.truncated && (
                        <p className="text-xs text-muted-foreground">
                            Показаны первые {data.plans.length} вариантов (лимит {data.cap}) — всего больше.
                        </p>
                    )}
                    {plan && (
                        <div className="rounded-xl border p-3">
                            <h3 className="mb-2 text-sm font-semibold">Предпросмотр выбранной формы</h3>
                            <PlanBracketPreview plan={plan} />
                        </div>
                    )}
                    {error2 && <div className="text-red-600 text-sm">{error2}</div>}
                    <Button
                        size="sm"
                        disabled={plan == null}
                        onClick={() => setConfirmOpen(true)}
                    >
                        Начать турнир
                    </Button>
                    <ConfirmDialog
                        open={confirmOpen}
                        onOpenChange={setConfirmOpen}
                        title="Начать турнир?"
                        description={
                            plan
                                ? `Сетка: ${planPreview(plan)}. Регистрация закроется, места первого круга разыграются случайно — изменить форму будет нельзя.`
                                : undefined
                        }
                        confirmText="Начать"
                        loading={starting}
                        onConfirm={start}
                    />
                </>
            )}
        </div>
    );
}
