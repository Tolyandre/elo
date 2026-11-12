"use client";
import type { Base58ID } from "@/lib/id";

import {
    ReactNode,
    createContext,
    useCallback,
    useMemo,
    useContext,
    useEffect,
    useRef,
    useState,
} from "react";
import { usePathname } from "next/navigation";
import { ApiError, client, getGamesPromise, getPlayersPromise, pingApiPromise, unwrap } from "../api";
import { useGames } from "../gamesContext";
import { useMatches } from "../matches/MatchesContext";
import { useMe } from "../meContext";
import { usePlayers } from "../players/PlayersContext";
import { useClubs } from "../clubsContext";
import { hasNewArrivals, OpsApi, SyncApi, SyncCallResult, syncOffline } from "@/lib/offline/sync";
import type { MatchMode } from "@/lib/game-modes";
import {
    OfflineStore,
    PendingConflictField,
    PendingGame,
    PendingMatch,
    PendingOp,
    PendingPlayer,
    SyncStatus,
    emptyOfflineStore,
    newOfflineId,
} from "@/lib/offline/types";
import { applyResolutions, parseValue } from "@/lib/offline/merge";
import { hasPendingWrites, readStore, subscribeStore, writeEntities, writeStore } from "@/lib/offline/db";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useTenantScope } from "../tenantScopeContext";
import { useTenants } from "../tenantsContext";
import { hydrateRatingsReplica } from "@/lib/offline/ratings/hydrate";
import { parseSwMessage } from "@/lib/sw-messages";
import { emitDataChange } from "@/lib/live-data";

export type SubmitMatchResult = { id: string };

// The current tenant, mirrored at module scope so the module-level syncApi
// can fall back to it for legacy pending matches that predate the captured
// tenantId (ADR-36 phase 7). The OfflineProvider keeps it fresh.
const tenantFallbackRef: { current: Base58ID | null } = { current: null };

type  OfflineState = {
    pendingMatches: PendingMatch[];
    pendingPlayers: PendingPlayer[];
    pendingGames: PendingGame[];
    /** Edits/deletes of saved entities queued while offline (ADR-37 phase 7). */
    ops: PendingOp[];
    pendingCount: number;
    errorCount: number;
    /** Items waiting for a field-level merge decision on the /offline page (ADR-37). */
    conflictCount: number;
    /** True once the store has been hydrated from localStorage after mount. */
    ready: boolean;
    /**
     * Effective offline state — the single source of truth for "queue locally
     * instead of calling the server". True when there is no network OR the server
     * is known to be unreachable (network up but /ping failing). The cloud-off
     * indicator is shown exactly when this is true, so the icon and offline
     * behaviour always coincide.
     */
    offline: boolean;
    /** Raw navigator.onLine. Prefer `offline`; use this only to tell apart the cause. */
    isOnline: boolean;
    /**
     * API server reachability (independent of network): null until first probe,
     * false when the network is up but /ping fails (server is off). Prefer
     * `offline`; use this only to tell apart "no network" from "server down".
     */
    apiReachable: boolean | null;
    /**
     * True while the last observed API read was served from the service
     * worker's cache (network slow or down) rather than over the wire — the
     * read freshness signal the /ping probe cannot provide between probes.
     * Set by the worker's `api-served-from-cache` message, cleared by the next
     * successful network read (`api-network-ok`). Read-only signal: unlike
     * `offline`, it does not switch writes to the local queue.
     */
    dataFromCache: boolean;
    isSyncing: boolean;
    /** JWT expired while syncing — the user must log in again. */
    authRequired: boolean;
    addPendingMatch: (m: { gameId: Base58ID; score: Record<string, number>; campArenaIds?: Base58ID[]; skipTournamentLink?: boolean; clientId?: Base58ID }) => PendingMatch;
    updatePendingMatch: (clientId: Base58ID, patch: { gameId: Base58ID; score: Record<string, number>; createdAt?: string; campArenaIds?: Base58ID[]; skipTournamentLink?: boolean; calculatorKind?: string | null; calculatorData?: Record<string, unknown> | null }) => void;
    deletePendingMatch: (clientId: Base58ID) => void;
    addPendingPlayer: (name: string, clubIds?: Base58ID[]) => PendingPlayer;
    updatePendingPlayer: (clientId: Base58ID, name: string) => void;
    deletePendingPlayer: (clientId: Base58ID) => void;
    addPendingGame: (name: string, tagIds?: Base58ID[], meta?: PendingGame["meta"]) => PendingGame;
    updatePendingGame: (clientId: Base58ID, name: string) => void;
    deletePendingGame: (clientId: Base58ID) => void;
    /**
     * Match submission: always queues a pending match, never posts directly.
     * The pending entry's clientId is the match's final server id, so replays
     * (flaky network, sync retries) can't duplicate it — the server upserts on
     * id. Queueing re-triggers the probe effect, so while online the sync
     * pushes it within a round trip; offline it waits for connectivity.
     */
    submitMatch: (payload: {
        game_id: Base58ID;
        score: Record<string, number>;
        camp_arena_ids?: Base58ID[];
        skip_tournament_link?: boolean;
        calculator_kind?: string | null;
        calculator_data?: Record<string, never> | null;
    }) => Promise<SubmitMatchResult>;
    syncNow: () => void;
    /**
     * Applies the user's per-field choices for a conflicted item (ADR-37).
     * `resolutions` maps a `PendingConflictField.field` key to the chosen raw
     * value (either `ours` or `theirs` of that field). Each resolved field
     * disappears from the item's conflict list; when the last one is gone the
     * item returns to "pending" and the next sync retries it with the merged
     * content. Match score fields ("score:<playerId>") merge per key into the
     * existing score map — unresolved players keep their queued scores.
     */
    resolvePendingConflict: (
        kind: "match" | "player" | "game",
        clientId: Base58ID,
        resolutions: Record<string, string>,
    ) => void;
    /**
     * Queues an edit of a SAVED player/game/match (ADR-37 phase 7). The op
     * carries the base the form observed and the patch the user made; the
     * sync three-way-merges against the server before sending. One op per
     * entity — queueing again replaces the earlier one.
     */
    queuePlayerUpdate: (entityId: Base58ID, base: { name: string }, patch: { name: string }) => void;
    queuePlayerDelete: (entityId: Base58ID, base: { name: string }) => void;
    queueGameUpdate: (entityId: Base58ID, base: Record<string, unknown>, patch: Record<string, unknown>) => void;
    queueGameDelete: (entityId: Base58ID, base: { name: string }) => void;
    queueMatchUpdate: (
        entityId: Base58ID,
        tenant: Base58ID | null,
        base: Record<string, unknown>,
        patch: Record<string, unknown>,
    ) => void;
    /** Drops a queued op (the user gives up on an errored/conflicted edit or delete). */
    deleteOp: (entityId: Base58ID) => void;
    /**
     * Applies the user's per-field choices for a conflicted op: the chosen
     * value becomes the patch and the server's last-known value the base, so
     * the next sync merges cleanly. Match score fields
     * ("score:<playerId>") merge per key into the patch's score map.
     */
    resolveOpConflict: (entityId: Base58ID, resolutions: Record<string, string>) => void;
};

