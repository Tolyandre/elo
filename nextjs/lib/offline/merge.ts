// Field-level three-way merge for offline edit ops (ADR-37): a user's value
// applies only if they observed the value it overwrites — the optimistic-lock
// rule at field granularity. No silent override in either direction.

import type { PendingConflictField } from "./types";

export type MergeInput = {
    /** The entity as the form observed it when editing began. */
    base: Record<string, unknown>;
    /** The fields the user changed. */
    patch: Record<string, unknown>;
    /** The entity as the server holds it right now. */
    server: Record<string, unknown>;
};

export type MergeResult = {
    /** The values to send: user changes applied where safe, server values elsewhere. */
    merged: Record<string, unknown>;
    /** Both sides changed the same field differently — resolution happens on /offline. */
    conflicts: PendingConflictField[];
};

/**
 * Merges per key of the patch:
 * - user did not change the field (patch == base) → the server's value wins;
 * - user changed it and the server still holds the base → the user's value wins;
 * - both changed it differently → a conflict entry (ours/theirs as raw
 *   strings in a lossless encoding — JSON values stringified).
 */
export function mergeFields({ base, patch, server }: MergeInput, labelFor: (field: string) => string): MergeResult {
    const merged: Record<string, unknown> = { ...server };
    const conflicts: PendingConflictField[] = [];
    for (const field of Object.keys(patch)) {
        const mine = patch[field];
        const observed = base[field];
        const theirs = server[field];
        if (deepEqual(mine, observed)) {
            // Untouched by the user: whatever the server does wins.
            merged[field] = theirs;
        } else if (deepEqual(theirs, observed)) {
            // The user's informed change applies.
            merged[field] = mine;
        } else {
            merged[field] = mine;
            conflicts.push({
                field,
                label: labelFor(field),
                ours: stringifyValue(mine),
                theirs: stringifyValue(theirs),
            });
        }
    }
    return { merged, conflicts };
}

/** Applies the user's per-field choices to an op after /offline resolution: the chosen value becomes the patch, the server's last-known value the base — so the next sync merges cleanly. */
export function applyResolutions(
    base: Record<string, unknown>,
    patch: Record<string, unknown>,
    conflict: PendingConflictField[],
    resolutions: Record<string, string>,
): { base: Record<string, unknown>; patch: Record<string, unknown> } {
    const nextBase = { ...base };
    const nextPatch = { ...patch };
    for (const f of conflict) {
        const chosen = resolutions[f.field];
        if (chosen === undefined) continue;
        nextPatch[f.field] = parseValue(chosen);
        nextBase[f.field] = parseValue(f.theirs);
    }
    return { base: nextBase, patch: nextPatch };
}

export function stringifyValue(value: unknown): string {
    if (typeof value === "string") return value;
    return JSON.stringify(value) ?? "";
}

export function parseValue(raw: string): unknown {
    try {
        return JSON.parse(raw) as unknown;
    } catch {
        return raw;
    }
}

// Key-order-insensitive deep equality via stable stringify — the score map
// may arrive with its entries in a different order than the base observed.
function stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "";
    if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
    const keys = Object.keys(value).sort();
    return (
        "{" +
        keys
            .map((k) => JSON.stringify(k) + ":" + stableStringify((value as Record<string, unknown>)[k]))
            .join(",") +
        "}"
    );
}

function deepEqual(a: unknown, b: unknown): boolean {
    return stableStringify(a) === stableStringify(b);
}
