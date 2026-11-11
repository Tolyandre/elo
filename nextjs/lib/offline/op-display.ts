// Display helpers for queued edit ops (ADR-37): what the /offline queue page
// shows about an op. Pure — names come in through the `helpers` callbacks so
// the functions stay unit-testable without React contexts.

import { formatDateTime } from "@/lib/datetime";import { formatScore } from "@/lib/audit-display";
import { GAME_MODE_LABELS, type GameMode, type MatchMode } from "@/lib/game-modes";
import { accentName } from "@/lib/game-names";
import { deepEqual } from "./merge";
import type { PendingOp, OpEntityKind } from "./types";

/** Field → label map for the match-op merge; shared by the sync conflicts
 * and the /offline change list so both speak the same words. */
export const MATCH_FIELD_LABELS: Record<string, string> = {
    game_id: "Игра",
    date: "Дата",
    camp_arena_ids: "Кэмпы",
    mode: "Режим",
    player_ids: "Участники",
    game_score: "Игровой счёт",
    game_won: "Результат",
    calculator_kind: "Калькулятор",
    calculator_data: "Данные калькулятора",
};

const GAME_FIELD_LABELS: Record<string, string> = {
    alias: "Псевдоним",
    name_ru: "Название (рус)",
    name_en: "Name (eng)",
    game_mode: "Режим",
    bgg_ref: "BGG",
    tesera_ref: "Tesera",
};

const MATCH_MODE_LABELS: Record<MatchMode, string> = {
    competitive: "соревновательная",
    coop: "кооперативная",
};

/** Resolvers the change rows need; backed by app contexts at the call site. */
export type OpNameHelpers = {
    gameName: (id: string) => string;
    playerName: (id: string) => string;
    campName: (id: string) => string;
};

/** One changed field. Values are display-ready strings. */
export type OpChangeRow =
    | { kind: "value"; label: string; from: string | null; to: string | null }
    /** Set-valued fields (camps, coop participants): who joined / left. */
    | { kind: "collection"; label: string; added: string[]; removed: string[] }
    /** One player's score: appeared, disappeared, or moved. */
    | { kind: "score"; label: string; change: "added" | "removed" | "changed"; from: string | null; to: string | null }
    /** An opaque blob changed (calculator state) — no meaningful before/after. */
    | { kind: "opaque"; label: string };

/**
 * A human name for the op's entity, from the queued fields alone: a player's
 * new (or former) name, a game's display name derived alias → ru → en — never
 * the raw entity id. Matches have no queued name.
 */
export function opEntityName(op: PendingOp): string | undefined {
    const merged = { ...op.base, ...op.patch };
    if (op.kind === "player") {
        const name = merged.name;
        return typeof name === "string" && name ? name : undefined;
    }
    if (op.kind === "game") {
        const game = {
            name: "",
            alias: (merged.alias ?? null) as string | null,
            name_ru: (merged.name_ru ?? null) as string | null,
            name_en: (merged.name_en ?? null) as string | null,
        };
        return accentName(game) || undefined;
    }
    return undefined;
}

/**
 * Changed fields of an update op as display rows, in a stable field order.
 * Only keys present in the patch can differ; a key equal to the base is
 * skipped (the form only lists touched fields, but conflict resolution may
 * rewrite the patch to the server's value — that reads as "no change").
 */