const OfflineContext = createContext<OfflineState | undefined>(undefined);

/**
 * Read the persisted offline queue (ADR-37: IndexedDB via Dexie, with the
 * one-time ADR-16 localStorage migration inside). Exported so non-React code
 * can observe queue state (e.g. the table-session's sync wait) — now async,
 * as IndexedDB reads are.
 */
export const loadOfflineStore = readStore;

// ─── Op replay API (ADR-37 phase 7) ──────────────────────────────────────────

// The plain number the merge compares — the API's score row is a settlement
// record whose `.score` carries the player's points.
function plainScore(match: { score: Record<string, { score: number | null }> }): Record<string, number> {
    return Object.fromEntries(
        Object.entries(match.score).map(([key, value]) => [key, value.score ?? 0]),
    );
}

// fresh GETs give the merge its "theirs"; writes apply the merged result.
// Errors follow the sync contract: { ok: false } for HTTP errors, throw for
// network failure.
const opsApi: OpsApi = {
    // There is no GET single player — the global catalog stands in; a missing
    // id resolves null (the engine drops the op as "already gone"). Reads
    // unwrap the { status, data } envelope.
    async getPlayer(id) {
        // The generated error type for this read is `never` (no `content` on
        // the error responses), so go through unwrap/ApiError like the api
        // helpers do.
        try {
            const body = await unwrap(client.GET("/players", { params: { query: {} } }));
            const found = body.data.find((p) => p.id === id);
            return { ok: true, data: found ? { name: found.name } : null };
        } catch (err) {
            if (err instanceof ApiError) return { ok: false, status: err.status, message: err.message };
            throw err;
        }
    },
    async patchPlayer(id, body) {
        const { error, response } = await client.PATCH("/players/{id}", { params: { path: { id } }, body });
        if (error) return { ok: false, status: response.status, message: error.message ?? `Ошибка ${response.status}` };
        return { ok: true, data: null };
    },
    async deletePlayer(id) {
        const { error, response } = await client.DELETE("/players/{id}", { params: { path: { id } } });
        if (error) return { ok: false, status: response.status, message: error.message ?? `Ошибка ${response.status}` };
        return { ok: true, data: null };
    },
    async getGame(id) {
        try {
            const body = await unwrap(client.GET("/games", {}));
            const found = body.data.games.find((g) => g.id === id);
            // Full metadata, not just the display name: the merge three-ways
            // every field a game op can change — a name-only record would show
            // `undefined` on the server side of each patch key and flag a
            // phantom conflict (theirs normalized like the dialog's base).
            return {
                ok: true,
                data: found
                    ? {
                          name: found.name,
                          alias: found.alias ?? null,
                          name_en: found.name_en ?? null,
                          name_ru: found.name_ru ?? null,
                          bgg_ref: found.bgg_ref ?? null,
                          tesera_ref: found.tesera_ref ?? null,
                          game_mode: found.game_mode,
                      }
                    : null,
            };
        } catch (err) {
            if (err instanceof ApiError) return { ok: false, status: err.status, message: err.message };
            throw err;
        }
    },
    async patchGame(id, body) {
        const { error, response } = await client.PATCH("/games/{id}", { params: { path: { id } }, body });
        if (error) return { ok: false, status: response.status, message: error.message ?? `Ошибка ${response.status}` };
        return { ok: true, data: null };
    },
    async deleteGame(id) {
        const { error, response } = await client.DELETE("/games/{id}", { params: { path: { id } } });
        if (error) return { ok: false, status: response.status, message: error.message ?? `Ошибка ${response.status}` };
        return { ok: true, data: null };
    },
    async getMatch(id) {
        // Reads are tenant-scoped (ADR-36) — the tenant in force now scopes
        // the settlement columns, which the merge does not use anyway.
        const { data, error, response } = await client.GET("/matches/{id}", {
            params: { path: { id }, query: { tenant: tenantFallbackRef.current ?? "" } },
        });
        if (error) return { ok: false, status: response.status, message: error.message ?? `Ошибка ${response.status}` };
        const match = data.data;
        const score = plainScore(match);
        return {
            ok: true,
            data: {
                game_id: match.game_id,
                date: match.date,
                score,
                camp_arena_ids: (match.camps ?? []).map((c) => c.id),
                ...(match.mode ? { mode: match.mode } : {}),
                // Coop participants are the zero-scored score keys server-side.
                ...(match.mode === "coop" ? { player_ids: Object.keys(score) as Base58ID[] } : {}),
                ...(match.game_score != null ? { game_score: match.game_score } : {}),
                ...(match.game_won != null ? { game_won: match.game_won } : {}),
                // Calculator state merges as one whole field: without it a
                // calculator edit op would see `undefined` on the server side
                // and flag a phantom conflict.
                ...(match.calculator_kind ? { calculator_kind: match.calculator_kind } : {}),
                ...(match.calculator_data ? { calculator_data: match.calculator_data as Record<string, unknown> } : {}),
            },
        };
    },
    async putMatch(id, tenant, body) {
        // The update is tenant-scoped (ADR-36); the op carries the tenant the
        // match belonged to when the edit was queued.
        if (!tenant) {
            return { ok: false, status: 400, message: "Не указано сообщество — сохраните партию заново" };
        }
        const { error, response } = await client.PUT("/matches/{id}", {
            params: { path: { id }, query: { tenant } },
            body: {
                ...body,
                // The generated body types calculator_data as a propertyless
                // object; the op carries the full document — narrowed here at
                // the boundary (the server validates it per calculator kind).
                calculator_data: (body.calculator_data ?? null) as Record<string, never> | null,
            },
        });
        if (error) return { ok: false, status: response.status, message: error.message ?? `Ошибка ${response.status}` };
        return { ok: true, data: null };
    },
};

