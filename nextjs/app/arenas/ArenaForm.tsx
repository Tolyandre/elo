"use client";
import type { Base58ID } from "@/lib/id";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CloudOff } from "lucide-react";
import {
    Arena,
    ArenaSettings,
    MatchFilter,
    createArenaPromise,
    deleteArenaPromise,
    updateArenaPromise,
} from "@/app/api";
import { useGames } from "@/app/gamesContext";
import { useTags } from "@/app/tagsContext";
import { useMe } from "@/app/meContext";
import { useSettings } from "@/app/settingsContext";
import { useOffline } from "@/app/offline/OfflineContext";
import { GameMultiSelect } from "@/components/game-multi-select";
import { MultiSelect } from "@/components/vendor/multi-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, useConfirmAction } from "@/components/confirm-dialog";
import {
    ArenaSettingsFields,
    ArenaSettingsValues,
    SettingsDefaults,
    buildSettingsFromValues,
    initialSettingsValues,
    settingsValuesError,
} from "@/components/arena-settings-editor";
import { toDatetimeLocal } from "@/lib/datetime";

type ArenaFormValues = {
    name: string;
    gameIds: Base58ID[];
    tagIds: Base58ID[];
    dateFrom: string;
    dateTo: string;
} & ArenaSettingsValues;

function initialValues(existing: Arena | undefined, camp: boolean, defaults: SettingsDefaults): ArenaFormValues {
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
        ...initialSettingsValues(existing?.settings, {
            // A fresh arena starts like an auto-managed game arena (rating 900,
            // newbie + amateur); a fresh camp like the old tournament arenas —
            // rating = the starting elo, no leagues.
            startingRating: camp ? defaults.startingRating : defaults.startingRating ?? "900",
            withLeagues: !camp,
            catchUp: defaults.catchUp,
            goalGap: defaults.goalGap,
        }),
    };
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
    const settings = useSettings();
    const isEdit = !!existing;
    const isCamp = isEdit ? !!existing.camp : camp;
    const draftKey = isEdit ? `${existing.id}${isCamp ? ":camp" : ""}` : isCamp ? "new-camp" : "new";

    const [values, setValues] = useState<ArenaFormValues>(() => initialValues(existing, isCamp, {
        startingRating: String(settings.startingElo),
        catchUp: {
            earnedMin: String(settings.newbieLeagueEarnedMin),
            earnedMax: String(settings.newbieLeagueEarnedMax),
            tau: String(settings.newbieLeagueEarnedTau),
        },
        goalGap: String(settings.newbieLeagueGoalGap),
    }));
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        try {
            const raw = localStorage.getItem(ARENA_FORM_DRAFT_KEY);
            if (!raw) return;
            const draft = JSON.parse(raw) as ArenaFormDraft;
            if (draft.key !== draftKey) return;
            // A draft from before a values-shape change misses fields — as
            // good as none (an undefined catchUp would crash the render).
            if (!draft.startingRating || !draft.leagues || !draft.catchUp) return;
            /* eslint-disable react-hooks/set-state-in-effect -- restore the saved draft after mount; localStorage is client-only, so it cannot run during render */
            setValues({
                name: draft.name,
                gameIds: draft.gameIds,
                tagIds: draft.tagIds,
                dateFrom: draft.dateFrom,
                dateTo: draft.dateTo,
                startingRating: draft.startingRating,
                catchUp: draft.catchUp,
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
        const settingsError = settingsValuesError(values);
        if (settingsError) {
            setError(settingsError);
            return;
        }
        setError("");
        setSubmitting(true);
        // Camp settings have no leagues (ADR-27: camps rank like the old
        // tournament arenas) — the camp form never renders the league
        // controls, so their chips stay off and the built document carries
        // leagues: [].
        const settingsDoc: ArenaSettings = buildSettingsFromValues(values);
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
                    settings: settingsDoc,
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
                    settings: settingsDoc,
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
        <form onSubmit={handleSubmit} className="space-y-4">
            {offline && (
                <Alert variant="destructive">
                    <CloudOff />
                    <AlertTitle>Нет связи с сервером — управление аренами недоступно</AlertTitle>
                    <AlertDescription>Попробуйте снова, когда соединение восстановится.</AlertDescription>
                </Alert>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>Название</CardTitle>
                    <CardDescription>Название должно быть уникальным.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-1.5">
                    <Input
                        id="arenaName"
                        type="text"
                        value={values.name}
                        placeholder={defaultName || "Название арены"}
                        onChange={(e) => set("name", e.target.value)}
                    />
                    {defaultName && (
                        <p className="text-xs text-muted-foreground">
                            По умолчанию:{" "}
                            <button
                                type="button"
                                onClick={() => set("name", defaultName)}
                                className="text-info underline decoration-dashed underline-offset-2"
                            >
                                {defaultName}
                            </button>
                        </p>
                    )}
                </CardContent>
            </Card>

            {!isCamp && (
                <Card>
                    <CardHeader>
                        <CardTitle>Игры и теги</CardTitle>
                        <CardDescription>
                            Партия попадает в арену, когда совпадает её игра или тег игр.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-1.5">
                            <label className="block text-sm" htmlFor="arenaGames">Игры:</label>
                            <GameMultiSelect value={values.gameIds} onChange={(ids) => set("gameIds", ids)} />
                        </div>
                        <div className="space-y-1.5">
                            <label className="block text-sm" htmlFor="arenaTags">Теги игр:</label>
                            <MultiSelect
                                options={tagOptions}
                                placeholder="Выберите теги"
                                searchPlaceholder="Искать тег..."
                                hideSelectAll={true}
                                onValueChange={(ids: string[]) => set("tagIds", ids as Base58ID[])}
                                defaultValue={values.tagIds}
                            />
                        </div>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>{isCamp ? "Окно кэмпа" : "Даты"}</CardTitle>
                    <CardDescription>
                        {isCamp
                            ? "Кэмп собирает партии между началом и окончанием."
                            : "Необязательное окно: партии вне его не попадают в арену."}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col sm:flex-row gap-4">
                        <div className="flex-1 min-w-0 space-y-1.5">
                            <label className="block text-sm" htmlFor="arenaDateFrom">{isCamp ? "Начало:" : "Начало (необязательно):"}</label>
                            <Input
                                id="arenaDateFrom"
                                type="datetime-local"
                                value={values.dateFrom}
                                onChange={(e) => set("dateFrom", e.target.value)}
                                required={isCamp}
                            />
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                            <label className="block text-sm" htmlFor="arenaDateTo">{isCamp ? "Окончание:" : "Окончание (необязательно):"}</label>
                            <Input
                                id="arenaDateTo"
                                type="datetime-local"
                                value={values.dateTo}
                                onChange={(e) => set("dateTo", e.target.value)}
                                required={isCamp}
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{isCamp ? "Рейтинг" : "Рейтинг и лиги"}</CardTitle>
                    <CardDescription>
                        {isCamp
                            ? "Смена стартового рейтинга пересчитывает рейтинг кэмпа заново — в фоне, уже после сохранения."
                            : "Смена стартового рейтинга или лиг пересчитывает рейтинг арены заново — в фоне, уже после сохранения."}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ArenaSettingsFields
                        values={{ startingRating: values.startingRating, catchUp: values.catchUp, leagues: values.leagues }}
                        onChange={(settings) => setValues((v) => ({ ...v, ...settings }))}
                        disabled={!canEdit}
                        startingElo={settings.startingElo}
                        withLeagues={!isCamp}
                        heading={false}
                    />
                </CardContent>
            </Card>

            {error && <div className="text-destructive text-sm">{error}</div>}

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
