"use client";

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
import { addMatchPromise, client, isNetworkFailure, pingApiPromise } from "../api";
import { useGames } from "../gamesContext";
import { useMatches } from "../matches/MatchesContext";
import { useMe } from "../meContext";
import { usePlayers } from "../players/PlayersContext";
import { SyncApi, SyncCallResult, syncOffline } from "@/lib/offline/sync";
import {
    OfflineStore,
    PendingGame,
    PendingMatch,
    PendingPlayer,
    emptyOfflineStore,
    isOfflineId,
    newOfflineId,
} from "@/lib/offline/types";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

const STORAGE_KEY = "offline-pending-v1";

export type SubmitMatchResult = { kind: "online"; id: number } | { kind: "offline"; clientId: string };

type OfflineState = {
    pendingMatches: PendingMatch[];
    pendingPlayers: PendingPlayer[];
    pendingGames: PendingGame[];
    pendingCount: number;
    errorCount: number;
    /** True once the store has been hydrated from localStorage after mount. */
    ready: boolean;
    isOnline: boolean;
    /**
     * API server reachability (independent of network): null until first probe,
     * false when the network is up but /ping fails (server is off). Used to show
     * the indicator and to auto-resync once the API comes back.
     */
    apiReachable: boolean | null;
    isSyncing: boolean;
    /** JWT expired while syncing — the user must log in again. */
    authRequired: boolean;
    addPendingMatch: (m: { gameId: string; score: Record<string, number> }) => PendingMatch;
    updatePendingMatch: (clientId: string, patch: { gameId: string; score: Record<string, number> }) => void;
    deletePendingMatch: (clientId: string) => void;
    addPendingPlayer: (name: string) => PendingPlayer;
    updatePendingPlayer: (clientId: string, name: string) => void;
    deletePendingPlayer: (clientId: string) => void;
    addPendingGame: (name: string) => PendingGame;
    updatePendingGame: (clientId: string, name: string) => void;
    deletePendingGame: (clientId: string) => void;
    /**
     * Offline-aware match submission: posts to the server when online, queues a
     * pending match when offline or when the request fails at the network level.
     */
    submitMatch: (payload: { game_id: string; score: Record<string, number> }) => Promise<SubmitMatchResult>;
    syncNow: () => void;
};

const OfflineContext = createContext<OfflineState | undefined>(undefined);

