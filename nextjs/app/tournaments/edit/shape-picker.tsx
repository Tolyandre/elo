"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { Tournament, TournamentPlan } from "@/app/api";
import {
    getTournamentBracketPlansPromise,
    startTournamentPromise,
    type BracketPlanFilters,
} from "@/app/api";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { eliminationShortLabel, planPreview, roundsLabel } from "../labels";
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
 * of (participant count, pool, families + chip filters) — fetched from the
 * SAVED tournament state, so the list refreshes right after a config save.
 * Both elimination families are offered side by side; the chips travel as
 * query parameters, so the server's plan cap always applies to the current
 * condition, and the facets drive the chip options.
 * Starting is blocked while the registration editor holds unsaved changes —
 * plans describe the saved configuration, so a start would drop the draft.
 */

type Family = "single" | "double";
type ByeFilter = "any" | "with" | "without";

function toggleIn<T>(list: T[], v: T): T[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function ShapePicker({
    tournament: t,
    unsavedChanges,
    onStarted,
}: {
    tournament: Tournament;
    /** True while the registration editor has a draft differing from the saved tournament. */
    unsavedChanges?: boolean;
    onStarted: () => void;
}) {
    const participants = t.participant_ids ?? [];
    const eligible = t.games.length > 0 && participants.length >= 2;
    // The saved pool + participant count + chip state determine the plans.
    const poolKey = useMemo(() => JSON.stringify(t.games), [t.games]);

    const [families, setFamilies] = useState<Family[]>([]);
    const [roundsFilter, setRoundsFilter] = useState<number[]>([]);
    const [byeFilter, setByeFilter] = useState<ByeFilter>("any");
    const [shapeFilter, setShapeFilter] = useState<string[]>([]);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [starting, setStarting] = useState(false);
    const [error2, setError2] = useState("");

    const filters: BracketPlanFilters = useMemo(
        () => ({
            elimination: families.length > 0 ? families : undefined,
            rounds: roundsFilter.length > 0 ? roundsFilter : undefined,
            byes: byeFilter !== "any" ? byeFilter : undefined,
            first_shapes: shapeFilter.length > 0 ? shapeFilter : undefined,
        }),
        [families, roundsFilter, byeFilter, shapeFilter],
    );
    const filtersKey = JSON.stringify(filters);

    const { data, loading, error } = useAsyncResource(async () => {
        if (!eligible) return null;
        return getTournamentBracketPlansPromise(t.id, filters);
    }, [t.id, poolKey, participants.length, eligible, filtersKey]);

    const [selectedCanon, setSelectedCanon] = useState<string | null>(null);
    // The selection survives refetches by identity: a plan still offered
    // under the narrowed filters stays picked.
    const plan: TournamentPlan | null =
        data?.plans.find((p) => JSON.stringify(p) === selectedCanon) ?? null;

    // A fresh pool or participant list invalidates the chips — reset them
    // during render, the moment the new configuration is first seen.
    const [configFor, setConfigFor] = useState(`${poolKey}|${participants.length}`);
    if (eligible && `${poolKey}|${participants.length}` !== configFor) {
        setConfigFor(`${poolKey}|${participants.length}`);
        setFamilies([]);
        setRoundsFilter([]);
        setByeFilter("any");
        setShapeFilter([]);
        setSelectedCanon(null);
    }

    const facets = data?.facets;
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
                Варианты сеток зависят от числа участников и количества мест в каждой игре.
            </p>
            {loading && <Skeleton className="h-24 w-full rounded-xl" />}
            {error && (
                <p className="text-sm text-muted-foreground">
                    Не удалось перечислить формы сетки — проверьте пул и участников.
                </p>
            )}
            {data && facets && (
                <>
                    {/* The family row stays visible while a family filter is
                        active: facets only describe the explored families, so
                        the selected family's facet alone must not hide the
                        chip that would unselect it. */}
                    {(families.length > 0 || facets.eliminations.length > 1) && (
                        <FilterRow label="Сетка">
                            <FilterChip
                                active={families.includes("single")}
                                onClick={() => setFamilies(toggleIn(families, "single"))}
                            >
                                Одиночное выбывание
                            </FilterChip>
                            <FilterChip
                                active={families.includes("double")}
                                onClick={() => setFamilies(toggleIn(families, "double"))}
                            >
                                Двойное выбывание
                            </FilterChip>
                        </FilterRow>
                    )}
                    {facets.round_counts.length > 1 && (
                        <FilterRow label="Раунды">
                            {facets.round_counts.map((n) => (
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
                    {facets.has_byes && !facets.all_byes && (
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
                    {facets.first_shapes.length > 1 && (
                        <FilterRow label="Первый круг">
                            {facets.first_shapes.map((s) => (
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
                    {data.plans.length > 0 ? (
                        <Select
                            // Controlled with "" as the no-selection value: the
                            // config reset (fresh pool/participants after a
                            // save) must clear the displayed choice — leaving
                            // value undefined would let Radix keep its stale
                            // internal selection as an uncontrolled widget.
                            value={selectedCanon ?? ""}
                            onValueChange={(v) => setSelectedCanon(v)}
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder="Выберите форму сетки" />
                            </SelectTrigger>
                            <SelectContent>
                                {data.plans.map((p) => (
                                    <SelectItem key={JSON.stringify(p)} value={JSON.stringify(p)}>
                                        {`${eliminationShortLabel(p.elimination)}: ${planPreview(p)}`}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            {filters.elimination || filters.rounds || filters.byes || filters.first_shapes
                                ? "Под выбранные фильтры не подходит ни одна форма — снимите часть фильтров."
                                : "Для этого пула игр и числа участников форм сетки нет — измените пул (добавьте игры с другой вместимостью) или список участников."}
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
                    {unsavedChanges && (
                        <p className="text-sm text-amber-600">
                            Есть несохранённые изменения конфигурации — сохраните их, прежде чем начинать турнир.
                        </p>
                    )}
                    <Button
                        size="sm"
                        disabled={plan == null || unsavedChanges}
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
                                ? `Сетка: ${eliminationShortLabel(plan.elimination)} — ${planPreview(plan)}. Регистрация закроется, места первого круга разыграются случайно — изменить форму будет нельзя.`
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
