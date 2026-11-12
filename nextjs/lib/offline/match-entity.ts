// The client-side match entity (ADR-37): one read model over the three places
// a match exists — the server read (MatchesContext row / tenant-scoped detail
// fetch), the pending-create queue (store.matches) and a queued edit op
// (store.ops; matches have no delete op — the server has no delete endpoint).
// Surfaces build their display state through this class, so a queued edit is
// visible the moment it is made — on the view page, the feed and the /offline
// queue alike — and vanishes when the sync lands (the op is dropped, the
// server read takes over).
//
// Pure and context-free: names come in through `helpers` so the class stays
// unit-testable; the React glue lives in hooks and the unified MatchCard.

import type { Match, MatchCamp } from "@/app/api";
import type { Base58ID } from "@/lib/id";
import { deepEqual } from "./merge";
import { opChangeRows, type OpChangeRow, type OpNameHelpers } from "./op-display";
import type { PendingMatch, PendingOp, PendingConflictField, SyncStatus } from "./types";

/** The sources a surface already holds for one match. */
export type MatchEntitySource = {
    /** The server match (MatchesContext row or the tenant-scoped detail fetch). */
    saved?: Match | null;
    /** The offline-created match, not yet on the server (store.matches). */
    pending?: PendingMatch | null;
    /** A queued edit of the saved match (store.ops). */
    op?: PendingOp | null;
};

export type MatchEntityHelpers = OpNameHelpers;

export class MatchEntity {
    private constructor(
        readonly id: Base58ID,
        readonly saved: Match | null,
        readonly pending: PendingMatch | null,
        readonly op: PendingOp | null,
    ) {}

    /**
     * Resolve the entity for `id` from the sources a surface already holds.
     * Null when none of them knows the match — the caller decides how to load
     * it (context, detail fetch).
     */
    static resolve(id: Base58ID, source: MatchEntitySource): MatchEntity | null {
        const saved = source.saved ?? null;
        const pending = source.pending ?? null;
        const op = source.op ?? null;
        if (!saved && !pending && !op) return null;
        return new MatchEntity(id, saved, pending, op);
    }

    /** Queue status of the unsaved part; null for a fully synced match. */
    get status(): SyncStatus | null {
        return this.pending?.status ?? this.op?.status ?? null;
    }

    get error(): string | undefined {
        return this.pending?.error ?? this.op?.error;
    }

    get conflict(): PendingConflictField[] | undefined {
        return this.pending?.conflict ?? this.op?.conflict;
    }

    /** True while any part of the display state is not on the server yet. */
    get hasPendingChanges(): boolean {
        return this.pending != null || this.op != null;
    }

    /** True when the match exists only as a queued create. */
    get isPendingCreate(): boolean {
        return this.pending != null;
    }

    /**
     * The display state as a frontend Match — the unified MatchCard's input.
     * A queued edit renders exactly what the sync's three-way merge will PUT
     * (base + patch), so what the user sees is what the server will get.
     */
    effective(helpers?: MatchEntityHelpers): Match {
        if (this.pending) return pendingMatchToMatch(this.pending, helpers);
        if (this.saved) return this.op ? applyMatchOp(this.saved, this.op, helpers) : this.saved;
        if (this.op) return opToMatch(this.op, helpers);
        // resolve() refuses to build a sourceless entity.
        throw new Error(`MatchEntity ${this.id} has no source`);
    }

    /**
     * The queued edit's changed fields as audit-style display rows (the same
     * rows the /offline queue shows). Empty for a pending create — there is
     * no server state to diff against.
     */
    changes(helpers: MatchEntityHelpers): OpChangeRow[] {
        if (!this.op || this.op.op !== "update") return [];
        return opChangeRows("match", this.op.base ?? {}, this.op.patch ?? {}, helpers);
    }
}

/**
 * Inputs for editing a match that may already carry a queued edit. The form
 * prefills from the effective (op-overlaid) state — the user's latest intent
 * — while the three-way merge base stays the originally observed server
 * state: one op per entity, and the patch is the complete desired set, so a
 * re-edit accumulates (fields changed by the first edit still apply at sync
 * even when the second edit leaves them alone). `base` is null for a first
 * edit — the caller captures it from the server read.
 */
