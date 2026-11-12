// The offline settlement engine (ADR-38): assembles the wasm replay's inputs
// from the Dexie ratings replica plus the pending offline queue, evaluates
// arena membership the way the server's SQL predicates do, and shapes the
// output for the UI (per-match settlement columns, arena standings overlays).
//
// Pure and DI-driven — the wasm bridge and time come in as arguments, so the
// suite runs it in plain Node (the wasm itself is exercised separately
// against the golden fixtures). Unplayable configurations (unsupported arena
// flavors, missing inputs) return null: the UI then renders the server's
// replica values verbatim — a wrong preview is worse than none (ADR-37).

import type { PendingMatch, PendingOp } from "@/lib/offline/types";
import type { LedgerRow, MatchReplicaRow, SettingsHistoryRow } from "@/lib/offline/db";
import type {
    WasmArenaStanding,
    WasmBridge,
    WasmEloSettingsEntry,
    WasmFrozenSettlement,
    WasmMatchSettlement,
    WasmReplayMatch,
} from "./wasm-client";
import { applyMatchOp, opToMatch } from "@/lib/offline/match-entity";
import type { Match } from "@/app/api/types";
import type { Base58ID } from "@/lib/id";

/** Tenant arena openness (ADR-36); the client replica of the tenant list. */
export type ArenaMembershipMode = "all" | "any_member" | "members_only";

/** The arena flavor the engine can replay. Camp/tournament arenas are
 * link-only (their membership lives in arena_matches, not mirrored) and are
 * not supported offline. */
export type EngineArena = {
    id: string;
    tenantId?: string | null;
    membershipMode?: ArenaMembershipMode | null;
    settings: unknown;
    settingsVersion: number;
    filter?: {
        date_from?: string | null;
        date_to?: string | null;
        game_ids?: string[] | null;
        tag_ids?: string[] | null;
    } | null;
};

export type EngineInput = {
    arena: EngineArena;
    matches: MatchReplicaRow[];
    pendingMatches: PendingMatch[];
    matchOps: PendingOp[];
    /** The arena's mirrored ledger rows with discriminator != 'match' — the
     * frozen market settlements the replay interleaves. */
    marketRows: LedgerRow[];
    settings: SettingsHistoryRow[];
    /** gameId → tag ids; null when unknown (tag-filter arenas then degrade). */
    gameTags?: (gameId: string) => string[] | null;
    now: Date;
    bridge: WasmBridge | null;
};

export type EngineResult = {
    /** Base58 match id → Base58 player id → settlement columns. */
    settlementsByMatch: Map<string, Record<string, WasmPlayerResultRow>>;
    standingsWeek: WasmArenaStanding[] | null;
    standingsDay: WasmArenaStanding[] | null;
    standingsNow: WasmArenaStanding[] | null;
};

/** The settlement columns a match card renders (camelCase client shape). */
export type WasmPlayerResultRow = {
    ratingStaked: number;
    ratingEarned: number;
    ratingAfter: number;
    league: string | null;
};

const EPOCH_INFINITY = "0001-01-01T00:00:00Z";

/** The rank-history offsets the server's snapshot reads use. */
export const DAY_AGO_OFFSET_MS = -12 * 60 * 60 * 1000;
export const WEEK_AGO_OFFSET_MS = -7 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000;

/** Minimal client Match for the op-overlay helpers (names are irrelevant). */
function replicaRowAsMatch(row: MatchReplicaRow): Match {
    return {
        id: row.id as Base58ID,
        game_id: row.gameId as Base58ID,
        game_name: "",
        score: Object.fromEntries(
            Object.entries(row.scores).map(([pid, v]) => [
                pid,
                { ratingStaked: null, ratingEarned: null, score: v, ratingAfter: null },
            ]),
        ),
        date: new Date(row.date),
        dateISO: row.date,
        has_markets: row.hasMarkets,
        mode: row.mode,
        game_score: null,
        game_won: null,
        camps: [],
    };
}

/** Applies the pending match ops onto the replica (match-entity's merge
 * semantics — the same the sync and the display use). */
export function overlayMatchOps(
    matches: MatchReplicaRow[],
    matchOps: PendingOp[],
): MatchReplicaRow[] {
    const byId = new Map<string, MatchReplicaRow>();
    for (const row of matches) byId.set(row.id, row);

    for (const op of matchOps) {
        if (op.kind !== "match" || op.op !== "update") continue;
        const existing = byId.get(op.entityId);
        const effective = existing ? applyMatchOp(replicaRowAsMatch(existing), op) : opToMatch(op);
        const date = effective.dateISO ?? (existing?.date ?? new Date(0).toISOString());
        const scores = Object.fromEntries(
            Object.entries(effective.score).map(([pid, s]) => [pid, s.score]),
        );
        byId.set(op.entityId, {
            id: op.entityId,
            date,
            gameId: effective.game_id,
            mode: effective.mode,
            scores,
            hasMarkets: effective.has_markets,
        });
    }
    return [...byId.values()];
}

/**
 * Evaluates the arena's membership the way the server's predicates do:
 * tenant arenas (mode `all`) admit every competitive match; filter arenas
 * evaluate the MatchFilter (date window; the game/tag OR-rule — a filter
 * with both lists empty admits every game). Coop never belongs to an arena
 * (ADR-33). Returns null when the arena flavor cannot be evaluated offline.
 */