// Returns a conflicted item with its resolved conflict fields removed
// (ADR-37): once the last field is resolved the item returns to "pending"
// and the next sync retries it with the merged content.
function withResolutions<
    T extends { status: SyncStatus; error?: string; conflict?: PendingConflictField[] },
>(item: T, resolutions: Record<string, string>): T {
    const remaining = (item.conflict ?? []).filter((f) => !(f.field in resolutions));
    return {
        ...item,
        status: remaining.length > 0 ? "conflict" : "pending",
        error: undefined,
        conflict: remaining.length > 0 ? remaining : undefined,
    };
}

// openapi-fetch returns { error } for HTTP errors and throws (TypeError) on network failure —
// exactly the contract syncOffline expects.
// A create-409 body may name the entity to adopt (ADR-37); openapi-fetch
// types the error union with ApiError | DuplicateNameError, so the field is
// narrowed with `in` before use.
function errorResult(error: { message?: string; existing_id?: Base58ID }, status: number): {
    ok: false;
    status: number;
    message: string;
    existingId?: Base58ID;
} {
    return {
        ok: false,
        status,
        message: error.message ?? `Ошибка ${status}`,
        // `in` narrows DuplicateNameError (the holder's id) from ApiError.
        ...("existing_id" in error && error.existing_id ? { existingId: error.existing_id } : {}),
    };
}

const syncApi: SyncApi = {
    async createGame(body): Promise<SyncCallResult<{ id: Base58ID }>> {
        const { data, error, response } = await client.POST("/games", { body });
        if (error) return errorResult(error, response.status);
        return { ok: true, data: { id: data.data.id } };
    },
    async addGameTag({ game_id, tag_id }): Promise<SyncCallResult<null>> {
        const { error, response } = await client.POST("/games/{id}/tags", {
            params: { path: { id: game_id } },
            body: { tag_id },
        });
        if (error) return { ok: false, status: response.status, message: error.message ?? `Ошибка ${response.status}` };
        return { ok: true, data: null };
    },
    async createPlayer(body): Promise<SyncCallResult<{ id: Base58ID }>> {
        const { data, error, response } = await client.POST("/players", { body });
        if (error) return errorResult(error, response.status);
        return { ok: true, data: { id: data.data.id } };
    },
    async addClubMember({ club_id, player_id }): Promise<SyncCallResult<null>> {
        const { error, response } = await client.POST("/clubs/{id}/members", {
            params: { path: { id: club_id } },
            body: { player_id },
        });
        if (error) return { ok: false, status: response.status, message: error.message ?? `Ошибка ${response.status}` };
        return { ok: true, data: null };
    },
    async addMatch(body): Promise<SyncCallResult<{ id: Base58ID }>> {
        // Creation is tenant-scoped (ADR-36 phase 7): the create is path-scoped
        // to the owning tenant captured at submit time. A legacy item without
        // one falls back to the tenant in force right now; with neither there
        // is nothing to address the create to — the item is marked error
        // (user-editable) instead of firing a doomed request.
        const tenant = body.tenant ?? tenantFallbackRef.current;
        if (!tenant) {
            return { ok: false, status: 400, message: "Не указано сообщество — запишите партию заново" };
        }
        // The generated create body type narrows calculator_data to
        // Record<string, never> (an openapi-fetch artifact); the sync engine
        // carries the opaque calculator payload as Record<string, unknown>.
        const { data, error, response } = await client.POST("/tenants/{id}/matches", {
            params: { path: { id: tenant } },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            body: { ...body, tenant: undefined } as any,
        });
        if (error) return { ok: false, status: response.status, message: error.message ?? `Ошибка ${response.status}` };
        return { ok: true, data: { id: data.data.id } };
    },
};