export function matchEditInputs(
    saved: Match,
    op: PendingOp | null,
    helpers?: MatchEntityHelpers,
): { view: Match; base: Record<string, unknown> | null } {
    const entity = MatchEntity.resolve(saved.id, { saved, op });
    return {
        view: entity ? entity.effective(helpers) : saved,
        base: op?.base ?? null,
    };
}

/** Score rows of an unsynced display state: no settlement columns — they do
 * not exist yet (queued create) or describe the pre-edit match (queued edit).
 * matchSettled() reads false, so the card hides the server widgets and the
 * Elo preview can fill the column. */
function unsetScoreRow(value: number): Match["score"][string] {
    return { ratingStaked: null, ratingEarned: null, score: value, ratingAfter: null };
}

/** The locally replayed settlement columns for one player (ADR-38). */
export type LocalSettlementColumns = {
    ratingStaked: number;
    ratingEarned: number;
    ratingAfter: number;
};

/**
 * Fills the unset settlement columns of an unsynced display state from the
 * local replay (ADR-38): pending creates and offline edits get provisional
 * rating values (marked by the card's pending styling); rows the server
 * already settled keep their server values, and players outside the arena's
 * settlement stay null (the card renders nothing for them). No-op without a
 * settlement — the pre-ADR-38 rendering.
 */
export function withLocalSettlement(
    match: Match,
    settlement: Record<string, LocalSettlementColumns> | null,
): Match {
    if (!settlement) return match;
    let touched = false;
    const score = Object.fromEntries(
        Object.entries(match.score).map(([pid, row]) => {
            if (row.ratingStaked !== null && row.ratingEarned !== null) return [pid, row];
            const local = settlement[pid];
            if (!local) return [pid, row];
            touched = true;
            return [
                pid,
                {
                    ...row,
                    ratingStaked: local.ratingStaked,
                    ratingEarned: local.ratingEarned,
                    ratingAfter: local.ratingAfter,
                },
            ];
        }),
    );
    return touched ? { ...match, score } : match;
}

function campList(ids: Base58ID[] | undefined, known: MatchCamp[], helpers?: MatchEntityHelpers): MatchCamp[] {
    if (!ids || ids.length === 0) return [];
    return ids.map((id) => known.find((c) => c.id === id) ?? { id, name: helpers?.campName(String(id)) ?? String(id) });
}

/**
 * The queued create as a frontend Match. `createdAt` doubles as the date —
 * the convention the op display always used (a queued create has no separate
 * date field; sync sends it as the match date).
 */
export function pendingMatchToMatch(pm: PendingMatch, helpers?: MatchEntityHelpers): Match {
    const entries: [string, number][] = pm.mode === "coop"
        ? (pm.playerIds ?? Object.keys(pm.score)).map((id) => [id, 0])
        : Object.entries(pm.score);
    const score: Match["score"] = {};
    for (const [pid, value] of entries) {
        score[pid] = unsetScoreRow(value);
    }
    return {
        id: pm.clientId,
        game_id: pm.gameId,
        // The card resolves the display name from the games context; a queued
        // create has no server name to carry.
        game_name: "",
        date: new Date(pm.createdAt),
        dateISO: pm.createdAt,
        score,
        has_markets: false,
        mode: pm.mode ?? "competitive",
        game_score: pm.gameScore ?? null,
        game_won: pm.gameWon ?? null,
        camps: campList(pm.campArenaIds, [], helpers),
        tournament: null,
        calculator_kind: pm.calculatorKind ?? null,
        calculator_data: pm.calculatorData ?? null,
    };
}

/**
 * The saved match with a queued edit applied — the same merged state the
 * sync's three-way merge (lib/offline/sync.ts mergeMatchOp) will PUT:
 *
 * - patch score keys merge three-way against the base and the server read
 *   (an untouched key shows the server's value — never override what the
 *   user has not observed; a touched key shows the user's value);
 * - base score keys the patch omits are players the user removed — dropped;
 * - keys the server added since the base (absent from base and patch) stay.
 *
 * Settlement columns are nulled: they describe the pre-edit match and would
 * read as rating changes that never happened — the card shows no rating
 * values until the sync re-settles.
 */
