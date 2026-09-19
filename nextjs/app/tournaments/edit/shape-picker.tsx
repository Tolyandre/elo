"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { Tournament, TournamentPlan } from "@/app/api";
import { getTournamentBracketPlansPromise, startTournamentPromise } from "@/app/api";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { planPreview, roundsLabel } from "../labels";
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
import { cn } from "@/lib/utils";

/**
 * The bracket shape picker (ADR-26 §UI): the valid plans are a pure function
 * of (participant count, pool, elimination) — fetched from the SAVED
 * tournament state, so the list refreshes right after a config save. The
 * organizer picks one whole shape up front and starts; nothing is generated
 * lazily later. Filter chips narrow a long list by rounds count, byes and
 * the first-round table shapes; they never alter the offered plans.
 */

type ByeFilter = "any" | "with" | "without";

function planHasByes(p: TournamentPlan): boolean {
    return p.rounds.some((r) => r.slots.some((s) => s.seats.some((seat) => seat.kind === "bye")));
}

/** The first round's table shapes, e.g. «4+4» — round 1 never seats byes. */
function firstRoundShape(p: TournamentPlan): string {
    return p.rounds[0]?.slots.map((s) => s.seat_count).join("+") ?? "";
}

function matchesFilters(p: TournamentPlan, rounds: number[], byes: ByeFilter, shapes: string[]): boolean {
    if (rounds.length > 0 && !rounds.includes(p.rounds.length)) return false;
    if (byes !== "any" && (byes === "with") !== planHasByes(p)) return false;
    if (shapes.length > 0 && !shapes.includes(firstRoundShape(p))) return false;
    return true;
}

function toggleIn<T>(list: T[], v: T): T[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

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
    const [roundsFilter, setRoundsFilter] = useState<number[]>([]);
    const [byeFilter, setByeFilter] = useState<ByeFilter>("any");
    const [shapeFilter, setShapeFilter] = useState<string[]>([]);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [starting, setStarting] = useState(false);
    const [error2, setError2] = useState("");

    const plans = useMemo(() => data?.plans ?? [], [data]);
    const roundCounts = useMemo(
        () => [...new Set(plans.map((p) => p.rounds.length))].sort((a, b) => a - b),
        [plans],
    );
    const shapes = useMemo(
        () => [...new Set(plans.map(firstRoundShape))].sort(),
        [plans],
    );
    const someByes = useMemo(() => plans.some(planHasByes), [plans]);
    const allByes = useMemo(() => plans.every(planHasByes), [plans]);

    // A fresh plan list (config saved) invalidates the chips — reset them
    // during render, the moment the new list is first seen.
    const [filtersFor, setFiltersFor] = useState<typeof data>(null);
    if (data !== filtersFor) {
        setFiltersFor(data);
        setRoundsFilter([]);
        setByeFilter("any");
        setShapeFilter([]);
    }

    const visible = useMemo(
        () => plans.map((p, i) => ({ plan: p, index: i })).filter(({ plan }) => matchesFilters(plan, roundsFilter, byeFilter, shapeFilter)),
        [plans, roundsFilter, byeFilter, shapeFilter],
    );

    // The picked plan is startable only while the chips still show it; a
    // hidden selection stays remembered but inert (and comes back when the
    // filter is lifted).
    const selectedPlan: TournamentPlan | null =
        data && selected != null ? data.plans[selected] ?? null : null;
    const plan: TournamentPlan | null =
        selectedPlan && matchesFilters(selectedPlan, roundsFilter, byeFilter, shapeFilter) ? selectedPlan : null;

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
                    {(roundCounts.length > 1 || shapes.length > 1 || (someByes && !allByes)) && (
                        <div className="space-y-1.5" role="group" aria-label="Фильтры форм сетки">
                            {roundCounts.length > 1 && (
                                <FilterRow label="Раунды">
                                    {roundCounts.map((n) => (
                                        <FilterChip
                                            key={n}
                                            active={roundsFilter.includes(n)}
                                            onClick={() => setRoundsFilter(toggleIn(roundsFilter, n))}
                                        >
                                            {roundsLabel(n)}
                                        </FilterChip>
                                    ))}
                                </FilterRow>
                            )}
                            {someByes && !allByes && (
                                <FilterRow label="Баи">
                                    <FilterChip
                                        active={byeFilter === "with"}
                                        onClick={() => setByeFilter(byeFilter === "with" ? "any" : "with")}
                                    >
                                        С баями
                                    </FilterChip>
                                    <FilterChip
                                        active={byeFilter === "without"}
                                        onClick={() => setByeFilter(byeFilter === "without" ? "any" : "without")}
                                    >
                                        Без баев
                                    </FilterChip>
                                </FilterRow>
                            )}
                            {shapes.length > 1 && (
                                <FilterRow label="Первый круг">
                                    {shapes.map((s) => (
                                        <FilterChip
                                            key={s}
                                            active={shapeFilter.includes(s)}
                                            onClick={() => setShapeFilter(toggleIn(shapeFilter, s))}
                                        >
                                            {s}
                                        </FilterChip>
                                    ))}
                                </FilterRow>
                            )}
                        </div>
                    )}
                    {visible.length > 0 ? (
                        <Select
                            value={plan ? String(selected) : undefined}
                            onValueChange={(v) => setSelected(Number(v))}
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder="Выберите форму сетки" />
                            </SelectTrigger>
                            <SelectContent>
                                {visible.map(({ plan: p, index }) => (
                                    <SelectItem key={index} value={String(index)}>
                                        {planPreview(p)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            Под выбранные фильтры не подходит ни одна форма — снимите часть фильтров.
                        </p>
                    )}
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

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground w-20 shrink-0">{label}</span>
            <div className="flex items-center gap-1.5 flex-wrap">{children}</div>
        </div>
    );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={onClick}
            className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                active
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
        >
            {children}
        </button>
    );
}
