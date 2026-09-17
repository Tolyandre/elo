"use client";
import type { Base58ID } from "@/lib/id";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CloudOff, InfoIcon } from "lucide-react";
import {
    Arena,
    ArenaSettings,
    ArenaSettingsDoc,
    MatchFilter,
    createArenaPromise,
    deleteArenaPromise,
    parseArenaSettings,
    updateArenaPromise,
} from "@/app/api";
import { useGames } from "@/app/gamesContext";
import { useTags } from "@/app/tagsContext";
import { useMe } from "@/app/meContext";
import { useOffline } from "@/app/offline/OfflineContext";
import { GameMultiSelect } from "@/components/game-multi-select";
import { MultiSelect } from "@/components/multi-select";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ConfirmDialog, useConfirmAction } from "@/components/confirm-dialog";
import { cn } from "@/lib/utils";

function toDatetimeLocal(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type LeagueValues = {
    newbie: boolean;
    amateur: boolean;
    elite: boolean;
    goalGap: string;
    earnedMin: string;
    earnedMax: string;
    tau: string;
    matches6m: string;
    matches2m: string;
};

type ArenaFormValues = {
    name: string;
    gameIds: Base58ID[];
    tagIds: Base58ID[];
    dateFrom: string;
    dateTo: string;
    startingRating: string;
    leagues: LeagueValues;
};

function initialValues(existing?: Arena, camp = false): ArenaFormValues {
    const doc = existing ? parseArenaSettings(existing.settings) : null;
    const newbie = doc?.leagues.find((l) => l.kind === "newbie");
    const elite = doc?.leagues.find((l) => l.kind === "elite");
    return {
        name: existing?.name ?? "",
        gameIds: existing?.filter?.game_ids ?? [],
        tagIds: existing?.filter?.tag_ids ?? [],
        // Filter bounds for arenas with a filter; the camp window for camps.
        dateFrom: existing?.filter?.date_from
            ? toDatetimeLocal(existing.filter.date_from)
            : existing?.starts_at
                ? toDatetimeLocal(existing.starts_at)
                : "",
        dateTo: existing?.filter?.date_to
            ? toDatetimeLocal(existing.filter.date_to)
            : existing?.ends_at
                ? toDatetimeLocal(existing.ends_at)
                : "",
        // A new arena starts like an auto-managed game arena: rating 900,
        // newbie + amateur. A new camp starts like the old tournament arenas:
        // rating = the starting elo (1000), no leagues.
        startingRating: doc ? String(doc.starting_rating) : camp ? "1000" : "900",
        leagues: {
            newbie: doc ? !!newbie : !camp,
            amateur: doc ? doc.leagues.some((l) => l.kind === "amateur") : !camp,
            elite: !!elite,
            goalGap: String(newbie?.goal_gap ?? 16),
            earnedMin: String(newbie?.earned_min ?? 2),
            earnedMax: String(newbie?.earned_max ?? 64),
            tau: String(newbie?.tau ?? 100),
            matches6m: String(elite?.matches_6m ?? 20),
            matches2m: String(elite?.matches_2m ?? 3),
        },
    };
}

function buildSettings(values: ArenaFormValues): ArenaSettings {
    const { leagues } = values;
    const leagueDocs: ArenaSettingsDoc["leagues"] = [];
    if (leagues.newbie) {
        leagueDocs.push({
            kind: "newbie",
            goal_gap: Number(leagues.goalGap),
            earned_min: Number(leagues.earnedMin),
            earned_max: Number(leagues.earnedMax),
            tau: Number(leagues.tau),
        });
    }
    if (leagues.amateur) {
        leagueDocs.push({ kind: "amateur" });
    }
    if (leagues.elite) {
        leagueDocs.push({ kind: "elite", matches_6m: Number(leagues.matches6m), matches_2m: Number(leagues.matches2m) });
    }
    return { starting_rating: Number(values.startingRating), leagues: leagueDocs };
}

/** The enabled leagues must carry valid parameters (the server re-validates). */
function leagueParamsError(values: ArenaFormValues): string | null {
    const nonNegative = (s: string) => Number.isFinite(Number(s)) && Number(s) >= 0;
    const { leagues } = values;
    if (!Number.isFinite(Number(values.startingRating))) {
        return "Стартовый рейтинг должен быть числом";
    }
    if (leagues.newbie) {
        if (!(nonNegative(leagues.goalGap) && nonNegative(leagues.earnedMin) && nonNegative(leagues.earnedMax))) {
            return "Параметры лиги новичков должны быть неотрицательными числами";
        }
        if (!(Number(leagues.tau) > 0)) {
            return "Значение τ должно быть положительным числом";
        }
    }
    if (leagues.elite && !(nonNegative(leagues.matches6m) && nonNegative(leagues.matches2m))) {
        return "Партии высшей лиги должны быть неотрицательными числами";
    }
    return null;
}

// Unsaved form values survive a page refresh. A single storage entry keyed by
// the arena id (or "new") — restoring only on identity match, so another
// arena's half-edited data never leaks in, and only one draft ever occupies
// the storage.
const ARENA_FORM_DRAFT_KEY = "arena-form-draft-v1";

type ArenaFormDraft = ArenaFormValues & { key: string };

/**
 * Shared create/edit form. `existing` switches it to edit mode (adds delete).
 * `camp=true` renders the camp variant (ADR-27): name + required date window,
 * no match filter and no leagues. In edit mode the variant follows the arena.
 */
export function ArenaForm({ existing, camp = false }: { existing?: Arena; camp?: boolean }) {
    const router = useRouter();
    const { canEdit } = useMe();
    const { offline } = useOffline();
    const { games } = useGames();
    const { tags } = useTags();
    const isEdit = !!existing;
    const isCamp = isEdit ? !!existing.camp : camp;
    const draftKey = isEdit ? `${existing.id}${isCamp ? ":camp" : ""}` : isCamp ? "new-camp" : "new";

    const [values, setValues] = useState<ArenaFormValues>(() => initialValues(existing, isCamp));
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        try {
            const raw = localStorage.getItem(ARENA_FORM_DRAFT_KEY);
            if (!raw) return;
            const draft = JSON.parse(raw) as ArenaFormDraft;
            if (draft.key !== draftKey) return;
            /* eslint-disable react-hooks/set-state-in-effect -- restore the saved draft after mount; localStorage is client-only, so it cannot run during render */
            setValues({
                name: draft.name,
                gameIds: draft.gameIds,
                tagIds: draft.tagIds,
                dateFrom: draft.dateFrom,
                dateTo: draft.dateTo,
                startingRating: draft.startingRating,
                leagues: draft.leagues,
            });
            /* eslint-enable react-hooks/set-state-in-effect */
        } catch {
            // A broken draft is as good as none.
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- restore once on mount; draftKey is fixed for the component's life
    }, []);

    useEffect(() => {
        const draft: ArenaFormDraft = { key: draftKey, ...values };
        localStorage.setItem(ARENA_FORM_DRAFT_KEY, JSON.stringify(draft));
    }, [draftKey, values]);

    const clearDraft = () => localStorage.removeItem(ARENA_FORM_DRAFT_KEY);

    // The default name spells the filter out: game names, then tag names.
    const defaultName = useMemo(() => {
        const names = [
            ...values.gameIds.map((id) => games.find((g) => g.id === id)?.name),
            ...values.tagIds.map((id) => tags.find((t) => t.id === id)?.name),
        ].filter((n): n is string => !!n);
        return names.join(", ");
    }, [values.gameIds, values.tagIds, games, tags]);

    const tagOptions = useMemo(
        () => [...tags]
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
            .map((t) => ({ value: t.id, label: t.name })),
        [tags],
    );

    const del = useConfirmAction(async (a: Arena) => {
        await deleteArenaPromise(a.id);
        clearDraft();
        toast.success("Арена удалена");
        router.push("/arenas");
    });

    const canSubmit = !submitting && canEdit && !offline;

    function set<K extends keyof ArenaFormValues>(field: K, value: ArenaFormValues[K]) {
        setValues((v) => ({ ...v, [field]: value }));
    }

    function setLeague<K extends keyof LeagueValues>(field: K, value: LeagueValues[K]) {
        setValues((v) => ({ ...v, leagues: { ...v.leagues, [field]: value } }));
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!canSubmit) return;
        const effectiveName = values.name.trim() || defaultName;
        if (!effectiveName) {
            setError(isCamp ? "Укажите название кэмпа" : "Укажите название арены");
            return;
        }
        if (isCamp && (!values.dateFrom || !values.dateTo)) {
            setError("Кэмпу нужны дата начала и дата конца");
            return;
        }
        if (values.dateFrom && values.dateTo && new Date(values.dateTo) <= new Date(values.dateFrom)) {
            setError("Дата окончания должна быть позже даты начала");
            return;
        }
        const settingsError = leagueParamsError(values);
        if (settingsError) {
            setError(settingsError);
            return;
        }
        setError("");
        setSubmitting(true);
        // Camp settings have no leagues (ADR-27: camps rank like the old
        // tournament arenas — a single rating ≡ elo list).
        const settings: ArenaSettings = isCamp
            ? { starting_rating: Number(values.startingRating), leagues: [] }
            : buildSettings(values);
        try {
            if (existing) {
                await updateArenaPromise(existing.id, {
                    name: effectiveName,
                    ...(isCamp
                        ? {
                              camp: true,
                              starts_at: values.dateFrom ? new Date(values.dateFrom).toISOString() : null,
                              ends_at: values.dateTo ? new Date(values.dateTo).toISOString() : null,
                          }
                        : {
                              filter: {
                                  game_ids: values.gameIds,
                                  tag_ids: values.tagIds,
                                  date_from: values.dateFrom ? new Date(values.dateFrom).toISOString() : null,
                                  date_to: values.dateTo ? new Date(values.dateTo).toISOString() : null,
                              } satisfies MatchFilter,
                          }),
                    settings,
                });
                clearDraft();
                toast.success(isCamp ? "Кэмп обновлён" : "Арена обновлена");
                router.push(`/arenas/view?id=${existing.id}`);
            } else {
                const created = await createArenaPromise({
                    name: effectiveName,
                    ...(isCamp
                        ? {
                              camp: true,
                              starts_at: values.dateFrom ? new Date(values.dateFrom).toISOString() : null,
                              ends_at: values.dateTo ? new Date(values.dateTo).toISOString() : null,
                          }
                        : {
                              filter: {
                                  game_ids: values.gameIds,
                                  tag_ids: values.tagIds,
                                  date_from: values.dateFrom ? new Date(values.dateFrom).toISOString() : null,
                                  date_to: values.dateTo ? new Date(values.dateTo).toISOString() : null,
                              } satisfies MatchFilter,
                          }),
                    settings,
                });
                clearDraft();
                toast.success(isCamp ? "Кэмп создан — рейтинг появится, когда он пересчитается" : "Арена создана — рейтинг появится, когда она пересчитается");
                router.push(`/arenas/view?id=${created.id}`);
            }
        } catch (err) {
            // The API helper already shows a toast; surface the message inline
            // too (e.g. the duplicate-name validation).
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
                    <AlertTitle>Нет связи с сервером — управление аренами недоступно</AlertTitle>
                    <AlertDescription>Попробуйте снова, когда соединение восстановится.</AlertDescription>
                </Alert>
            )}

            <div>
                <label className="block font-semibold mb-2" htmlFor="arenaName">Название:</label>
                <input
                    id="arenaName"
                    type="text"
                    value={values.name}
                    placeholder={defaultName || "Название арены"}
                    onChange={(e) => set("name", e.target.value)}
                    className="border rounded px-2 py-1 w-full"
                />
                <p className="text-xs text-muted-foreground mt-1">
                    Название должно быть уникальным.
                    {defaultName && (
                        <>
                            {" "}По умолчанию:{" "}
                            <button
                                type="button"
                                onClick={() => set("name", defaultName)}
                                className="text-blue-600 underline decoration-dashed underline-offset-2"
                            >
                                {defaultName}
                            </button>
                        </>
                    )}
                </p>
            </div>

            {!isCamp && (
            <div>
                <h2 className="font-semibold mb-2">Игры:</h2>
                <GameMultiSelect value={values.gameIds} onChange={(ids) => set("gameIds", ids)} />
            </div>
            )}

            {!isCamp && (
            <div>
                <h2 className="font-semibold mb-2">Теги игр:</h2>
                <MultiSelect
                    options={tagOptions}
                    placeholder="Выберите теги"
                    searchPlaceholder="Искать тег..."
                    hideSelectAll={true}
                    onValueChange={(ids: string[]) => set("tagIds", ids as Base58ID[])}
                    defaultValue={values.tagIds}
                />
            </div>
            )}

            <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                    <label className="block font-semibold mb-2" htmlFor="arenaDateFrom">{isCamp ? "Начало:" : "Начало (необязательно):"}</label>
                    <input
                        id="arenaDateFrom"
                        type="datetime-local"
                        value={values.dateFrom}
                        onChange={(e) => set("dateFrom", e.target.value)}
                        className="border rounded px-2 py-1 w-full"
                        required={isCamp}
                    />
                </div>
                <div className="flex-1">
                    <label className="block font-semibold mb-2" htmlFor="arenaDateTo">{isCamp ? "Окончание:" : "Окончание (необязательно):"}</label>
                    <input
                        id="arenaDateTo"
                        type="datetime-local"
                        value={values.dateTo}
                        onChange={(e) => set("dateTo", e.target.value)}
                        className="border rounded px-2 py-1 w-full"
                        required={isCamp}
                    />
                </div>
            </div>

            {!isCamp && (
            <div className="space-y-3">
                <h2 className="font-semibold">{isCamp ? "Рейтинг:" : "Рейтинг и лиги:"}</h2>
                <div className="flex items-center gap-2 text-sm">
                    <label htmlFor="arenaStartingRating">Стартовый рейтинг:</label>
                    <input
                        id="arenaStartingRating"
                        type="number"
                        value={values.startingRating}
                        onChange={(e) => set("startingRating", e.target.value)}
                        className="border rounded px-2 py-1 w-24"
                    />
                    <InfoHint label="Что такое стартовый рейтинг">
                        <p>Рейтинг, с которого игрок начинает в этой арене, пока не сыграл в ней ни одной партии.</p>
                    </InfoHint>
                </div>

                {!isCamp && (
                <>
                <p className="text-xs text-muted-foreground">
                    Лиги — уровни таблицы в порядке повышения. Если лиг нет, игроки идут одним списком, а рейтинг равен эло.
                </p>

                <div className="flex flex-wrap gap-1 items-center">
                    <LeagueChip
                        selected={values.leagues.newbie}
                        onClick={() => setLeague("newbie", !values.leagues.newbie)}
                        disabled={!canEdit}
                    >
                        Новички
                    </LeagueChip>
                    <LeagueChip
                        selected={values.leagues.amateur}
                        onClick={() => setLeague("amateur", !values.leagues.amateur)}
                        disabled={!canEdit}
                    >
                        Любители
                    </LeagueChip>
                    <LeagueChip
                        selected={values.leagues.elite}
                        onClick={() => setLeague("elite", !values.leagues.elite)}
                        disabled={!canEdit}
                    >
                        Высшая лига
                    </LeagueChip>
                </div>

                {values.leagues.newbie && (
                    <div className="space-y-2">
                        <NumberField
                            id="arenaGoalGap"
                            label="Разрыв эло"
                            value={values.leagues.goalGap}
                            onChange={(v) => setLeague("goalGap", v)}
                            info="Пока эло игрока выше его рейтинга больше чем на это значение, он остаётся в лиге новичков. Новичок с меньшим отрывом сразу попадает в следующую лигу."
                        />
                        <NumberField
                            id="arenaEarnedMin"
                            label="Мин. очков за победу"
                            value={values.leagues.earnedMin}
                            onChange={(v) => setLeague("earnedMin", v)}
                            info="Нижняя граница очков рейтинга за победу, пока рейтинг игрока догоняет его эло."
                        />
                        <NumberField
                            id="arenaEarnedMax"
                            label="Макс. очков за победу"
                            value={values.leagues.earnedMax}
                            onChange={(v) => setLeague("earnedMax", v)}
                            info="Верхняя граница очков рейтинга за победу, пока рейтинг игрока догоняет его эло."
                        />
                        <NumberField
                            id="arenaTau"
                            label="τ"
                            value={values.leagues.tau}
                            onChange={(v) => setLeague("tau", v)}
                            info="τ (Тау) — плавность догоняющего бонуса: чем больше τ, тем медленнее очки за победу растут при отставании рейтинга от эло."
                        />
                    </div>
                )}

                {values.leagues.elite && (
                    <div className="space-y-2">
                        <NumberField
                            id="arenaMatches6m"
                            label="Партий за полгода"
                            value={values.leagues.matches6m}
                            onChange={(v) => setLeague("matches6m", v)}
                            info="Партий за последние 6 месяцев, нужных для входа и удержания в высшей лиге."
                        />
                        <NumberField
                            id="arenaMatches2m"
                            label="Партий за 2 месяца"
                            value={values.leagues.matches2m}
                            onChange={(v) => setLeague("matches2m", v)}
                            info="Партий за последние 2 месяца, нужных для входа и удержания в высшей лиге."
                        />
                    </div>
                )}
                </>
                )}
            </div>
            )}

            {error && <div className="text-red-600 text-sm">{error}</div>}

            <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={!canSubmit}>
                    {submitting ? "Сохранение..." : isEdit ? "Сохранить изменения" : isCamp ? "Создать кэмп" : "Создать арену"}
                </Button>
                {isEdit && (
                    <Button type="button" variant="destructive" onClick={() => del.trigger(existing)} disabled={!canEdit || offline}>
                        {isCamp ? "Удалить кэмп" : "Удалить арену"}
                    </Button>
                )}
            </div>

            <ConfirmDialog
                open={del.open}
                onOpenChange={del.onOpenChange}
                title={isCamp ? "Удалить кэмп" : "Удалить арену"}
                description={isCamp ? "Кэмп и его статистика удалятся; партии останутся обычными партиями" : "Арена и её настройки удалятся"}
                confirmText="Удалить"
                confirmVariant="destructive"
                loading={del.pending}
                onConfirm={del.confirm}
            />
        </form>
    );
}

/**
 * The "?" beside a setting: an info icon opening a small popover — the same
 * pattern as the market guarantors description.
 */
function InfoHint({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={label}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                    <InfoIcon className="size-3.5" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 text-xs text-muted-foreground">
                {children}
            </PopoverContent>
        </Popover>
    );
}

/** The on/off chip for a league — the same chip style as game-create tags. */
function LeagueChip({
    selected,
    onClick,
    disabled,
    children,
}: {
    selected: boolean;
    onClick: () => void;
    disabled?: boolean;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-pressed={selected}
            className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-transparent text-muted-foreground hover:bg-accent",
                disabled && "opacity-50 cursor-not-allowed",
            )}
        >
            {children}
        </button>
    );
}

function NumberField({
    id,
    label,
    value,
    onChange,
    info,
}: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    info: string;
}) {
    return (
        <div className="flex items-center gap-1.5 text-sm">
            <label htmlFor={id} className="whitespace-nowrap">{label}:</label>
            <input
                id={id}
                type="number"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="border rounded px-2 py-1 w-24"
            />
            <InfoHint label={label}>{info}</InfoHint>
        </div>
    );
}