export function applyMatchOp(match: Match, op: PendingOp, helpers?: MatchEntityHelpers): Match {
    const base = op.base ?? {};
    const patch = op.patch ?? {};
    const merged = { ...base, ...patch };
    const baseScore = (base.score ?? {}) as Record<string, number>;
    const patchScore = (patch.score ?? {}) as Record<string, number>;
    const serverScore = Object.fromEntries(Object.entries(match.score).map(([pid, s]) => [pid, s.score]));
    const mergedScore: Record<string, number> = { ...serverScore };
    for (const [pid, value] of Object.entries(patchScore)) {
        mergedScore[pid] = deepEqual(value, baseScore[pid]) ? (serverScore[pid] ?? value) : value;
    }
    if ("score" in patch) {
        for (const pid of Object.keys(baseScore)) {
            if (!(pid in patchScore)) delete mergedScore[pid];
        }
    }

    const mode = (merged.mode as Match["mode"] | undefined) ?? match.mode;
    const score: Match["score"] = {};
    if (mode === "coop") {
        // Coop participants are the player list; score keys cover them
        // server-side (zero-scored), but a queued conversion may only carry
        // one of the two — union to be safe.
        const playerIds = (merged.player_ids as Base58ID[] | undefined) ?? [];
        for (const pid of new Set<string>([...playerIds, ...Object.keys(mergedScore)])) {
            score[pid] = unsetScoreRow(mergedScore[pid] ?? 0);
        }
    } else {
        for (const [pid, value] of Object.entries(mergedScore)) {
            score[pid] = unsetScoreRow(value);
        }
    }

    const gameId = (merged.game_id as Base58ID | undefined) ?? match.game_id;
    const dateISO = typeof merged.date === "string" && merged.date ? merged.date : match.dateISO;

    return {
        ...match,
        game_id: gameId,
        // A swapped game has no server name — the card resolves it from the
        // games context instead of showing the old game's name.
        game_name: gameId === match.game_id ? match.game_name : "",
        date: dateISO ? new Date(dateISO) : match.date,
        dateISO,
        score,
        mode,
        game_score: merged.game_score !== undefined ? Number(merged.game_score) : match.game_score,
        game_won: merged.game_won !== undefined ? Boolean(merged.game_won) : match.game_won,
        camps: campList(merged.camp_arena_ids as Base58ID[] | undefined, match.camps, helpers),
    };
}

/**
 * A queued edit without the server read at hand (e.g. the /offline queue):
 * the display state built from the op's fields alone — the route
 * `pendingMatchFromOp` used before the entity class absorbed it.
 */
export function opToMatch(op: PendingOp, helpers?: MatchEntityHelpers): Match {
    const base = op.base ?? {};
    const patch = op.patch ?? {};
    const merged = { ...base, ...patch };
    // Without the server read the patch's score set is the desired state —
    // base keys the patch omits are user-removed, the same removal semantics
    // the sync applies (guarded on the patch carrying a score map at all).
    const baseScore = (base.score ?? {}) as Record<string, number>;
    const patchScore = (patch.score ?? {}) as Record<string, number>;
    const score = (merged.mode as Match["mode"] | undefined) === "coop" || !("score" in patch)
        ? { ...baseScore, ...patchScore }
        : { ...patchScore };
    const pm: PendingMatch = {
        clientId: op.entityId,
        createdAt: typeof merged.date === "string" && merged.date ? merged.date : op.createdAt,
        status: op.status,
        ...(op.error !== undefined ? { error: op.error } : {}),
        ...(op.conflict ? { conflict: op.conflict } : {}),
        gameId: merged.game_id as Base58ID,
        score,
        ...(merged.mode !== undefined ? { mode: merged.mode as PendingMatch["mode"] } : {}),
        ...(merged.player_ids !== undefined ? { playerIds: merged.player_ids as Base58ID[] } : {}),
        ...(merged.game_score !== undefined ? { gameScore: Number(merged.game_score) } : {}),
        ...(merged.game_won !== undefined ? { gameWon: Boolean(merged.game_won) } : {}),
        campArenaIds: (merged.camp_arena_ids ?? []) as Base58ID[],
        ...(merged.calculator_kind !== undefined ? { calculatorKind: (merged.calculator_kind as string | null) ?? null } : {}),
        ...(merged.calculator_data !== undefined ? { calculatorData: merged.calculator_data as Record<string, unknown> | null } : {}),
    };
    return pendingMatchToMatch(pm, helpers);
}
