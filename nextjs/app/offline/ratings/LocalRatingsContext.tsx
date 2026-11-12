"use client";

// Local ratings (ADR-38): owns the wasm settlement bridge and the memoized
// per-arena replays over the Dexie ratings replica plus the pending offline
// queue. Consumers:
//   - match cards fill the settlement columns of pending/edited matches
//     (getMatchSettlement — the tenant's main arena scope, like the server's
//     ?tenant= reads);
//   - the arena view overlays locally recomputed standings/medals onto the
//     mirrored server snapshot (getArenaOverlay).
// Everything is provisional by definition and refined by the server after
// sync; when the wasm is unavailable or an arena flavor is unsupported the
// overlays are simply absent (the pre-ADR-38 rendering).

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { components } from "@/app/api-types.gen";
import type { ArenaPlayer } from "@/app/api/types";
import { useOffline } from "@/app/offline/OfflineContext";
import { useTenants } from "@/app/tenantsContext";
import {
    loadSettlementWasm,
    type WasmArenaStanding,
    type WasmBridge,
} from "@/lib/offline/ratings/wasm-client";
import {
    runEngine,
    type EngineArena,
    type EngineResult,
    type TenantMembershipContext,
} from "@/lib/offline/ratings/engine";
import {
    ensureSettingsHistory,
} from "@/lib/offline/ratings/hydrate";
import {
    readRatingsReplica,
    subscribeClubStints,
    subscribeGameTags,
    subscribeRatingsReplica,
    type ClubStintsRow,
    type RatingsReplicaSnapshot,
} from "@/lib/offline/db";

/** The settlement columns a match card renders, filled from the local replay. */
export type LocalSettlement = {
    ratingStaked: number;
    ratingEarned: number;
    ratingAfter: number;
};

type LocalRatingsState = {
    /** True when the wasm bridge loaded (false = overlays off, replica only). */
    engineReady: boolean;
    /**
     * Locally settled columns for one match in the tenant's main arena —
     * Base58 player id → columns. Null when there is no local settlement
     * (no pending events, unsupported arena, engine unavailable).
     */
    getMatchSettlement(matchId: string, tenantId: string | null): Record<string, LocalSettlement> | null;
    /**
     * The arena's locally recomputed standings (players tab + medals),
     * merged over the mirrored server snapshot rows. Null renders the
     * snapshot verbatim. `resolveName` names rows the server does not know
     * yet (brand-new offline players).
     */
    getArenaOverlay(
        arenaId: string,
        resolveName: (playerId: string) => string | null,
    ): ArenaPlayer[] | null;
};

const LocalRatingsContext = createContext<LocalRatingsState | undefined>(undefined);

const emptyReplica: RatingsReplicaSnapshot = {
    settlements: new Map(),
    matches: [],
    arenaDocs: new Map(),
    arenaPlayers: new Map(),
    settings: [],
    ready: false,
};

/** The Arena wire document fields the engine needs, read defensively. */
function arenaFromDoc(doc: Record<string, unknown>): EngineArena | null {
    const id = doc["id"];
    if (typeof id !== "string") return null;
    const settings = doc["settings"];
    const version = doc["settings_schema_version"];
    if (typeof settings !== "object" || settings === null || typeof version !== "number") return null;
    const rawFilter = doc["filter"];
    const filter =
        rawFilter && typeof rawFilter === "object"
            ? (rawFilter as {
                  date_from?: string | null;
                  date_to?: string | null;
                  game_ids?: string[] | null;
                  tag_ids?: string[] | null;
              })
            : null;
    return {
        id,
        tenantId: typeof doc["tenant_id"] === "string" ? (doc["tenant_id"] as string) : null,
        membershipMode: null,
        settings,
        settingsVersion: version,
        filter,
        camp: doc["camp"] === true,
        tournamentId: typeof doc["tournament_id"] === "string" ? (doc["tournament_id"] as string) : null,
    };
}

/**
 * The document-mirror read for the replay candidates: like the engine itself,
 * degrades to null on anything unexpected — the mirror stores whatever the
 * server once returned, and a schema drift must cost the provisional values,
 * not the render.
 */
function arenaFromDocSafe(doc: Record<string, unknown>): EngineArena | null {
    try {
        return arenaFromDoc(doc);
    } catch (err) {
        console.error("arena doc mirror unreadable; degrading", err);
        return null;
    }
}