export function opChangeRows(
    kind: OpEntityKind,
    base: Record<string, unknown>,
    patch: Record<string, unknown>,
    helpers: OpNameHelpers,
): OpChangeRow[] {
    const rows: OpChangeRow[] = [];
    for (const field of orderedFields(kind, Object.keys(patch))) {
        const from = base[field];
        const to = patch[field];
        if (equal(from, to)) continue;
        if (kind === "match" && field === "score") {
            rows.push(...scoreRows((from ?? {}) as Record<string, number>, (to ?? {}) as Record<string, number>, helpers));
            continue;
        }
        // The calculator state is an opaque per-kind document: «изменены»
        // beats a JSON dump in the diff.
        if (kind === "match" && field === "calculator_data") {
            rows.push({ kind: "opaque", label: label(kind, field) });
            continue;
        }
        if (field === "camp_arena_ids" || field === "player_ids") {
            const row = collectionRow(field, from, to, helpers);
            // A reorder-only diff reads as no change — nothing joined or left.
            if (row.added.length > 0 || row.removed.length > 0) rows.push(row);
            continue;
        }
        // A changed game renders as its name — a raw id is exactly what this
        // page must not show.
        const fmt = field === "game_id"
            ? (v: unknown) => (v == null ? null : helpers.gameName(String(v)))
            : (v: unknown) => format(field, v);
        rows.push({ kind: "value", label: label(kind, field), from: fmt(from), to: fmt(to) });
    }
    return rows;
}

function orderedFields(kind: OpEntityKind, fields: string[]): string[] {
    const order = kind === "match"
        ? ["game_id", "date", "score", "mode", "player_ids", "game_score", "game_won", "camp_arena_ids", "calculator_kind", "calculator_data"]
        : kind === "game"
            ? ["alias", "name_ru", "name_en", "game_mode", "bgg_ref", "tesera_ref"]
            : ["name"];
    return [...fields].sort((a, b) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
    });
}

function label(kind: OpEntityKind, field: string): string {
    if (kind === "match") return MATCH_FIELD_LABELS[field] ?? field;
    if (kind === "game") return GAME_FIELD_LABELS[field] ?? field;
    return "Имя";
}

function format(field: string, value: unknown): string | null {
    if (value == null) return null;
    if (field === "date") return formatDateTime(String(value));
    if (field === "game_mode" && typeof value === "string") {
        return value in GAME_MODE_LABELS ? GAME_MODE_LABELS[value as GameMode] : value;
    }
    if (field === "mode" && typeof value === "string") {
        return value in MATCH_MODE_LABELS ? MATCH_MODE_LABELS[value as MatchMode] : value;
    }
    if (field === "game_won") return value === true ? "Победа" : "Поражение";
    if (field === "game_score" || field === "bgg_ref" || field === "tesera_ref") return formatScore(Number(value));
    return String(value);
}

function scoreRows(
    from: Record<string, number>,
    to: Record<string, number>,
    helpers: OpNameHelpers,
): OpChangeRow[] {
    const ids = [...new Set([...Object.keys(from), ...Object.keys(to)])];
    const rows: OpChangeRow[] = [];
    for (const id of ids) {
        const name = helpers.playerName(id);
        const old = id in from ? from[id] : undefined;
        const next = id in to ? to[id] : undefined;
        if (old === next) continue;
        if (old === undefined) {
            rows.push({ kind: "score", label: name, change: "added", from: null, to: formatScore(next) });
        } else if (next === undefined) {
            rows.push({ kind: "score", label: name, change: "removed", from: formatScore(old), to: null });
        } else {
            rows.push({ kind: "score", label: name, change: "changed", from: formatScore(old), to: formatScore(next) });
        }
    }
    // Same order the pending card ranks players by: highest score first for
    // stable display.
    return rows.sort((a, b) => a.label.localeCompare(b.label));
}

function collectionRow(
    field: string,
    from: unknown,
    to: unknown,
    helpers: OpNameHelpers,
): Extract<OpChangeRow, { kind: "collection" }> {
    const nameOf = field === "camp_arena_ids" ? helpers.campName : helpers.playerName;
    const oldIds = new Set(((from ?? []) as string[]).map(String));
    const newIds = new Set(((to ?? []) as string[]).map(String));
    const added = [...newIds].filter((id) => !oldIds.has(id)).map(nameOf);
    const removed = [...oldIds].filter((id) => !newIds.has(id)).map(nameOf);
    return {
        kind: "collection",
        label: field === "camp_arena_ids" ? MATCH_FIELD_LABELS.camp_arena_ids : MATCH_FIELD_LABELS.player_ids,
        added,
        removed,
    };
}

function equal(a: unknown, b: unknown): boolean {
    return deepEqual(a, b);
}
