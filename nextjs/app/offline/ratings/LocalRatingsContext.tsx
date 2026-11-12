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
import { runEngine, type EngineArena, type EngineResult } from "@/lib/offline/ratings/engine";
import {
    readRatingsReplica,
    subscribeRatingsReplica,
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
    };
}

export const LocalRatingsProvider = ({ children }: { children: ReactNode }) => {
    const { pendingMatches, ops } = useOffline();
    const { tenants } = useTenants();
    const [replica, setReplica] = useState<RatingsReplicaSnapshot>(emptyReplica);
    const [bridge, setBridge] = useState<WasmBridge | null>(null);
    const [engineReady, setEngineReady] = useState(false);

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

    const resultsByArena = useMemo(() => {
        const map = new Map<string, EngineResult>();
        if (!bridge) return map;
        const matchOps = ops.filter((o) => o.kind === "match" && o.op === "update");
        if (pendingMatches.length === 0 && matchOps.length === 0) return map;

        // Candidate arenas: the tenants' main arenas (their settings doc must
        // have been mirrored — hydrateRatingsReplica fetches it) plus every
        // arena the user has viewed.
        const candidates = new Map<string, EngineArena>();
        for (const t of tenants) {
            const doc = replica.arenaDocs.get(t.main_arena_id);
            const arena = doc ? arenaFromDoc(doc) : null;
            if (arena) candidates.set(t.main_arena_id, { ...arena, membershipMode: t.arena_membership_mode });
        }
        for (const [arenaId, doc] of replica.arenaDocs) {
            if (!candidates.has(arenaId)) {
                const arena = arenaFromDoc(doc);
                if (arena) candidates.set(arenaId, arena);
            }
        }

        for (const [arenaId, arena] of candidates) {
            const result = runEngine({
                arena,
                matches: replica.matches,
                pendingMatches,
                matchOps,
                marketRows: replica.settlements.get(arenaId) ?? [],
                settings: replica.settings,
                // The client's games catalog carries no tag ids; tag-filtered
                // arenas degrade to the replica (engine returns null).
                gameTags: () => null,
                now: new Date(),
                bridge,
            });
            if (result) map.set(arenaId, result);
        }
        return map;
    }, [bridge, replica, pendingMatches, ops, tenants]);

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
