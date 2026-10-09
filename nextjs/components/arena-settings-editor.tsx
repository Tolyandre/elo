"use client";

import React from "react";
import { InfoIcon } from "lucide-react";
// Type-only: this module must stay runnable outside the app (vitest), so no
// runtime dependency on the api client.
import type { ArenaSettings, ArenaSettingsDoc } from "@/app/api";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * The "starting rating + leagues" part of an arena's settings document
 * (ADR-24), shared by the arena form and the tenant settings page (ADR-36
 * phase 5 — a main arena's settings are edited through the tenant).
 */

export type LeagueValues = {
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

export type ArenaSettingsValues = {
    startingRating: string;
    leagues: LeagueValues;
};

/** Parses the stored settings document into form values, filling defaults for a fresh arena (with newbie + amateur) or a fresh camp (no leagues) when absent. */
export function initialSettingsValues(
    existing?: ArenaSettings | null,
    defaults?: { startingRating?: string; withLeagues?: boolean },
): ArenaSettingsValues {
    const withLeagues = defaults?.withLeagues ?? true;
    // The wire type is opaque; the v1 shape is reproduced by ArenaSettingsDoc.
    const doc = existing ? (existing as unknown as ArenaSettingsDoc) : null;
    const newbie = doc?.leagues.find((l) => l.kind === "newbie");
    const elite = doc?.leagues.find((l) => l.kind === "elite");
    return {
        // A new arena starts like an auto-managed game arena: rating 900,
        // newbie + amateur. A new camp starts like the old tournament arenas:
        // rating = the starting elo (1000), no leagues.
        startingRating: doc ? String(doc.starting_rating) : defaults?.startingRating ?? (withLeagues ? "900" : "1000"),
        leagues: {
            newbie: doc ? !!newbie : withLeagues,
            amateur: doc ? doc.leagues.some((l) => l.kind === "amateur") : withLeagues,
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

/** Assembles the settings document from the form values (the server re-validates). */
export function buildSettingsFromValues(values: ArenaSettingsValues): ArenaSettings {
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
export function settingsValuesError(values: ArenaSettingsValues): string | null {
    const nonNegative = (s: string) => Number.isFinite(Number(s)) && Number(s) >= 0;
    const { leagues } = values;
    if (!Number.isFinite(Number(values.startingRating))) {
        return "Стартовый рейтинг должен быть числом";
    }
    // The server rejects a single league (the settings schema): one league
    // would only rename the caption above the players list. None or >= 2.
    if ([leagues.newbie, leagues.amateur, leagues.elite].filter(Boolean).length === 1) {
        return "Выберите хотя бы две лиги либо отключите все — одиночная лига бессмысленна";
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

/** The "?" beside a setting: an info icon opening a small popover — the same pattern as the market guarantors description. */
export function InfoHint({ label, children }: { label: string; children: React.ReactNode }) {
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
export function LeagueChip({
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
    disabled,
}: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    info: string;
    disabled?: boolean;
}) {
    return (
        <div className="flex items-center gap-1.5 text-sm">
            <label htmlFor={id} className="whitespace-nowrap">{label}:</label>
            <Input
                id={id}
                type="number"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                className="w-24"
            />
            <InfoHint label={label}>{info}</InfoHint>
        </div>
    );
}

/**
 * The rating + leagues fields of an arena settings document. `idPrefix`
 * namespaces the inputs' ids so several forms can coexist on one page.
 * `heading={false}` drops the built-in «Рейтинг и лиги» heading when the
 * fields are embedded in a titled card.
 */
export function ArenaSettingsFields({
    values,
    onChange,
    disabled = false,
    idPrefix = "arena",
    heading = true,
}: {
    values: ArenaSettingsValues;
    onChange: (values: ArenaSettingsValues) => void;
    disabled?: boolean;
    idPrefix?: string;
    heading?: boolean;
}) {
    function set<K extends keyof ArenaSettingsValues>(field: K, value: ArenaSettingsValues[K]) {
        onChange({ ...values, [field]: value });
    }

    function setLeague<K extends keyof LeagueValues>(field: K, value: LeagueValues[K]) {
        onChange({ ...values, leagues: { ...values.leagues, [field]: value } });
    }

    return (
        <div className="space-y-3">
            {heading && <h2 className="font-semibold">Рейтинг и лиги:</h2>}
            <div className="flex items-center gap-2 text-sm">
                <label htmlFor={`${idPrefix}StartingRating`}>Стартовый рейтинг:</label>
                <Input
                    id={`${idPrefix}StartingRating`}
                    type="number"
                    value={values.startingRating}
                    onChange={(e) => set("startingRating", e.target.value)}
                    disabled={disabled}
                    className="w-24"
                />
                <InfoHint label="Что такое стартовый рейтинг">
                    <p>Рейтинг, с которого игрок начинает в этой арене, пока не сыграл в ней ни одной партии.</p>
                </InfoHint>
            </div>

            <p className="text-xs text-muted-foreground">
                Лиги — уровни таблицы в порядке повышения. Если лиг нет, игроки идут одним списком, а рейтинг равен эло.
            </p>

            <div className="flex flex-wrap gap-1 items-center">
                <LeagueChip
                    selected={values.leagues.newbie}
                    onClick={() => setLeague("newbie", !values.leagues.newbie)}
                    disabled={disabled}
                >
                    Новички
                </LeagueChip>
                <LeagueChip
                    selected={values.leagues.amateur}
                    onClick={() => setLeague("amateur", !values.leagues.amateur)}
                    disabled={disabled}
                >
                    Любители
                </LeagueChip>
                <LeagueChip
                    selected={values.leagues.elite}
                    onClick={() => setLeague("elite", !values.leagues.elite)}
                    disabled={disabled}
                >
                    Высшая лига
                </LeagueChip>
            </div>

            {values.leagues.newbie && (
                <div className="space-y-2">
                    <NumberField
                        id={`${idPrefix}GoalGap`}
                        label="Разрыв эло"
                        value={values.leagues.goalGap}
                        onChange={(v) => setLeague("goalGap", v)}
                        disabled={disabled}
                        info="Пока эло игрока выше его рейтинга больше чем на это значение, он остаётся в лиге новичков. Новичок с меньшим отрывом сразу попадает в следующую лигу."
                    />
                    <NumberField
                        id={`${idPrefix}EarnedMin`}
                        label="Мин. очков за победу"
                        value={values.leagues.earnedMin}
                        onChange={(v) => setLeague("earnedMin", v)}
                        disabled={disabled}
                        info="Нижняя граница очков рейтинга за победу, пока рейтинг игрока догоняет его эло."
                    />
                    <NumberField
                        id={`${idPrefix}EarnedMax`}
                        label="Макс. очков за победу"
                        value={values.leagues.earnedMax}
                        onChange={(v) => setLeague("earnedMax", v)}
                        disabled={disabled}
                        info="Верхняя граница очков рейтинга за победу, пока рейтинг игрока догоняет его эло."
                    />
                    <NumberField
                        id={`${idPrefix}Tau`}
                        label="τ"
                        value={values.leagues.tau}
                        onChange={(v) => setLeague("tau", v)}
                        disabled={disabled}
                        info="τ (Тау) — плавность догоняющего бонуса: чем больше τ, тем медленнее очки за победу растут при отставании рейтинга от эло."
                    />
                </div>
            )}

            {/* The entry/holding requirements only matter when a league below
                exists to promote from — in an elite-only arena everyone is in
                it from the start (and the server never demotes out of the only
                league), so the counts would be dead configuration. */}
            {values.leagues.elite && (values.leagues.newbie || values.leagues.amateur) && (
                <div className="space-y-2">
                    <NumberField
                        id={`${idPrefix}Matches6m`}
                        label="Партий за полгода"
                        value={values.leagues.matches6m}
                        onChange={(v) => setLeague("matches6m", v)}
                        disabled={disabled}
                        info="Партий за последние 6 месяцев, нужных для входа и удержания в высшей лиге."
                    />
                    <NumberField
                        id={`${idPrefix}Matches2m`}
                        label="Партий за 2 месяца"
                        value={values.leagues.matches2m}
                        onChange={(v) => setLeague("matches2m", v)}
                        disabled={disabled}
                        info="Партий за последние 2 месяца, нужных для входа и удержания в высшей лиге."
                    />
                </div>
            )}
        </div>
    );
}