export const LocalRatingsProvider = ({ children }: { children: ReactNode }) => {
    const { pendingMatches, ops } = useOffline();
    const { tenants } = useTenants();
    const [replica, setReplica] = useState<RatingsReplicaSnapshot>(emptyReplica);
    const [bridge, setBridge] = useState<WasmBridge | null>(null);
    const [engineReady, setEngineReady] = useState(false);
    const [gameTags, setGameTags] = useState<Map<string, string[]>>(new Map());
    const [stintRows, setStintRows] = useState<ClubStintsRow[]>([]);

    useEffect(() => {
        let stopped = false;
        void readRatingsReplica().then((snapshot) => {
            if (!stopped) setReplica(snapshot);
        });
        const unsubscribe = subscribeRatingsReplica((snapshot) => {
            if (!stopped) setReplica(snapshot);
        });
        return () => {
            stopped = true;
            unsubscribe();
        };
    }, []);

    useEffect(() => {
        let stopped = false;
        void loadSettlementWasm().then((loaded) => {
            if (stopped) return;
            setBridge(loaded);
            setEngineReady(loaded !== null);
        });
        return () => {
            stopped = true;
        };
    }, []);

    // The replay's tag mapping comes from the games mirror (ADR-39).
    useEffect(() => subscribeGameTags((tags) => setGameTags(tags)), []);

    // The stint mirror backs the stint-based openness modes (ADR-39).
    useEffect(() => subscribeClubStints((rows) => setStintRows(rows)), []);

    // The cold-replica fix for the "no elo settings history" degrade (ADR-39):
    // a replica without a settings series mirrors it right away when online —
    // the replay must not wait for the next post-sync hydration.
    useEffect(() => {
        if (!replica.ready || replica.settings.length > 0) return;
        if (typeof navigator !== "undefined" && navigator.onLine === false) return;
        void ensureSettingsHistory().catch(() => {
            // Offline or a failed fetch — the replay degrades quietly and the
            // next hydration retries.
        });
    }, [replica.ready, replica.settings.length]);

    const resultsByArena = useMemo(() => {
        const map = new Map<string, EngineResult>();
        if (!bridge) return map;
        const matchOps = ops.filter((o) => o.kind === "match" && o.op === "update");
        if (pendingMatches.length === 0 && matchOps.length === 0) return map;

        // Candidate arenas: the tenants' main arenas (their settings doc must
        // have been mirrored — the hydration fetches it) plus every arena the
        // user has viewed. Each candidate degrades independently: a malformed
        // mirrored document or a failed replay must cost one arena's
        // provisional values, never the whole render.
        const candidates = new Map<string, EngineArena>();
        for (const t of tenants) {
            const doc = replica.arenaDocs.get(t.main_arena_id);
            const arena = doc ? arenaFromDocSafe(doc) : null;
            if (arena) candidates.set(t.main_arena_id, { ...arena, membershipMode: t.arena_membership_mode });
        }
        for (const [arenaId, doc] of replica.arenaDocs) {
            if (!candidates.has(arenaId)) {
                const arena = arenaFromDocSafe(doc);
                if (arena) candidates.set(arenaId, arena);
            }
        }

        // The stint probe of the current tenants' clubs: membership at the
        // match date against any stint of any club — the SQL predicate's
        // probes (joined_at <= date, open or left_at > date; null joined_at
        // is the -infinity backfill). Only mirrored clubs are consulted; a
        // tenant whose clubs lack the mirror degrades via null.
        const stintContexts = new Map<string, TenantMembershipContext>();
        for (const t of tenants) {
            if (!t.club_ids?.length) continue;
            const byClub = new Map(stintRows.map((r) => [r.clubId, r.stints]));
            const rows = t.club_ids.map((cid) => byClub.get(cid));
            // Any club without a mirror row means an incomplete membership
            // picture — a wrong exclusion would be worse than a degrade.
            if (rows.some((r) => r === undefined)) continue;
            const stints = rows.filter((r): r is NonNullable<(typeof rows)[number]> => r !== undefined).flat();
            stintContexts.set(t.id, {
                clubIds: t.club_ids,
                isMemberAt: (playerId, date) => {
                    const at = Date.parse(date);
                    for (const s of stints) {
                        if (s.player_id !== playerId) continue;
                        const joined = s.joined_at ? Date.parse(s.joined_at) : Number.NEGATIVE_INFINITY;
                        const left = s.left_at ? Date.parse(s.left_at) : Number.POSITIVE_INFINITY;
                        if (joined <= at && at < left) return true;
                    }
                    return false;
                },
            });
        }

        for (const [arenaId, arena] of candidates) {
            const result = runEngine({
                arena,
                matches: replica.matches,
                pendingMatches,
                matchOps,
                marketRows: replica.settlements.get(arenaId) ?? [],
                settings: replica.settings,
                gameTags: (gameId) => gameTags.get(gameId) ?? null,
                tenantContext: arena.tenantId ? stintContexts.get(arena.tenantId) ?? null : null,
                now: new Date(),
                bridge,
            });
            if (result) map.set(arenaId, result);
        }
        return map;
    }, [bridge, replica, pendingMatches, ops, tenants, gameTags, stintRows]);

    const value = useMemo<LocalRatingsState>(() => {
        const getMatchSettlement = (
            matchId: string,
            tenantId: string | null,
        ): Record<string, LocalSettlement> | null => {
            if (!tenantId) return null;
            const tenant = tenants.find((t) => t.id === tenantId);
            if (!tenant) return null;
            return resultsByArena.get(tenant.main_arena_id)?.settlementsByMatch.get(matchId) ?? null;
        };

        const getArenaOverlay = (
            arenaId: string,
            resolveName: (playerId: string) => string | null,
        ): ArenaPlayer[] | null => {
            const result = resultsByArena.get(arenaId);
            const now = result?.standingsNow;
            if (!result || !now || now.length === 0) return null;
            const serverRows = new Map<string, ArenaPlayer>();
            for (const row of replica.arenaPlayers.get(arenaId) ?? []) {
                const typed = row as unknown as ArenaPlayer;
                serverRows.set(typed.player_id, typed);
            }
            const dayByPlayer = new Map<string, WasmArenaStanding>(
                (result.standingsDay ?? []).map((s) => [s.player_id, s]),
            );
            const weekByPlayer = new Map<string, WasmArenaStanding>(
                (result.standingsWeek ?? []).map((s) => [s.player_id, s]),
            );
            const point = (s: WasmArenaStanding | undefined) =>
                s ? { rating: s.rating, league: s.league ?? null, rank: s.rank ?? null } : { rating: 0, league: null, rank: null };

            return now.map((standing) => {
                const server = serverRows.get(standing.player_id);
                const merged: ArenaPlayer = {
                    player_id: standing.player_id as ArenaPlayer["player_id"],
                    name: server?.name ?? resolveName(standing.player_id) ?? "",
                    rating: standing.rating,
                    league: standing.league ?? null,
                    rank: standing.rank ?? null,
                    matches_count: standing.matches_count,
                    first_count: standing.first_count,
                    second_count: standing.second_count,
                    third_count: standing.third_count,
                    fourth_count: standing.fourth_count,
                    matches_left_for_elite: standing.matches_left_for_elite,
                    wins_needed_for_amateur: standing.wins_needed_for_amateur_lower,
                    wins_needed_for_amateur_upper: standing.wins_needed_for_amateur_upper,
                    rank_history: server?.rank_history
                        ? {
                              day_ago: point(dayByPlayer.get(standing.player_id)),
                              week_ago: point(weekByPlayer.get(standing.player_id)),
                          }
                        : null,
                };
                return merged;
            });
        };

        return { engineReady, getMatchSettlement, getArenaOverlay };
    }, [engineReady, resultsByArena, replica.arenaPlayers, tenants]);

    return <LocalRatingsContext.Provider value={value}>{children}</LocalRatingsContext.Provider>;
};

export const useLocalRatings = (): LocalRatingsState => {
    const ctx = useContext(LocalRatingsContext);
    // Graceful default instead of a throw: the local settlement fill is an
    // optional additive layer — a tree without the provider (isolated test
    // mounts) renders the pre-ADR-38 shape, never crashes.
    return (
        ctx ?? {
            engineReady: false,
            getMatchSettlement: () => null,
            getArenaOverlay: () => null,
        }
    );
};

// Re-exported for consumers typing the row shape (components never touch the
// raw generated record type).
export type ArenaPlayerWire = components["schemas"]["ArenaPlayer"];
