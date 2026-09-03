"use client";
import type { Base58ID } from "@/lib/id";

import {
    ReactNode,
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
} from "react";
import { usePathname } from "next/navigation";
import { client, pingApiPromise } from "../api";
import { useGames } from "../gamesContext";
import { useMatches } from "../matches/MatchesContext";
import { useMe } from "../meContext";
import { usePlayers } from "../players/PlayersContext";
import { useClubs } from "../clubsContext";
import { SyncApi, SyncCallResult, syncOffline } from "@/lib/offline/sync";
import {
    OfflineStore,
    PendingGame,
    PendingMatch,
    PendingPlayer,
    emptyOfflineStore,
    newOfflineId,
} from "@/lib/offline/types";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

const STORAGE_KEY = "offline-pending-v1";

export type SubmitMatchResult = { id: string };

type  OfflineState = {
    pendingMatches: PendingMatch[];
    pendingPlayers: PendingPlayer[];
    pendingGames: PendingGame[];
    pendingCount: number;
    errorCount: number;
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
    isSyncing: boolean;
    /** JWT expired while syncing — the user must log in again. */
    authRequired: boolean;
    addPendingMatch: (m: { gameId: Base58ID; score: Record<string, number>; tournamentIds?: Base58ID[]; clientId?: Base58ID }) => PendingMatch;
    updatePendingMatch: (clientId: Base58ID, patch: { gameId: Base58ID; score: Record<string, number>; createdAt?: string; tournamentIds?: Base58ID[]; calculatorKind?: string | null; calculatorData?: Record<string, unknown> | null }) => void;
    deletePendingMatch: (clientId: Base58ID) => void;
    addPendingPlayer: (name: string, clubIds?: Base58ID[]) => PendingPlayer;
    updatePendingPlayer: (clientId: Base58ID, name: string) => void;
    deletePendingPlayer: (clientId: Base58ID) => void;
    addPendingGame: (name: string) => PendingGame;
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
        tournament_ids?: Base58ID[];
        calculator_kind?: string | null;
        calculator_data?: Record<string, never> | null;
    }) => Promise<SubmitMatchResult>;
    syncNow: () => void;
};

const OfflineContext = createContext<OfflineState | undefined>(undefined);

/**
 * Read the persisted offline store. Exported so non-React code can observe
 * queue state (e.g. waiting for a just-queued match to sync).
 */
export function loadOfflineStore(): OfflineStore {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return emptyOfflineStore();
        const parsed = JSON.parse(raw) as Partial<OfflineStore>;
        // Backfill fields added after the initial offline store version, so
        // older localStorage entries don't break the sync engine or UI. Parse
        // loosely (the on-disk shape may predate these fields) then default.
        const rawPlayers = (parsed.players ?? []) as Array<Partial<PendingPlayer>>;
        const players: PendingPlayer[] = rawPlayers.map((p) => ({
            clientId: p.clientId!,
            createdAt: p.createdAt!,
            status: p.status ?? "pending",
            name: p.name!,
            clubIds: p.clubIds ?? [],
        }));
        const rawMatches = (parsed.matches ?? []) as Array<Partial<PendingMatch>>;
        const matches: PendingMatch[] = rawMatches.map((m) => ({
            clientId: m.clientId!,
            createdAt: m.createdAt!,
            status: m.status ?? "pending",
            gameId: m.gameId!,
            score: m.score!,
            tournamentIds: m.tournamentIds ?? [],
            calculatorKind: m.calculatorKind ?? null,
            calculatorData: m.calculatorData ?? null,
        }));
        return { games: parsed.games ?? [], players, matches };
    } catch {
        // corrupted store — start fresh
    }
    return emptyOfflineStore();
}

function persistStore(store: OfflineStore) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