export const OfflineProvider = ({ children }: { children: ReactNode }) => {
    const [store, setStore] = useState<OfflineStore>(emptyOfflineStore);
    const [loaded, setLoaded] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [authRequired, setAuthRequired] = useState(false);
    const [apiReachable, setApiReachable] = useState<boolean | null>(null);
    const [dataFromCache, setDataFromCache] = useState(false);
    const isOnline = useOnlineStatus();
    // The current tenant for the legacy-item fallback (see tenantFallbackRef)
    // and the ratings-replica hydration (ADR-38, via tenantsRef — the sync
    // callback reads the refs to keep its dependencies stable).
    const { tenantId } = useTenantScope();
    const { tenants } = useTenants();
    const tenantsRef = useRef(tenants);
    useEffect(() => {
        tenantsRef.current = tenants;
    }, [tenants]);
    useEffect(() => {
        tenantFallbackRef.current = tenantId;
    }, [tenantId]);
    // Single source of truth for offline behaviour and the cloud-off indicator.
    const offline = !isOnline || apiReachable === false;
    const pathname = usePathname();
    const syncInProgressRef = useRef(false);
    const storeRef = useRef(store);
    useEffect(() => {
        storeRef.current = store;
    }, [store]);

    const ops = useMemo(() => store.ops ?? [], [store.ops]);
    const pendingCount = store.games.length + store.players.length + store.matches.length + ops.length;
    const pendingCountRef = useRef(pendingCount);
    useEffect(() => {
        pendingCountRef.current = pendingCount;
    }, [pendingCount]);

    const { canEdit } = useMe();
    const { invalidate: invalidateMatches } = useMatches();
    const { invalidate: invalidatePlayers } = usePlayers();
    const { invalidate: invalidateGames } = useGames();
    const { invalidate: invalidateClubs } = useClubs();

    // IndexedDB is unavailable during static export rendering — hydrate after
    // mount. The read runs the one-time ADR-16 localStorage migration.
    useEffect(() => {
        let cancelled = false;
        readStore().then((store) => {
            if (cancelled) return;
            setStore(store);
            storeRef.current = store;
            setLoaded(true);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    // Another tab wrote the offline store (creates from any tab queue here now,
    // even while online) — adopt its state so this tab's UI follows. Adoption
    // is safe mid-sync too: engine writes are merged over the live store (see
    // syncOffline), so a run can no longer clobber items queued or deleted in
    // another tab while it was in flight. This tab's own writes are skipped by
    // the snapshot comparison (the DB converges to the mirror); while a write
    // of ours is in flight adoption pauses, so a remote echo can never revert
    // a not-yet-flushed local change.
    useEffect(() => {
        if (!loaded) return;
        const sameStore = (a: OfflineStore, b: OfflineStore) =>
            JSON.stringify(a) === JSON.stringify(b);
        return subscribeStore((snapshot) => {
            if (hasPendingWrites() || sameStore(snapshot, storeRef.current)) return;
            storeRef.current = snapshot;
            setStore(snapshot);
        });
    }, [loaded]);

    // The service worker reports whether API reads were served from the cache
    // (network timed out or failed) or fetched over the wire — the page cannot
    // distinguish the two itself. `offline` above covers writes and is
    // ping-driven; this flag is the read-freshness signal that closes the gap
    // between pings (a slow API silently falling back to cached lists).
    useEffect(() => {
        if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
        const onMessage = (event: MessageEvent) => {
            const msg = parseSwMessage(event.data);
            if (msg?.type === "api-served-from-cache") setDataFromCache(true);
            else if (msg?.type === "api-network-ok") setDataFromCache(false);
        };
        navigator.serviceWorker.addEventListener("message", onMessage);
        return () => navigator.serviceWorker.removeEventListener("message", onMessage);
    }, []);

    const mutateStore = useCallback((fn: (s: OfflineStore) => OfflineStore) => {
        setStore((prev) => {
            const next = fn(prev);
            // Keep the ref in sync synchronously: `storeRef` is otherwise updated
            // by a lagging effect, so a sync triggered right after a mutation (e.g.
            // delete + navigation re-probing /ping) would read a stale snapshot and
            // resurrect the just-removed item.
            storeRef.current = next;
            void writeStore(next);
            return next;
        });
    }, []);

    const syncNow = useCallback(() => {
        if (syncInProgressRef.current) return;
        const initial = storeRef.current;
        if (initial.games.length + initial.players.length + initial.matches.length + (initial.ops?.length ?? 0) === 0) return;
        syncInProgressRef.current = true;
        setIsSyncing(true);
        setAuthRequired(false);

        const run = async () => {
            try {
                for (;;) {
                    const current = storeRef.current;
                    const runIds = new Set(
                        [...current.games, ...current.players, ...current.matches].map((i) => i.clientId),
                    );
                    // The engine re-reads the live store before each write, so
                    // items queued or deleted mid-run (here or in another tab)
                    // survive it.
                    const outcome = await syncOffline(
                        current,
                        syncApi,
                        (s) => {
                            storeRef.current = s;
                            setStore(s);
                            void writeStore(s);
                        },
                        () => storeRef.current,
                        undefined,
                        opsApi,
                    ).catch((err) => {
                        // Per-item failures are handled inside the engine; an
                        // escape here means a persist itself threw (e.g.
                        // storage quota). The store keeps its last persisted
                        // state — log and stop rather than die on an
                        // unhandled rejection.
                        console.error("offline sync failed", err);
                        return undefined;
                    });
                    if (!outcome) break;
                    setAuthRequired(outcome.authRequired);
                    if (outcome.syncedCount > 0) {
                        invalidateMatches();
                        invalidatePlayers();
                        invalidateGames();
                        invalidateClubs();
                        // Mirror the fresh server lists into the entity replica
                        // (ADR-37 phase 6): names resolve from the mirror the
                        // moment the sync lands, without waiting for the
                        // contexts' refetches. A failed pull is harmless — the
                        // providers' write-throughs refresh it on next browse.
                        void Promise.all([getPlayersPromise(), getGamesPromise()])
                            .then(([players, games]) => {
                                void writeEntities("player", players.map((p) => ({ id: p.id, name: p.name })));
                                void writeEntities("game", games.games.map((g) => ({ id: g.id, name: g.name })));
                            })
                            .catch(() => {});
                        // Arena timelines render useArenaMatches, not the contexts
                        // above — tell them the sync landed directly (same signal
                        // the server's SSE echo carries, without depending on the
                        // stream being connected).
                        emitDataChange({ matches: true, players: true, arenas: false });
                        // Ratings replica (ADR-38): refresh the offline replay's
                        // raw material — settings history, the tenant's match
                        // history, the followed arenas' settlement ledgers.
                        // Best-effort; the arena views' write-throughs keep the
                        // arenas the user browses fresh as well.
                        const tenant = tenantsRef.current.find((t) => t.id === tenantFallbackRef.current);
                        if (tenant) void hydrateRatingsReplica(tenant).catch(() => {});
                    }
                    // Items queued while this run was in flight hit the probe's
                    // syncNow, which was a guarded no-op, and nothing re-triggers
                    // the probe after a healthy run — loop once more to drain
                    // them. On abort/401 the probe's backoff (or re-login) drives
                    // the next attempt instead of a tight retry loop.
                    if (outcome.aborted || outcome.authRequired || !hasNewArrivals(storeRef.current, runIds)) break;
                }
            } finally {
                syncInProgressRef.current = false;
                setIsSyncing(false);
            }
        };
        run();
    }, [invalidateGames, invalidateMatches, invalidatePlayers, invalidateClubs]);

    // Sync is driven solely by the API health probe below: a fresh `pingApiPromise`
    // success is the single automatic trigger, so we never start a sync while the
    // server is unreachable (a failed attempt would otherwise abort and overwrite
    // the snapshot, resurrecting items the user deleted/edited mid-sync). The manual
    // "Сохранить на сервере" button still calls `syncNow` directly as an explicit action.

    // API health probe. Pings once per trigger (mount, navigation, focus, online,
    // new pending items) — NOT on an idle timer while everything is healthy. Only
    // once a ping fails does it keep polling with exponential backoff (30s → 15min)
    // to detect recovery; a successful ping after a failure (with queued items)
    // triggers a resync, so the queue drains once the server comes back even
    // without a network drop.
    useEffect(() => {
        if (!loaded) return;

        const MIN_DELAY = 30_000;
        const MAX_DELAY = 15 * 60_000;
        let delay = MIN_DELAY;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let cancelled = false;

        const run = async () => {
            if (cancelled || !navigator.onLine) return; // offline: the `online` event re-triggers
            const ok = await pingApiPromise();
            if (cancelled) return;
            setApiReachable(ok);
            if (ok) {
                // Healthy → stop polling (no idle pings). The confirmed ping is the
                // single automatic sync trigger: drain any queued work now (covers
                // both API recovery and items just added while the API was up).
                delay = MIN_DELAY;
                if (pendingCountRef.current > 0 && canEdit) {
                    syncNow();
                }
            } else {
                // Unreachable → keep probing for recovery with growing backoff.
                delay = Math.min(delay * 1.1, MAX_DELAY);
                timer = setTimeout(run, delay);
            }
        };

        const reset = () => {
            delay = MIN_DELAY;
            if (timer) clearTimeout(timer);
            run();
        };

        run();
        window.addEventListener("focus", reset);
        window.addEventListener("online", reset);
        document.addEventListener("visibilitychange", reset);
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
            window.removeEventListener("focus", reset);
            window.removeEventListener("online", reset);
            document.removeEventListener("visibilitychange", reset);
        };
        // Re-probe immediately on navigation and when new items are queued.
    }, [loaded, pathname, pendingCount, canEdit, syncNow]);

    const addPendingMatch = useCallback(
        ({ tenantId, gameId, score, campArenaIds, skipTournamentLink, clientId, calculatorKind, calculatorData, mode, playerIds, gameScore, gameWon }: { tenantId?: Base58ID; gameId: Base58ID; score: Record<string, number>; campArenaIds?: Base58ID[]; skipTournamentLink?: boolean; clientId?: Base58ID; calculatorKind?: string | null; calculatorData?: Record<string, unknown> | null; mode?: MatchMode; playerIds?: Base58ID[]; gameScore?: number; gameWon?: boolean }) => {
            const match: PendingMatch = {
                clientId: clientId ?? newOfflineId(),
                createdAt: new Date().toISOString(),
                status: "pending",
                // The community the match was recorded under (ADR-36 phase
                // 7); the sync create is path-scoped to it.
                tenantId,
                gameId,
                score,
                campArenaIds: campArenaIds ?? [],
                skipTournamentLink,
                calculatorKind: calculatorKind ?? null,
                calculatorData: calculatorData ?? null,
                mode,
                playerIds,
                gameScore,
                gameWon,
            };
            mutateStore((s) => ({ ...s, matches: [...s.matches, match] }));
            return match;
        },
        [mutateStore],
    );

    const updatePendingMatch = useCallback(
        (clientId: Base58ID, patch: { gameId: Base58ID; score: Record<string, number>; createdAt?: string; campArenaIds?: Base58ID[]; skipTournamentLink?: boolean; calculatorKind?: string | null; calculatorData?: Record<string, unknown> | null; mode?: MatchMode; playerIds?: Base58ID[]; gameScore?: number; gameWon?: boolean }) => {
            mutateStore((s) => ({
                ...s,
                matches: s.matches.map((m) =>
                    m.clientId === clientId
                        ? {
                              ...m,
                              gameId: patch.gameId,
                              score: patch.score,
                              createdAt: patch.createdAt ?? m.createdAt,
                              campArenaIds: patch.campArenaIds ?? m.campArenaIds ?? [],
                              skipTournamentLink: patch.skipTournamentLink !== undefined ? patch.skipTournamentLink : m.skipTournamentLink,
                              calculatorKind: patch.calculatorKind !== undefined ? patch.calculatorKind : m.calculatorKind,
                              calculatorData: patch.calculatorData !== undefined ? patch.calculatorData : m.calculatorData,
                              mode: patch.mode,
                              playerIds: patch.playerIds,
                              gameScore: patch.gameScore,
                              gameWon: patch.gameWon,
                              status: "pending",
                              error: undefined,
                          }
                        : m,
                ),
            }));
        },
        [mutateStore],
    );

    const deletePendingMatch = useCallback(
        (clientId: string) => {
            mutateStore((s) => ({ ...s, matches: s.matches.filter((m) => m.clientId !== clientId) }));
        },
        [mutateStore],
    );

    const addPendingPlayer = useCallback(
        (name: string, clubIds: Base58ID[] = []) => {
            const player: PendingPlayer = {
                clientId: newOfflineId(),
                createdAt: new Date().toISOString(),
                status: "pending",
                name,
                clubIds,
            };
            mutateStore((s) => ({ ...s, players: [...s.players, player] }));
            return player;
        },
        [mutateStore],
    );

    const updatePendingPlayer = useCallback(
        (clientId: string, name: string) => {
            mutateStore((s) => ({
                ...s,
                players: s.players.map((p) =>
                    p.clientId === clientId ? { ...p, name, status: "pending", error: undefined } : p,
                ),
            }));
        },
        [mutateStore],
    );

    const deletePendingPlayer = useCallback(
        (clientId: string) => {
            // Cascade (ADR-37): queued matches referencing this player can
            // never sync once the player is gone — remove them with it.
            mutateStore((s) => ({
                ...s,
                players: s.players.filter((p) => p.clientId !== clientId),
                matches: s.matches.filter((m) => !(clientId in m.score || m.playerIds?.includes(clientId as Base58ID))),
            }));
        },
        [mutateStore],
    );

    const addPendingGame = useCallback(
        (name: string, tagIds: Base58ID[] = [], meta?: PendingGame["meta"]) => {
            const game: PendingGame = {
                clientId: newOfflineId(),
                createdAt: new Date().toISOString(),
                status: "pending",
                name,
                tagIds,
                meta,
            };
            mutateStore((s) => ({ ...s, games: [...s.games, game] }));
            return game;
        },
        [mutateStore],
    );

    const updatePendingGame = useCallback(
        (clientId: string, name: string) => {
            mutateStore((s) => ({
                ...s,
                games: s.games.map((g) =>
                    g.clientId === clientId ? { ...g, name, status: "pending", error: undefined } : g,
                ),
            }));
        },
        [mutateStore],
    );

    const deletePendingGame = useCallback(
        (clientId: string) => {
            // Cascade: queued matches referencing this game can never sync.
            mutateStore((s) => ({
                ...s,
                games: s.games.filter((g) => g.clientId !== clientId),
                matches: s.matches.filter((m) => m.gameId !== clientId),
            }));
        },
        [mutateStore],
    );

    // ── Ops: offline edits/deletes of saved entities (ADR-37 phase 7) ──

    // One op per entity — a later queue replaces the earlier one (last write
    // wins within a device; cross-device races merge at sync time).
    const queueOp = useCallback(
        (op: PendingOp) => {
            mutateStore((s) => ({
                ...s,
                ops: [...(s.ops ?? []).filter((o) => o.entityId !== op.entityId), op].sort((a, b) =>
                    a.createdAt.localeCompare(b.createdAt),
                ),
            }));
        },
        [mutateStore],
    );

    const queuePlayerUpdate = useCallback(
        (entityId: Base58ID, base: { name: string }, patch: { name: string }) => {
            queueOp({
                entityId, kind: "player", op: "update",
                createdAt: new Date().toISOString(), status: "pending",
                base: { ...base }, patch: { ...patch },
            });
        },
        [queueOp],
    );

    const queuePlayerDelete = useCallback(
        (entityId: Base58ID, base: { name: string }) => {
            queueOp({
                entityId, kind: "player", op: "delete",
                createdAt: new Date().toISOString(), status: "pending",
                base: { ...base },
            });
        },
        [queueOp],
    );

    const queueGameUpdate = useCallback(
        // Game ops carry the full metadata the edit dialog edits (the display
        // name derives server-side from alias → ru → en, ADR-37 phase 7).
        (entityId: Base58ID, base: Record<string, unknown>, patch: Record<string, unknown>) => {
            queueOp({
                entityId, kind: "game", op: "update",
                createdAt: new Date().toISOString(), status: "pending",
                base: { ...base }, patch: { ...patch },
            });
        },
        [queueOp],
    );

    const queueGameDelete = useCallback(
        (entityId: Base58ID, base: { name: string }) => {
            queueOp({
                entityId, kind: "game", op: "delete",
                createdAt: new Date().toISOString(), status: "pending",
                base: { ...base },
            });
        },
        [queueOp],
    );

    const queueMatchUpdate = useCallback(
        (entityId: Base58ID, tenant: Base58ID | null, base: Record<string, unknown>, patch: Record<string, unknown>) => {
            queueOp({
                entityId, kind: "match", op: "update",
                createdAt: new Date().toISOString(), status: "pending",
                tenant: tenant ?? undefined,
                base: { ...base }, patch: { ...patch },
            });
        },
        [queueOp],
    );

    const deleteOp = useCallback(
        (entityId: Base58ID) => {
            mutateStore((s) => ({ ...s, ops: (s.ops ?? []).filter((o) => o.entityId !== entityId) }));
        },
        [mutateStore],
    );

    // Field-level resolution for a conflicted op (ADR-37): the chosen value
    // becomes the patch and the server's last-known value the base, so the
    // next sync merges cleanly. Match ops map "score:<playerId>" keys into
    // the score map and "date" into the date field; a conflicted delete is
    // resolved by adopting the server's current values as the base (the
    // queue page's «удалить всё равно»).
    const resolveOpConflict = useCallback(
        (entityId: Base58ID, resolutions: Record<string, string>) => {
            mutateStore((s) => ({
                ...s,
                ops: (s.ops ?? []).map((o) => {
                    if (o.entityId !== entityId || o.status !== "conflict") return o;
                    if (o.op === "delete") {
                        // Proceed-with-delete: adopt the server's values as the
                        // base so the stale-guard passes on the next run.
                        const nextBase = { ...(o.base ?? {}) };
                        for (const f of o.conflict ?? []) nextBase[f.field] = parseValue(f.theirs);
                        const remaining = (o.conflict ?? []).filter((f) => !(f.field in resolutions));
                        return { ...o, base: nextBase, status: "pending" as const, error: undefined, conflict: remaining.length > 0 ? remaining : undefined };
                    }
                    if (o.kind === "match") {
                        const base = { ...(o.base ?? {}) };
                        const patch = { ...(o.patch ?? {}) };
                        const scoreBase = { ...((base.score ?? {}) as Record<string, number>) };
                        const scorePatch = { ...((patch.score ?? {}) as Record<string, number>) };
                        let scoreChanged = false;
                        for (const [field, value] of Object.entries(resolutions)) {
                            const parsed = parseValue(value);
                            if (field.startsWith("score:")) {
                                const playerId = field.slice("score:".length);
                                scorePatch[playerId] = parsed as number;
                                scoreBase[playerId] = parsed as number;
                                scoreChanged = true;
                            } else if (field === "date") {
                                patch.date = parsed;
                                base.date = parsed;
                            } else {
                                patch[field] = parsed;
                                // The base gets the server's last-known value.
                                const f = (o.conflict ?? []).find((c) => c.field === field);
                                if (f) base[field] = parseValue(f.theirs);
                            }
                        }
                        if (scoreChanged) {
                            patch.score = scorePatch;
                            base.score = scoreBase;
                        }
                        const remaining = (o.conflict ?? []).filter((f) => !(f.field in resolutions));
                        return { ...o, base, patch, status: remaining.length > 0 ? ("conflict" as const) : ("pending" as const), error: undefined, conflict: remaining.length > 0 ? remaining : undefined };
                    }
                    const { base, patch } = applyResolutions(o.base ?? {}, o.patch ?? {}, o.conflict ?? [], resolutions);
                    const remaining = (o.conflict ?? []).filter((f) => !(f.field in resolutions));
                    return { ...o, base, patch, status: remaining.length > 0 ? ("conflict" as const) : ("pending" as const), error: undefined, conflict: remaining.length > 0 ? remaining : undefined };
                }),
            }));
        },
        [mutateStore],
    );

    // Field-level conflict resolution (ADR-37): the /offline queue page calls
    // this per field the user decided on the queue page. Match score fields
    // merge per key into the existing map, so a half-resolved match keeps the
    // queued scores of its unresolved players.
    const resolvePendingConflict = useCallback(
        (kind: "match" | "player" | "game", clientId: Base58ID, resolutions: Record<string, string>) => {
            mutateStore((s) => {
                if (kind === "player") {
                    return {
                        ...s,
                        players: s.players.map((p) =>
                            p.clientId === clientId && p.status === "conflict"
                                ? withResolutions(
                                      resolutions["name"] !== undefined ? { ...p, name: resolutions["name"] } : p,
                                      resolutions,
                                  )
                                : p,
                        ),
                    };
                }
                if (kind === "game") {
                    return {
                        ...s,
                        games: s.games.map((g) =>
                            g.clientId === clientId && g.status === "conflict"
                                ? withResolutions(
                                      resolutions["name"] !== undefined ? { ...g, name: resolutions["name"] } : g,
                                      resolutions,
                                  )
                                : g,
                        ),
                    };
                }
                return {
                    ...s,
                    matches: s.matches.map((m) => {
                        if (m.clientId !== clientId || m.status !== "conflict") return m;
                        let next = m;
                        for (const [field, value] of Object.entries(resolutions)) {
                            if (field === "date") {
                                next = { ...next, createdAt: value };
                            } else if (field.startsWith("score:")) {
                                const playerId = field.slice("score:".length);
                                const parsed = Number(value);
                                if (Number.isFinite(parsed)) {
                                    next = { ...next, score: { ...next.score, [playerId]: parsed } };
                                }
                            }
                        }
                        return withResolutions(next, resolutions);
                    }),
                };
            });
        },
        [mutateStore],
    );

    const submitMatch = useCallback(
        async (payload: {
            game_id: Base58ID;
            score: Record<string, number>;
            camp_arena_ids?: Base58ID[];
            // The unchecked tournament checkbox (ADR-26); only the explicit
            // opt-out travels — acceptance itself is decided at the sync write.
            skip_tournament_link?: boolean;
            // Coop match fields (ADR-33): the shared result and participant
            // list instead of per-player scores.
            mode?: MatchMode;
            player_ids?: Base58ID[];
            game_score?: number;
            game_won?: boolean;
            // Optional calculator state (e.g. Skull King round breakdown), stored
            // with the pending match so the calculator detail survives until the
            // sync pushes it to the server.
            calculator_kind?: string | null;
            calculator_data?: Record<string, never> | null;
        }): Promise<SubmitMatchResult> => {
            // Every create flows through the queue, even while online: a direct
            // POST would need its own "request landed but response lost" fallback,
            // and any retry of that fallback minted a second id — the source of
            // duplicate matches and of games stuck behind the unique-name index.
            // The sync engine sends games → players → matches, so dependencies on
            // other pending entities need no special-casing here either.
            const match = addPendingMatch({
                // The community the match is recorded under (ADR-36 phase 7);
                // the sync create is path-scoped to it.
                tenantId: tenantId ?? undefined,
                gameId: payload.game_id,
                score: payload.score,
                campArenaIds: payload.camp_arena_ids,
                skipTournamentLink: payload.skip_tournament_link,
                calculatorKind: payload.calculator_kind,
                calculatorData: payload.calculator_data,
                mode: payload.mode,
                playerIds: payload.player_ids,
                gameScore: payload.game_score,
                gameWon: payload.game_won,
            });
            return { id: match.clientId };
        },
        [addPendingMatch, tenantId],
    );

    const errorCount =
        store.games.filter((g) => g.status === "error").length +
        store.players.filter((p) => p.status === "error").length +
        store.matches.filter((m) => m.status === "error").length +
        ops.filter((o) => o.status === "error").length;

    const conflictCount =
        store.games.filter((g) => g.status === "conflict").length +
        store.players.filter((p) => p.status === "conflict").length +
        store.matches.filter((m) => m.status === "conflict").length +
        ops.filter((o) => o.status === "conflict").length;

    return (
        <OfflineContext.Provider
            value={{
                pendingMatches: store.matches,
                pendingPlayers: store.players,
                pendingGames: store.games,
                ops,
                pendingCount,
                errorCount,
                conflictCount,
                ready: loaded,
                offline,
                isOnline,
                apiReachable,
                dataFromCache,
                isSyncing,
                authRequired,
                addPendingMatch,
                updatePendingMatch,
                deletePendingMatch,
                addPendingPlayer,
                updatePendingPlayer,
                deletePendingPlayer,
                addPendingGame,
                updatePendingGame,
                deletePendingGame,
                submitMatch,
                syncNow,
                resolvePendingConflict,
                queuePlayerUpdate,
                queuePlayerDelete,
                queueGameUpdate,
                queueGameDelete,
                queueMatchUpdate,
                deleteOp,
                resolveOpConflict,
            }}
        >
            {children}
        </OfflineContext.Provider>
    );
};

export const useOffline = () => {
    const ctx = useContext(OfflineContext);
    if (!ctx) {
        throw new Error("useOffline must be used within an OfflineProvider");
    }
    return ctx;
};