function loadStore(): OfflineStore {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return { ...emptyOfflineStore(), ...JSON.parse(raw) };
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
    async createGame(body): Promise<SyncCallResult<{ id: string }>> {
        const { data, error, response } = await client.POST("/games", { body });
        if (error) return { ok: false, status: response.status, message: error.message ?? `Ошибка ${response.status}` };
        return { ok: true, data: { id: data.data.id } };
    },
    async createPlayer(body): Promise<SyncCallResult<{ id: string }>> {
        const { data, error, response } = await client.POST("/players", { body });
        if (error) return { ok: false, status: response.status, message: error.message ?? `Ошибка ${response.status}` };
        return { ok: true, data: { id: data.data.id } };
    },
    async addMatch(body): Promise<SyncCallResult<{ id: number }>> {
        const { data, error, response } = await client.POST("/matches", { body });
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
    const pathname = usePathname();
    const syncInProgressRef = useRef(false);
    const storeRef = useRef(store);
    useEffect(() => {
        storeRef.current = store;
    }, [store]);

    const pendingCount = store.games.length + store.players.length + store.matches.length;
    const pendingCountRef = useRef(pendingCount);
    const apiReachableRef = useRef<boolean | null>(apiReachable);
    useEffect(() => {
        pendingCountRef.current = pendingCount;
        apiReachableRef.current = apiReachable;
    }, [pendingCount, apiReachable]);

    const { canEdit } = useMe();
    const { invalidate: invalidateMatches } = useMatches();
    const { invalidate: invalidatePlayers } = usePlayers();
    const { invalidate: invalidateGames } = useGames();

    // localStorage is unavailable during static export rendering — hydrate after mount.
    useEffect(() => {
        /* eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe hydration */
        setStore(loadStore());
        setLoaded(true);
    }, []);

    const mutateStore = useCallback((fn: (s: OfflineStore) => OfflineStore) => {
        setStore((prev) => {
            const next = fn(prev);
            persistStore(next);
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
                }
            })
            .finally(() => {
                syncInProgressRef.current = false;
                setIsSyncing(false);
            });
    }, [invalidateGames, invalidateMatches, invalidatePlayers]);

    // Auto-sync: after the store is loaded, when the network returns, and when
    // edit rights become known. Sync requires auth, so gate on canEdit.
    useEffect(() => {
        if (!loaded || !isOnline || !canEdit) return;
        syncNow();
    }, [loaded, isOnline, canEdit, syncNow]);

    useEffect(() => {
        const onOnline = () => syncNow();
        window.addEventListener("online", onOnline);
        return () => window.removeEventListener("online", onOnline);
    }, [syncNow]);

    // Resync when the tab regains focus — covers the "network up but API was
    // down" case, where no `online` event fires when the server comes back.
    useEffect(() => {
        const onFocus = () => {
            if (navigator.onLine && canEdit) syncNow();
        };
        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onFocus);
        return () => {
            window.removeEventListener("focus", onFocus);
            document.removeEventListener("visibilitychange", onFocus);
        };
    }, [syncNow, canEdit]);

    // API health probe with exponential backoff (30s → 15min). Pings on mount,
    // on navigation, on focus/online, and on a self-scheduling timer. A successful
    // ping after a failure (or while items are pending) triggers a resync, so the
    // queue drains once the server comes back even without a network drop.
    useEffect(() => {
        if (!loaded) return;

        const MIN_DELAY = 30_000;
        const MAX_DELAY = 15 * 60_000;
        let delay = MIN_DELAY;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let cancelled = false;

        const schedule = () => {
            if (cancelled) return;
            timer = setTimeout(run, delay);
        };

        const run = async () => {
            if (cancelled) return;
            if (!navigator.onLine) {
                // Offline is reported by useOnlineStatus; don't probe, just back off.
                delay = Math.min(delay * 2, MAX_DELAY);
                schedule();
                return;
            }
            const wasReachable = apiReachableRef.current;
            const ok = await pingApiPromise();
            if (cancelled) return;
            setApiReachable(ok);
            if (ok) {
                delay = MIN_DELAY; // reset backoff while healthy
                // API just became reachable (or first success) and work is queued.
                if (wasReachable !== true && pendingCountRef.current > 0 && canEdit) {
                    syncNow();
                }
            } else {
                delay = Math.min(delay * 2, MAX_DELAY);
            }
            schedule();
        };

        const reset = () => {
            delay = MIN_DELAY;
            if (timer) clearTimeout(timer);
            run();
        };

        run();
        window.addEventListener("focus", reset);
        window.addEventListener("online", reset);
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
            window.removeEventListener("focus", reset);
            window.removeEventListener("online", reset);
        };
        // Re-run the probe immediately on navigation and when new items are queued.
    }, [loaded, pathname, pendingCount, canEdit, syncNow]);

    const addPendingMatch = useCallback(
        ({ gameId, score }: { gameId: string; score: Record<string, number> }) => {
            const match: PendingMatch = {
                clientId: newOfflineId(),
                createdAt: new Date().toISOString(),
                status: "pending",
                gameId,
                score,
            };
            mutateStore((s) => ({ ...s, matches: [...s.matches, match] }));
            return match;
        },
        [mutateStore],
    );

    const updatePendingMatch = useCallback(
        (clientId: string, patch: { gameId: string; score: Record<string, number> }) => {
            mutateStore((s) => ({
                ...s,
                matches: s.matches.map((m) =>
                    m.clientId === clientId
                        ? { ...m, gameId: patch.gameId, score: patch.score, status: "pending", error: undefined }
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
        (name: string) => {
            const player: PendingPlayer = {
                clientId: newOfflineId(),
                createdAt: new Date().toISOString(),
                status: "pending",
                name,
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
        async (payload: { game_id: string; score: Record<string, number> }): Promise<SubmitMatchResult> => {
            const referencesPending =
                isOfflineId(payload.game_id) || Object.keys(payload.score).some(isOfflineId);
            if (isOnline && !referencesPending) {
                try {
                    const result = await addMatchPromise(payload);
                    return { kind: "online", id: result.id };
                } catch (e) {
                    if (!isNetworkFailure(e)) throw e;
                    // network died mid-request — fall through to the offline queue
                }
            }
            const match = addPendingMatch({ gameId: payload.game_id, score: payload.score });
            return { kind: "offline", clientId: match.clientId };
        },
        [isOnline, addPendingMatch],
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
