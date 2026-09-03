"use client";
import type { Base58ID } from "@/lib/id";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
    getSkullKingTablePromise,
    joinSkullKingTablePromise,
    SkullKingGameState as GameState,
    SkullKingTableSummary,
} from "@/app/api";
import { initialState } from "@/components/calculators/skull-king";
import { useSkullKingSSE } from "@/hooks/useSkullKingSSE";

/**
 * The active Skull King table session, persisted in localStorage so a reload
 * keeps the role. `isHost: true` — the creator who drives the game;
 * `isHost: false` — a connected player who submits their own bid/result and
 * receives full-state snapshots. No session — a fresh or local-only game.
 */
export type TableSession = {
    tableId: Base58ID;
    isHost: boolean;
    myPlayerIndex: number | null; // null = observer / host (controls all)
};

/** Local-storage key of the active session; read directly by the invite toast. */
export const TABLE_SESSION_KEY = "skull-king-game/table-session";
const STATE_KEY = "skull-king-game/state";

function readStoredSession(): TableSession | null {
    try {
        const raw = localStorage.getItem(TABLE_SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as TableSession | null;
        if (!parsed || typeof parsed.isHost !== "boolean") return null;
        // The optimistic placeholder written while a table is being created
        // (empty tableId) must never survive a reload: the server-assigned id
        // is unrecoverable, so fall back to the local game.
        if (!parsed.tableId) return null;
        return parsed;
    } catch {
        return null;
    }
}

function readStoredGameState(): GameState {
    try {
        const raw = localStorage.getItem(STATE_KEY);
        if (!raw) return initialState;
        const parsed = JSON.parse(raw) as unknown;
        return parsed && typeof parsed === "object" ? (parsed as GameState) : initialState;
    } catch {
        return initialState;
    }
}

/**
 * Owns the Skull King table session and the local game state, with a strict
 * mode policy (ADR-15):
 *
 *   - **Host / local-only** (`session === null` or `session.isHost`): the
 *     game state is persisted to localStorage and synced to the server table
 *     by the page's mutation wrappers. A reload restores the game.
 *   - **Connected player** (`session.isHost === false`): the server is the
 *     only source of truth. State is kept in memory and re-fetched on load
 *     (SSE connect snapshot); nothing is written to localStorage. A connected
 *     player can therefore never reload into a stale local copy of the game,
 *     and the only way back to host mode is starting a new game from setup.
 *
 * Also wires the table SSE subscription: applies full-state snapshots, and
 * handles the terminal events — `saved` (exposed for the redirect) and
 * `closed` (host reset) — plus recovery when the table disappears server-side
 * (host reset/saved while this client was offline, or expiry).
 */
export function useSkullKingTableSession() {
    const [hydrated, setHydrated] = useState(false);
    const [session, setSessionState] = useState<TableSession | null>(null);
    const [gameState, setGameStateValue] = useState<GameState>(initialState);
    const [connectedPlayerIds, setConnectedPlayerIds] = useState<Base58ID[]>([]);
    // The table id of the last applied server snapshot — drives the
    // "connecting" placeholder shown to rejoining connected players.
    const [snapshotTableId, setSnapshotTableId] = useState<Base58ID | null>(null);

    // Authoritative session for same-tick decisions (setGameState must know
    // the mode even when called from a closure captured before setSession).
    const sessionRef = useRef<TableSession | null>(null);

    // One-time hydration. While a connected session exists, any stored game
    // state is legacy garbage from older versions — the server state arrives
    // with the SSE connect snapshot.
    useEffect(() => {
        /* eslint-disable react-hooks/set-state-in-effect -- SSR-safe hydration: localStorage is only available after mount */
        const stored = readStoredSession();
        sessionRef.current = stored;
        setSessionState(stored);
        if (stored && !stored.isHost) {
            localStorage.removeItem(STATE_KEY);
        } else {
            setGameStateValue(readStoredGameState());
        }
        setHydrated(true);
        /* eslint-enable react-hooks/set-state-in-effect */
    }, []);

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

    // In-memory state update; persisted to localStorage only in host/local
    // mode — connected players never write a local copy (ADR-15).
    const setGameState = useCallback((next: GameState | ((prev: GameState) => GameState)) => {
        setGameStateValue((prev) => {
            const value = typeof next === "function" ? next(prev) : next;
            const s = sessionRef.current;
            if (s === null || s.isHost) {
                localStorage.setItem(STATE_KEY, JSON.stringify(value));
            }
            return value;
        });
    }, []);

    // Exit to a clean setup screen in any mode. The caller is responsible for
    // the server-side table teardown (host delete / save).
    const resetGame = useCallback(() => {
        sessionRef.current = null;
        setSessionState(null);
        setGameStateValue(initialState);
        setConnectedPlayerIds([]);
        setSnapshotTableId(null);
        localStorage.removeItem(TABLE_SESSION_KEY);
        localStorage.removeItem(STATE_KEY);
    }, []);

    // Join a table as a connected player: server-side join, then remember the
    // session and adopt the server's state. Rejects (throws) on API errors so
    // the caller can keep its joining-spinner/toast handling.
    const joinTable = useCallback(
        async (table: SkullKingTableSummary, myPlayerId: Base58ID | null): Promise<void> => {
            const updated = await joinSkullKingTablePromise(table.id);
            const playerIdx = myPlayerId
                ? updated.game_state.players.findIndex((p) => p.id === myPlayerId)
                : -1;
            setSession({
                tableId: table.id,
                isHost: false,
                myPlayerIndex: playerIdx === -1 ? null : playerIdx,
            });
            setGameState(updated.game_state);
            setConnectedPlayerIds(updated.connected_player_ids);
            setSnapshotTableId(table.id);
        },
        [setSession, setGameState],
    );

    // The table vanished server-side (deleted while offline, expired). Never
    // a reason to strand the user on a frozen screen: connected players go to
    // setup, hosts continue their game locally.
    const handleTableGone = useCallback(() => {
        const s = sessionRef.current;
        if (s && !s.isHost) {
            toast.info("Стол закрыт или партия уже сохранена");
            resetGame();
        } else if (s) {
            toast.error("Стол не найден — игра продолжается локально");
            setSession(null);
        }
    }, [resetGame, setSession]);

    const { table: sseTable, savedMatchId, closed } = useSkullKingSSE(session?.tableId || null, {
        onTableGone: handleTableGone,
    });

    // Apply every full-state snapshot the stream delivers (connect snapshot,
    // host edits, joins, other players' bids/results).
    useEffect(() => {
        if (!sseTable) return;
        /* eslint-disable react-hooks/set-state-in-effect -- apply state pushed from the SSE subscription */
        setGameState(sseTable.game_state);
        setConnectedPlayerIds(sseTable.connected_player_ids);
        setSnapshotTableId(sseTable.id);
        /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sseTable]);

    // The host tore the table down without saving (new game): connected
    // players return to the setup screen instead of discovering a 404 later.
    useEffect(() => {
        if (!closed) return;
        if (sessionRef.current && !sessionRef.current.isHost) {
            toast.info("Ведущий закрыл стол");
            resetGame();
        }
    }, [closed, resetGame]);

    // Manual state refetch (recovery from phase-mismatch 409s on submits).
    const refreshFromServer = useCallback(async () => {
        const s = sessionRef.current;
        if (!s?.tableId) return;
        try {
            const table = await getSkullKingTablePromise(s.tableId);
            setGameState(table.game_state);
            setConnectedPlayerIds(table.connected_player_ids);
            setSnapshotTableId(table.id);
        } catch {
            // ignore — SSE recovery reports missing tables via onTableGone
        }
    }, [setGameState]);

    const isConnectedPlayer = session !== null && !session.isHost;
    const awaitingSnapshot = isConnectedPlayer && session.tableId !== snapshotTableId;

    return {
        hydrated,
        session,
        gameState,
        setGameState,
        setSession,
        resetGame,
        joinTable,
        connectedPlayerIds,
        savedMatchId,
        refreshFromServer,
        /** Connected player whose server snapshot has not arrived yet. */
        awaitingSnapshot,
    };
}
