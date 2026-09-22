"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Info } from "lucide-react";
import type { PlanRound, Tournament, TournamentPlan } from "@/app/api";
import {
    getTournamentBracketPlansPromise,
    startTournamentPromise,
    type BracketPlanFilters,
} from "@/app/api";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { eliminationShortLabel, planPreview, roundLabel, roundsLabel } from "../labels";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
                        <FilterRow
                            label="Баи"
                            hint="Бай — автоматический проход дальше без игры: когда участники не делятся на полные столы, часть из них пропускает круг."
                        >
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
                            {/* The value node must stay mounted: Radix's
                                item-aligned positioning anchors on it and
                                silently skips placement without it. Its
                                children are the plan's chips, so the trigger's
                                single-line clamp is defeated with an explicit
                                block display (the clamp needs -webkit-box). */}
                            <SelectTrigger className="w-full data-[size=default]:h-auto min-h-9 py-2 [&>[data-slot=select-value]]:block!">
                                <SelectValue placeholder="Выберите форму сетки">
                                    {plan && <PlanChips plan={plan} />}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                {data.plans.map((p) => (
                                    <SelectItem
                                        key={JSON.stringify(p)}
                                        value={JSON.stringify(p)}
                                        // The chips are not plain text — keep
                                        // typeahead working off the text form.
                                        textValue={planPreview(p)}
                                    >
                                        <PlanChips plan={p} />
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

function FilterRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
    return (
        <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex w-20 shrink-0 items-center gap-1 text-xs text-muted-foreground">
                {label}
                {hint && (
                    // A click-toggled popover, not a hover tooltip: Radix
                    // tooltips flash open/closed on touch taps (the pointerdown
                    // suppresses the focus-open and click closes), so the hint
                    // must survive a tap — same pattern as the guarantors info.
                    <Popover>
                        <PopoverTrigger asChild>
                            <button
                                type="button"
                                aria-label={`Что значит «${label}»?`}
                                className="text-muted-foreground/60 hover:text-muted-foreground"
                            >
                                <Info className="size-3.5" />
                            </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-64 text-xs text-muted-foreground">
                            {hint}
                        </PopoverContent>
                    </Popover>
                )}
            </span>
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

/**
 * A plan as round chips — «Тур 1: 3+3 → 2» — one chip per round. Single
 * elimination is a single row; double elimination lays the winners chips on
 * the top row with the losers chip of the same round directly beneath, and
 * the final sits in its own column after them, centered between the two
 * rows. The grid shrinks (chips ellipsize) where the narrow trigger cannot
 * fit it; the dropdown item offers its full width.
 */
function PlanChips({ plan }: { plan: TournamentPlan }) {
    if (plan.elimination !== "double") {
        return (
            <div className="flex min-w-0 flex-wrap gap-1">
                {plan.rounds.map((round) => (
                    <RoundChip
                        key={`${round.track}-${round.index}`}
                        round={round}
                        elimination={plan.elimination}
                    />
                ))}
            </div>
        );
    }
    const winners = plan.rounds.filter((r) => r.track === "winners");
    const losers = plan.rounds.filter((r) => r.track === "losers");
    const finals = plan.rounds.filter((r) => r.track === "final");
    const trackColumns = Math.max(winners.length, losers.length);
    return (
        <div
            className="grid min-w-0 gap-1"
            style={{ gridTemplateColumns: `repeat(${trackColumns + finals.length}, minmax(0, max-content))` }}
        >
            {winners.map((round) => (
                <RoundChip
                    key={`winners-${round.index}`}
                    round={round}
                    elimination="double"
                    style={{ gridColumn: round.index, gridRow: 1 }}
                />
            ))}
            {losers.map((round) => (
                <RoundChip
                    key={`losers-${round.index}`}
                    round={round}
                    elimination="double"
                    style={{ gridColumn: round.index, gridRow: 2 }}
                />
            ))}
            {finals.map((round, i) => (
                <RoundChip
                    key={`final-${round.index}`}
                    round={round}
                    elimination="double"
                    style={{
                        gridColumn: trackColumns + 1 + i,
                        gridRow: "1 / span 2",
                        alignSelf: "center",
                    }}
                />
            ))}
        </div>
    );
}

function RoundChip({
    round,
    elimination,
    style,
}: {
    round: PlanRound;
    elimination: TournamentPlan["elimination"];
    style?: CSSProperties;
}) {
    return (
        <span
            style={style}
            className="min-w-0 truncate rounded-full border bg-muted px-2 py-0.5 text-xs"
        >
            {roundLabel(round, elimination)}
        </span>
    );
}