export function arenaMembership(
    arena: EngineArena,
    match: { date: string; gameId: string; mode: "competitive" | "coop" },
    gameTags?: (gameId: string) => string[] | null,
): boolean | null {
    if (match.mode === "coop") return false;
    if (arena.tenantId) {
        // The stint-based openness modes need club-membership history the
        // client does not mirror (future phase, ADR-38).
        if (arena.membershipMode !== "all") return null;
        return true;
    }
    const filter = arena.filter;
    if (!filter) return null; // link-only flavors (camp/tournament) are not mirrored
    const date = new Date(match.date);
    if (filter.date_from && date < new Date(filter.date_from)) return false;
    if (filter.date_to && date > new Date(filter.date_to)) return false;
    const gameIds = filter.game_ids ?? [];
    const tagIds = filter.tag_ids ?? [];
    if (gameIds.length === 0 && tagIds.length === 0) return true;
    if (gameIds.includes(match.gameId)) return true;
    if (tagIds.length > 0) {
        // The client's games catalog does not carry tag ids, so a tag-filtered
        // arena can only be evaluated when the caller supplies the mapping —
        // otherwise the arena is unsupported (render replica values).
        const tags = gameTags?.(match.gameId);
        if (!tags) return null;
        if (tags.some((t) => tagIds.includes(t))) return true;
    }
    return false;
}

function toWasmSettings(rows: SettingsHistoryRow[]): WasmEloSettingsEntry[] {
    return rows.map((r) => ({
        effective_date: r.effective_date === "-infinity" ? EPOCH_INFINITY : r.effective_date,
        k: r.elo_const_k,
        d: r.elo_const_d,
        starting_elo: r.starting_elo,
        win_reward: r.win_reward,
        newbie_league_earned_min: r.newbie_league_earned_min,
        newbie_league_earned_max: r.newbie_league_earned_max,
        newbie_league_earned_tau: r.newbie_league_earned_tau,
        newbie_league_goal_gap: r.newbie_league_goal_gap,
        elite_league_matches_6m: r.elite_league_matches_6months,
        elite_league_matches_2m: r.elite_league_matches_2months,
    }));
}

function toFrozen(rows: LedgerRow[]): WasmFrozenSettlement[] {
    return rows
        .filter((r) => r.discriminator !== "match")
        .map((r) => ({
            id: r.id,
            player_id: r.player_id,
            date: r.date,
            rating_after: r.rating_after,
            elo_after: r.elo_after,
            rating_staked: r.rating_staked,
            rating_earned: r.rating_earned,
            elo_staked: r.elo_staked,
            elo_earned: r.elo_earned,
            league: r.league ?? null,
        }));
}

/**
 * Runs the offline replay for one arena. Returns null (render the server's
 * replica values) when the wasm is unavailable, the arena flavor is not
 * supported, or there are no local events — in the last case there is
 * nothing to recompute and the fast path avoids loading wasm at all.
 * Synchronous: the wasm bridge call is synchronous once loaded.
 */
export function runEngine(input: EngineInput): EngineResult | null {
    const { bridge, arena } = input;
    if (!bridge) return null;

    const hasLocalEvents = input.pendingMatches.length > 0 || input.matchOps.length > 0;
    if (!hasLocalEvents) return null;

    // Effective match set: replica overlayed by ops, plus pending creates.
    const effective = overlayMatchOps(input.matches, input.matchOps);
    for (const pm of input.pendingMatches) {
        effective.push({
            id: pm.clientId,
            date: pm.createdAt,
            gameId: pm.gameId,
            mode: pm.mode ?? "competitive",
            scores: { ...pm.score },
            hasMarkets: false,
        });
    }

    // Membership per arena; a null from the predicate means the arena flavor
    // cannot be evaluated at all — degrade for the whole arena.
    const members: WasmReplayMatch[] = [];
    for (const m of effective) {
        const isIn = arenaMembership(arena, m, input.gameTags);
        if (isIn === null) return null;
        if (isIn) members.push({ id: m.id, date: m.date, scores: m.scores });
    }

    const now = input.now;
    const out = bridge.replayArena({
        settings: arena.settings,
        settings_version: arena.settingsVersion,
        elo_settings: toWasmSettings(input.settings),
        matches: members,
        market_settlements: toFrozen(input.marketRows),
        // The server's rank-history order: week-ago, day-ago, now.
        snapshot_times: [
            new Date(now.getTime() + WEEK_AGO_OFFSET_MS).toISOString(),
            new Date(now.getTime() + DAY_AGO_OFFSET_MS).toISOString(),
            now.toISOString(),
        ],
    });

    const settlementsByMatch = new Map<string, Record<string, WasmPlayerResultRow>>();
    for (const s of out.settlements as WasmMatchSettlement[]) {
        settlementsByMatch.set(
            s.match_id,
            Object.fromEntries(
                Object.entries(s.players).map(([pid, r]) => [
                    pid,
                    {
                        ratingStaked: r.rating_staked,
                        ratingEarned: r.rating_earned,
                        ratingAfter: r.new_rating,
                        league: r.league ?? null,
                    },
                ]),
            ),
        );
    }
    const [week, day, nowStandings] = out.standings.map((s) => s.players);
    return {
        settlementsByMatch,
        standingsWeek: week ?? null,
        standingsDay: day ?? null,
        standingsNow: nowStandings ?? null,
    };
}
