"use client";
import type { Base58ID } from "@/lib/id";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
    getTablePromise,
    joinTablePromise,
    submitTablePromise,
    TableGameState,
    TableStateUpdate,
    TableSubmitInput,
    TableSummary,
    takeoverTablePromise,
    updateTableState,
} from "@/app/api";
import { getTableClientToken } from "@/lib/table-client";
import { loadOfflineStore } from "@/app/offline/OfflineContext";
import { useTableSSE } from "@/hooks/useTableSSE";

/**
 * The active table session, persisted in localStorage so a reload keeps the
 * role (ADR-15, generalized in ADR-16). `isHost: true` — the creator who
 * drives the game; `isHost: false` — a connected player who submits their own
 * input and receives full-state snapshots. No session — the setup screen.
 */
export type TableSession = {
    tableId: Base58ID;
    isHost: boolean;
    myPlayerIndex: number | null; // null = observer / host (controls all)
};

/** Local-storage key of the active session; read directly by the invite toast. */
export const TABLE_SESSION_KEY = "game-table/session";

/**
 * Waits until the sync engine has flushed the just-queued match to the server:
 * the engine removes the item from the persisted store on success (an item the
 * server rejected stays, with an error badge). Table teardown broadcasts the
 * match id to the connected players, so it must not fire before the match
 * exists. Returns false on timeout (e.g. the network died right after saving).
 */
export async function waitForSyncedMatch(matchId: string, timeoutMs = 10_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    // Let the queue write and the ping+sync get going first — React persists
    // the store shortly after submitMatch returns, and a sync flush takes at
    // least a round trip while online.
    await new Promise((r) => setTimeout(r, 400));
    while (Date.now() < deadline) {
        if (!loadOfflineStore().matches.some((m) => m.clientId === matchId)) return true;
        await new Promise((r) => setTimeout(r, 400));
    }
    return false;
}