// openapi-fetch returns { error } for HTTP errors and throws (TypeError) on network failure —
// exactly the contract syncOffline expects.
const syncApi: SyncApi = {
    async createGame(body): Promise<SyncCallResult<{ id: Base58ID }>> {
        const { data, error, response } = await client.POST("/games", { body });
        if (error) return { ok: false, status: response.status, message: error.message ?? `Ошибка ${response.status}` };
        return { ok: true, data: { id: data.data.id } };
    },
    async createPlayer(body): Promise<SyncCallResult<{ id: Base58ID }>> {
        const { data, error, response } = await client.POST("/players", { body });
        if (error) return { ok: false, status: response.status, message: error.message ?? `Ошибка ${response.status}` };
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
        // The generated POST /matches body type narrows calculator_data to
        // Record<string, never> (an openapi-fetch artifact); the sync engine
        // carries the opaque calculator payload as Record<string, unknown>.
        const { data, error, response } = await client.POST("/matches", {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            body: body as any,
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
    const isOnline = useOnlineStatus();
    // Single source of truth for offline behaviour and the cloud-off indicator.
    const offline = !isOnline || apiReachable === false;
    const pathname = usePathname();
    const syncInProgressRef = useRef(false);
    const storeRef = useRef(store);
    useEffect(() => {
        storeRef.current = store;
    }, [store]);

    const pendingCount = store.games.length + store.players.length + store.matches.length;
    const pendingCountRef = useRef(pendingCount);
    useEffect(() => {
        pendingCountRef.current = pendingCount;
    }, [pendingCount]);

    const { canEdit } = useMe();
    const { invalidate: invalidateMatches } = useMatches();
    const { invalidate: invalidatePlayers } = usePlayers();
    const { invalidate: invalidateGames } = useGames();
    const { invalidate: invalidateClubs } = useClubs();

    // localStorage is unavailable during static export rendering — hydrate after mount.
    useEffect(() => {
        /* eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe hydration */
        setStore(loadOfflineStore());
        setLoaded(true);
    }, []);

    // Another tab wrote the offline store (creates from any tab queue here now,
    // even while online) — adopt its state so a later write from this tab can't
    // drop those items (the whole store is persisted per write). Skipped while a
    // sync runs: the engine's snapshot would immediately overwrite the fresher
    // state. Two tabs writing near-simultaneously still resolve last-write-wins;
    // accepted for a single-user PWA.
    useEffect(() => {
        if (!loaded) return;
        const onStorage = (e: StorageEvent) => {
            if (e.key !== STORAGE_KEY || syncInProgressRef.current) return;
            const next = loadOfflineStore();
            storeRef.current = next;
            setStore(next);
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
    }, [loaded]);

    const mutateStore = useCallback((fn: (s: OfflineStore) => OfflineStore) => {
        setStore((prev) => {
            const next = fn(prev);
            persistStore(next);
            // Keep the ref in sync synchronously: `storeRef` is otherwise updated
            // by a lagging effect, so a sync triggered right after a mutation (e.g.
            // delete + navigation re-probing /ping) would read a stale snapshot and
            // resurrect the just-removed item.
            storeRef.current = next;
            return next;
        });
    }, []);

    const syncNow = useCallback(() => {
        if (syncInProgressRef.current) return;
        const current = storeRef.current;
        if (current.games.length + current.players.length + current.matches.length === 0) return;
        syncInProgressRef.current = true;
        setIsSyncing(true);
        setAuthRequired(false);

        syncOffline(current, syncApi, (s) => {
            storeRef.current = s;
            setStore(s);
            persistStore(s);
        })
            .then((outcome) => {
                setAuthRequired(outcome.authRequired);
                if (outcome.syncedCount > 0) {
                    invalidateMatches();
                    invalidatePlayers();
                    invalidateGames();
                    invalidateClubs();
                }
            })
            .finally(() => {
                syncInProgressRef.current = false;
                setIsSyncing(false);
            });
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
        ({ gameId, score, tournamentIds, clientId, calculatorKind, calculatorData }: { gameId: Base58ID; score: Record<string, number>; tournamentIds?: Base58ID[]; clientId?: Base58ID; calculatorKind?: string | null; calculatorData?: Record<string, unknown> | null }) => {
            const match: PendingMatch = {
                clientId: clientId ?? newOfflineId(),
                createdAt: new Date().toISOString(),
                status: "pending",
                gameId,
                score,
                tournamentIds: tournamentIds ?? [],
                calculatorKind: calculatorKind ?? null,
                calculatorData: calculatorData ?? null,
            };
            mutateStore((s) => ({ ...s, matches: [...s.matches, match] }));
            return match;
        },
        [mutateStore],
    );

    const updatePendingMatch = useCallback(
        (clientId: Base58ID, patch: { gameId: Base58ID; score: Record<string, number>; createdAt?: string; tournamentIds?: Base58ID[]; calculatorKind?: string | null; calculatorData?: Record<string, unknown> | null }) => {
            mutateStore((s) => ({
                ...s,
                matches: s.matches.map((m) =>
                    m.clientId === clientId
                        ? {
                              ...m,
                              gameId: patch.gameId,
                              score: patch.score,
                              createdAt: patch.createdAt ?? m.createdAt,
                              tournamentIds: patch.tournamentIds ?? m.tournamentIds ?? [],
                              calculatorKind: patch.calculatorKind !== undefined ? patch.calculatorKind : m.calculatorKind,
                              calculatorData: patch.calculatorData !== undefined ? patch.calculatorData : m.calculatorData,
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
            mutateStore((s) => ({ ...s, players: s.players.filter((p) => p.clientId !== clientId) }));
        },
        [mutateStore],
    );

    const addPendingGame = useCallback(
        (name: string) => {
            const game: PendingGame = {
                clientId: newOfflineId(),
                createdAt: new Date().toISOString(),
                status: "pending",
                name,
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
            mutateStore((s) => ({ ...s, games: s.games.filter((g) => g.clientId !== clientId) }));
        },
        [mutateStore],
    );

    const submitMatch = useCallback(
        async (payload: {
            game_id: Base58ID;
            score: Record<string, number>;
            tournament_ids?: Base58ID[];
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
                gameId: payload.game_id,
                score: payload.score,
                tournamentIds: payload.tournament_ids,
                calculatorKind: payload.calculator_kind,
                calculatorData: payload.calculator_data,
            });
            return { id: match.clientId };
        },
        [addPendingMatch],
    );

    const errorCount =
        store.games.filter((g) => g.status === "error").length +
        store.players.filter((p) => p.status === "error").length +
        store.matches.filter((m) => m.status === "error").length;

    return (
        <OfflineContext.Provider
            value={{
                pendingMatches: store.matches,
                pendingPlayers: store.players,
                pendingGames: store.games,
                pendingCount,
                errorCount,
                ready: loaded,
                offline,
                isOnline,
                apiReachable,
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