function readStoredSession(): TableSession | null {
    try {
        const raw = localStorage.getItem(TABLE_SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as TableSession | null;
        if (!parsed || typeof parsed.isHost !== "boolean") return null;
        // The optimistic placeholder written while a table is being created
        // (empty tableId) must never survive a reload: the server-assigned id
        // is unrecoverable, so fall back to the setup screen.
        if (!parsed.tableId) return null;
        return parsed;
    } catch {
        return null;
    }
}

type Options<S extends TableGameState> = {
    /** The game's initial (setup) state, shown before a table exists. */
    initial: S;
    /** Narrows the generic table state union to the game's state. */
    isGameState: (state: TableGameState) => state is S;
    /** Current user identity — drives hosting drift detection and takeover. */
    me: { id?: string; playerId?: Base58ID };
    /**
     * Field-level three-way merge of the host's edit (based on `before`) onto
     * the fresh server state, returned merged. Fields only one side touched
     * keep that side, and a same-field race resolves to the editor's
     * just-confirmed value (last write wins, same as a connected player's
     * upsert; the informed conflict choice happens in the edit dialog before
     * saving). This is what makes whole-state host patches safe alongside
     * player submissions.
     */
    mergeStates: (before: S, local: S, fresh: S) => S;
};

/**
 * Owns the live-table session and the in-memory game state (ADR-16). The
 * server is the single source of truth: no game state is persisted locally —
 * a reload refetches via the SSE connect snapshot.
 *
 *   - **Host** (`session.isHost`): edits apply optimistically and sync with
 *     `syncHostState`, which patches with the version it was based on. A
 *     concurrent change (player submission, the host's other device) returns
 *     the current table; the game's `mergeStates` combines both sides'
 *     changes and the merged state is retried once, so updates never
 *     silently erase each other.
 *   - **Connected player** (`session.isHost === false`): submits via
 *     `submitInput`; every server snapshot (SSE, submit response, refetch)
 *     replaces the local state.
 *
 * Also wires the table SSE subscription: applies full-state snapshots, and
 * handles the terminal events — `saved` (exposed for the redirect) and
 * `closed` (host closed the table) — plus recovery when the table disappears
 * server-side (closed/saved while this client was offline, or expiry).
 */
export function useTableSession<S extends TableGameState>(options: Options<S>) {
    const { initial, isGameState, me, mergeStates } = options;
    const [hydrated, setHydrated] = useState(false);
    const [session, setSessionState] = useState<TableSession | null>(null);
    const [gameState, setGameStateValue] = useState<S>(initial);
    const [connectedPlayerIds, setConnectedPlayerIds] = useState<Base58ID[]>([]);
    const [table, setTable] = useState<TableSummary | null>(null);

    // Authoritative values for same-tick decisions and PATCH versions.
    const sessionRef = useRef<TableSession | null>(null);
    const tableRef = useRef<TableSummary | null>(null);

    // One-time hydration of the persisted session (the state itself always
    // arrives from the server).
    useEffect(() => {
        /* eslint-disable react-hooks/set-state-in-effect -- SSR-safe hydration: localStorage is only available after mount */
        const stored = readStoredSession();
        sessionRef.current = stored;
        setSessionState(stored);
        setHydrated(true);
        /* eslint-enable react-hooks/set-state-in-effect */
    }, []);

    // Latest identity for adoptTable's drift check without re-creating the
    // callback when me changes.
    const meRef = useRef(me);
    useEffect(() => {
        meRef.current = me;
    }, [me]);

    // This device's hosting-claim token (stable per browser; empty disables
    // the client-side check, e.g. when localStorage is unavailable).
    const clientToken = useMemo(() => getTableClientToken(), []);

    const setSession = useCallback((next: TableSession | null) => {
        sessionRef.current = next;
        setSessionState(next);
        if (next === null || !next.tableId) {
            // null (or the transient pre-create placeholder) is never persisted
            localStorage.removeItem(TABLE_SESSION_KEY);
        } else {
            localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify(next));
        }
    }, []);

    // Adopt a server snapshot: game state (narrowed to the game), connected
    // players, and the version that later host patches must be based on. The
    // ref is updated synchronously so an in-flight syncHostState retry sees
    // the fresh version without waiting for a re-render.
    const adoptTable = useCallback((snapshot: TableSummary) => {
        tableRef.current = snapshot;
        setTable(snapshot);
        setConnectedPlayerIds(snapshot.connected_player_ids);
        if (isGameState(snapshot.game_state)) {
            setGameStateValue(snapshot.game_state);
        }
        // Hosting drift: another user took the table over, or — the more
        // common case — the same user claimed hosting from another device
        // (host_user_id unchanged, but the claim token moved). Step down to a
        // participant/viewer instead of failing host actions with 403s or
        // running two hosts (ADR-18).
        const s = sessionRef.current;
        const meNow = meRef.current;
        const otherUserHosts = meNow.id && snapshot.host_user_id !== meNow.id;
        const otherDeviceHosts = !!snapshot.host_client_token && !!clientToken &&
            snapshot.host_client_token !== clientToken;
        if (s?.isHost && (otherUserHosts || otherDeviceHosts)) {
            const playerIdx = meNow.playerId
                ? snapshot.game_state.players.findIndex((p) => p.id === meNow.playerId)
                : -1;
            const downgraded: TableSession = {
                tableId: snapshot.id,
                isHost: false,
                myPlayerIndex: playerIdx === -1 ? null : playerIdx,
            };
            sessionRef.current = downgraded;
            setSessionState(downgraded);
            localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify(downgraded));
            toast.info(otherUserHosts
                ? "Ведение передано другому игроку"
                : "Ведущий режим открыт на другом устройстве");
        }
    }, [isGameState, clientToken]);

    // Exit to a clean setup screen in any mode. The caller is responsible for
    // the server-side table teardown (host delete / save).
    const resetTableSession = useCallback(() => {
        sessionRef.current = null;
        setSessionState(null);
        setGameStateValue(initial);
        setConnectedPlayerIds([]);
        setTable(null);
        localStorage.removeItem(TABLE_SESSION_KEY);
    }, [initial]);

    // Join a table as a connected player: server-side join, then remember the
    // session and adopt the server's state. Rejects (throws) on API errors so
    // the caller can keep its joining-spinner/toast handling.
    const joinTable = useCallback(
        async (target: TableSummary, myPlayerId: Base58ID | null): Promise<void> => {
            const updated = await joinTablePromise(target.id);
            const playerIdx = myPlayerId
                ? updated.game_state.players.findIndex((p) => p.id === myPlayerId)
                : -1;
            setSession({
                tableId: target.id,
                isHost: false,
                myPlayerIndex: playerIdx === -1 ? null : playerIdx,
            });
            adoptTable(updated);
        },
        [setSession, adoptTable],
    );

    // Claim hosting for this device — the action behind the explicit
    // "Стать ведущим" button. This is the ONLY way hosting reaches a device
    // that does not already have a stored host session: entering a table
    // (deep-link, invite toast, lobby) joins as a participant and must never
    // claim hosting on its own. The takeover endpoint is idempotent for the
    // account that already hosts — that is how hosting deliberately moves
    // between that account's devices; the previous host device steps down on
    // the broadcast (hosting-drift check in adoptTable).
    const takeoverHosting = useCallback(
        async (): Promise<void> => {
            const s = sessionRef.current;
            if (!s?.tableId) throw new Error("нет активного стола");
            const table = await takeoverTablePromise(s.tableId);
            setSession({ tableId: table.id, isHost: true, myPlayerIndex: null });
            adoptTable(table);
        },
        [setSession, adoptTable],
    );

    // The table vanished server-side (deleted while offline, expired). Never
    // a reason to strand the user on a frozen screen: back to the setup.
    const handleTableGone = useCallback(() => {
        if (!sessionRef.current) return;
        toast.info("Стол закрыт или партия уже сохранена");
        resetTableSession();
    }, [resetTableSession]);

    const sse = useTableSSE(session?.tableId || null, { onTableGone: handleTableGone });
    // A host's own PATCH echoes back as a snapshot; applying it keeps the
    // version and any concurrent changes flowing.
    useEffect(() => {
        if (sse.table) {
            /* eslint-disable react-hooks/set-state-in-effect -- apply state pushed from the SSE subscription */
            adoptTable(sse.table);
            /* eslint-enable react-hooks/set-state-in-effect */
        }
    }, [sse.table, adoptTable]);

    // The host tore the table down without saving: connected players return
    // to the setup screen instead of discovering a 404 later.
    useEffect(() => {
        if (!sse.closed) return;
        if (sessionRef.current && !sessionRef.current.isHost) {
            toast.info("Ведущий удалил стол");
            resetTableSession();
        }
    }, [sse.closed, resetTableSession]);

    // gameStateRef lets syncHostState read the latest state without re-creating
    // the callback on every state change; synced after commit, before any
    // user-triggered mutation can run.
    const gameStateRef = useRef(gameState);
    useEffect(() => {
        gameStateRef.current = gameState;
    }, [gameState]);

    // Host mutation: apply the updater locally, patch with the current
    // version, and on a version conflict combine the edit with the fresh
    // server state via the game's mergeStates (fields only one side touched
    // combine; a same-field race keeps the editor's value).
    const syncHostState = useCallback(
        async (updater: (prev: S) => S): Promise<TableStateUpdate["status"] | "error"> => {
            const s = sessionRef.current;
            if (!(s?.isHost && s.tableId)) return "error";
            const before = gameStateRef.current;
            let next = updater(before);
            setGameStateValue(next);
            let baseVersion = tableRef.current?.version ?? 1;
            for (let attempt = 0; attempt < 2; attempt++) {
                let result: TableStateUpdate;
                try {
                    result = await updateTableState(s.tableId, baseVersion, next);
                } catch (err) {
                    toast.error("Ошибка синхронизации: " + (err instanceof Error ? err.message : String(err)));
                    return "error";
                }
                if (result.status === "ok") {
                    adoptTable(result.table);
                    return "ok";
                }
                if (!isGameState(result.table.game_state)) return "error";
                const fresh = result.table.game_state;
                baseVersion = result.table.version;
                // Merge instead of overwrite: the server moved under us (a
                // player's submit), so combine both sides' changes. A
                // same-field race keeps the editor's just-confirmed value —
                // the informed choice happened in the edit dialog; this is
                // last-write-wins, same as a player's upsert.
                next = mergeStates(before, next, fresh);
                setGameStateValue(next);
                // No adoptTable here: the conflict snapshot would wipe the
                // merged edit from the grid while the retry is in flight.
            }
            toast.error("Не удалось сохранить: состояние изменилось, попробуйте ещё раз");
            return "conflict";
        },
        [adoptTable, isGameState, mergeStates],
    );

    // Manual refetch (recovery from 409s on submits, catch-up after reconnect).
    const refreshFromServer = useCallback(async () => {
        const s = sessionRef.current;
        if (!s?.tableId) return;
        try {
            adoptTable(await getTablePromise(s.tableId));
        } catch {
            // ignore — SSE recovery reports missing tables via onTableGone
        }
    }, [adoptTable]);

    // Connected player's submission through the generic endpoint; the returned
    // table is adopted. On error the state is refreshed so the UI reflects the
    // actual phase; the error rethrows for the page's toast.
    const submitInput = useCallback(
        async (input: TableSubmitInput): Promise<void> => {
            const s = sessionRef.current;
            if (!s?.tableId) throw new Error("нет активного стола");
            try {
                adoptTable(await submitTablePromise(s.tableId, input));
            } catch (err) {
                await refreshFromServer();
                throw err;
            }
        },
        [adoptTable, refreshFromServer],
    );

    const isConnectedPlayer = session !== null && !session.isHost;
    const awaitingSnapshot = isConnectedPlayer && (table === null || table.id !== session.tableId);

    return {
        hydrated,
        session,
        setSession,
        gameState,
        setGameState: setGameStateValue,
        table,
        connectedPlayerIds,
        resetTableSession,
        joinTable,
        takeoverHosting,
        syncHostState,
        submitInput,
        savedMatchId: sse.savedMatchId,
        closed: sse.closed,
        connected: sse.connected,
        refreshFromServer,
        /** Connected player whose server snapshot has not arrived yet. */
        awaitingSnapshot,
    };
}
