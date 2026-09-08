// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// Enable React's act() environment so async state updates don't warn.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import type { Base58ID } from "@/lib/id";
import type { UseTableSSEOptions } from "@/hooks/useTableSSE";
import { useTableSession, TABLE_SESSION_KEY } from "@/hooks/useTableSession";
import { renderHook } from "./render-hook";
import { joinTablePromise, type SkullKingGameState, type TableSummary } from "@/app/api";
import { toast } from "sonner";

vi.mock("@/app/api", () => ({
    getTablePromise: vi.fn(),
    joinTablePromise: vi.fn(),
    submitTablePromise: vi.fn(),
    takeoverTablePromise: vi.fn(),
    updateTableState: vi.fn(),
    isNetworkFailure: vi.fn(() => false),
    ApiError: class extends Error { status?: number },
}));

vi.mock("@/hooks/useTableSSE", () => ({
    useTableSSE: vi.fn(),
}));

vi.mock("sonner", () => ({
    toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { useTableSSE } from "@/hooks/useTableSSE";
import { getTablePromise, takeoverTablePromise, updateTableState } from "@/app/api";

const pid = (s: string) => s as Base58ID;

type SKState = SkullKingGameState;

function makeState(phase: SKState["phase"] = "waiting-for-bids"): SKState {
    return {
        phase,
        players: [{ id: pid("p1"), name: "Alice" }, { id: pid("p2"), name: "Bob" }],
        currentRound: 2,
        currentPlayerIndex: 0,
        rounds: [],
    };
}

function makeTable(overrides: Partial<TableSummary> & { game_state: SkullKingGameState }): TableSummary {
    return {
        id: pid("t1"),
        game_id: pid("g1"),
        host_user_id: pid("u1"),
        host_client_token: "",
        connected_player_ids: [],
        version: 1,
        created_at: "2026-01-01T00:00:00Z",
        expires_at: "2026-01-02T00:00:00Z",
        ...overrides,
    };
}

const initial = makeState("setup");

function isSK(state: unknown): state is SKState {
    return typeof state === "object" && state !== null && "rounds" in state;
}

const ME = { id: "u1", playerId: pid("p1") };

// Field-level three-way merge over the test game's scalars: fields only one
// side touched combine; a field both sides changed differently keeps the
// editor's value (last write wins).
function mergeSK(before: SKState, local: SKState, fresh: SKState): SKState {
    const mergeField = <K extends "phase" | "currentRound">(field: K): SKState[K] =>
        local[field] === before[field] ? fresh[field] : local[field];
    return { ...fresh, phase: mergeField("phase"), currentRound: mergeField("currentRound") };
}

function useSKTableSession(me: { id?: string; playerId?: Base58ID } = ME) {
    return useTableSession<SKState>({ initial, isGameState: isSK, me, mergeStates: mergeSK });
}

/** Configures the mocked SSE hook and captures its options (onTableGone). */
function mockSSE(overrides: { closed?: boolean } = {}) {
    let state = { table: null, savedMatchId: null, closed: false, connected: true, ...overrides };
    let options: UseTableSSEOptions | undefined;
    vi.mocked(useTableSSE).mockImplementation(
        ((_id: unknown, opts?: UseTableSSEOptions) => {
            options = opts;
            return state;
        }) as typeof useTableSSE,
    );
    return {
        get onTableGone() {
            return options?.onTableGone;
        },
        setClosed(closed: boolean) {
            state = { ...state, closed };
        },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
});

describe("useTableSession", () => {
    it("sanitizes the optimistic empty-tableId placeholder into a null session", () => {
        mockSSE();
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: "", isHost: true, myPlayerIndex: null }));

        const h = renderHook(() => useSKTableSession());
        expect(h.current.value.hydrated).toBe(true);
        expect(h.current.value.session).toBeNull();
        // Server-only: no table, so the state stays at the initial setup screen.
        expect(h.current.value.gameState.phase).toBe("setup");
    });

    it("hydrates a connected session and waits for the first snapshot", () => {
        mockSSE();
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: false, myPlayerIndex: 1 }));

        const h = renderHook(() => useSKTableSession());
        expect(h.current.value.session).toEqual({ tableId: pid("t1"), isHost: false, myPlayerIndex: 1 });
        expect(h.current.value.gameState.phase).toBe("setup");
        expect(h.current.value.awaitingSnapshot).toBe(true);
    });

    it("joinTable adopts the server state and session", async () => {
        mockSSE();
        vi.mocked(joinTablePromise).mockResolvedValue(
            makeTable({ id: pid("t9"), connected_player_ids: [pid("p2")], game_state: makeState() }),
        );

        const h = renderHook(() => useSKTableSession());
        await act(async () => {
            await h.current.value.joinTable({ id: pid("t9") } as never, pid("p2"));
        });

        expect(h.current.value.session).toEqual({ tableId: pid("t9"), isHost: false, myPlayerIndex: 1 });
        expect(h.current.value.gameState.phase).toBe("waiting-for-bids");
        expect(h.current.value.connectedPlayerIds).toEqual([pid("p2")]);
        expect(h.current.value.awaitingSnapshot).toBe(false);
        expect(JSON.parse(localStorage.getItem(TABLE_SESSION_KEY)!)).toEqual({
            tableId: "t9",
            isHost: false,
            myPlayerIndex: 1,
        });
    });

    it("resetTableSession clears the session and returns to the initial state", () => {
        mockSSE();
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: true, myPlayerIndex: null }));
        const h = renderHook(() => useSKTableSession());

        act(() => {
            h.current.value.resetTableSession();
        });

        expect(h.current.value.session).toBeNull();
        expect(h.current.value.gameState.phase).toBe("setup");
        expect(localStorage.getItem(TABLE_SESSION_KEY)).toBeNull();
    });

    it("table gone while connected: toast + clean exit to setup", () => {
        const sse = mockSSE();
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: false, myPlayerIndex: 0 }));
        const h = renderHook(() => useSKTableSession());

        act(() => {
            sse.onTableGone!();
        });

        expect(toast.info).toHaveBeenCalled();
        expect(h.current.value.session).toBeNull();
        expect(h.current.value.gameState.phase).toBe("setup");
        expect(localStorage.getItem(TABLE_SESSION_KEY)).toBeNull();
    });

    it("table gone while hosting: toast + reset too (server owns the state)", () => {
        const sse = mockSSE();
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: true, myPlayerIndex: null }));
        const h = renderHook(() => useSKTableSession());

        act(() => {
            sse.onTableGone!();
        });

        expect(toast.info).toHaveBeenCalled();
        expect(h.current.value.session).toBeNull();
        expect(h.current.value.gameState.phase).toBe("setup");
    });

    it("closed event (host closed the table) sends connected players to setup", () => {
        const sse = mockSSE();
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: false, myPlayerIndex: 0 }));
        const h = renderHook(() => useSKTableSession());

        act(() => {
            sse.setClosed(true);
        });
        h.rerender(() => useSKTableSession());

        expect(toast.info).toHaveBeenCalled();
        expect(h.current.value.session).toBeNull();
        expect(h.current.value.gameState.phase).toBe("setup");
    });

    it("syncHostState merges the edit with the fresh state on conflict and retries once", async () => {
        mockSSE();
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: true, myPlayerIndex: null }));

        // A player's submit landed between the host's read and write (fresh:
        // round 3, result-entry): the first patch conflicts with version 1,
        // the merge must keep the host's phase edit AND the fresh round, and
        // the merged state is retried with v2.
        const fresh = makeTable({ version: 2, game_state: { ...makeState("result-entry"), currentRound: 3 } });
        const done = makeTable({ version: 3, game_state: { ...makeState("round-complete"), currentRound: 3 } });
        vi.mocked(updateTableState)
            .mockResolvedValueOnce({ status: "conflict", table: fresh })
            .mockResolvedValueOnce({ status: "ok", table: done });

        const h = renderHook(() => useSKTableSession());
        let result: string | undefined;
        await act(async () => {
            result = await h.current.value.syncHostState((prev) => ({ ...prev, phase: "bid-review" }));
        });

        expect(result).toBe("ok");
        expect(updateTableState).toHaveBeenCalledTimes(2);
        expect(vi.mocked(updateTableState).mock.calls[0][1]).toBe(1); // base version
        expect(vi.mocked(updateTableState).mock.calls[1][1]).toBe(2); // fresh version from the conflict
        // The retry carries the host's edit AND the player's concurrent change.
        const retried = vi.mocked(updateTableState).mock.calls[1][2] as SkullKingGameState;
        expect(retried.phase).toBe("bid-review");
        expect(retried.currentRound).toBe(3);
        // The final adopted state is the server's response.
        expect(h.current.value.gameState.phase).toBe("round-complete");
    });

    it("syncHostState gives up after a second conflict with a toast", async () => {
        mockSSE();
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: true, myPlayerIndex: null }));

        const fresh = makeTable({ version: 2, game_state: makeState() });
        vi.mocked(updateTableState)
            .mockResolvedValue({ status: "conflict", table: fresh });

        const h = renderHook(() => useSKTableSession());
        let result: string | undefined;
        await act(async () => {
            result = await h.current.value.syncHostState((prev) => ({ ...prev, phase: "bid-review" }));
        });

        expect(result).toBe("conflict");
        expect(updateTableState).toHaveBeenCalledTimes(2);
        expect(toast.error).toHaveBeenCalled();
    });

    it("mergeStates combines non-overlapping edits and retries with the merged state", async () => {
        mockSSE();
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: true, myPlayerIndex: null }));

        // The player's submission moved the round on the server while the host
        // only changed the phase: the merged retry must carry both. (The
        // session is host-side; `before` is the state the edit was based on.)
        const fresh = makeTable({ version: 2, game_state: { ...makeState("setup"), currentRound: 3 } });
        const done = makeTable({ version: 3, game_state: { ...makeState(), currentRound: 3, phase: "bid-review" } });
        vi.mocked(updateTableState)
            .mockResolvedValueOnce({ status: "conflict", table: fresh })
            .mockResolvedValueOnce({ status: "ok", table: done });

        const h = renderHook(() => useSKTableSession());
        let result: string | undefined;
        await act(async () => {
            result = await h.current.value.syncHostState((prev) => ({ ...prev, phase: "bid-review" }));
        });

        expect(result).toBe("ok");
        expect(updateTableState).toHaveBeenCalledTimes(2);
        expect(vi.mocked(updateTableState).mock.calls[1][1]).toBe(2);
        const retried = vi.mocked(updateTableState).mock.calls[1][2] as SkullKingGameState;
        expect(retried.phase).toBe("bid-review"); // the host's edit
        expect(retried.currentRound).toBe(3); // the player's concurrent change
    });

    it("mergeStates keeps the editor's value in a same-field race", async () => {
        mockSSE();
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: true, myPlayerIndex: null }));

        // Both sides changed the phase, to different values — a race after the
        // edit dialog already checked the seen value: last write wins.
        const fresh = makeTable({ version: 2, game_state: makeState("result-entry") });
        const done = makeTable({ version: 3, game_state: makeState("bid-review") });
        vi.mocked(updateTableState)
            .mockResolvedValueOnce({ status: "conflict", table: fresh })
            .mockResolvedValueOnce({ status: "ok", table: done });

        const h = renderHook(() => useSKTableSession());
        let result: string | undefined;
        await act(async () => {
            result = await h.current.value.syncHostState((prev) => ({ ...prev, phase: "bid-review" }));
        });

        expect(result).toBe("ok");
        const retried = vi.mocked(updateTableState).mock.calls[1][2] as SkullKingGameState;
        expect(retried.phase).toBe("bid-review");
        expect(h.current.value.gameState.phase).toBe("bid-review");
    });

    it("adopting a snapshot with a different host downgrades the host session", async () => {
        mockSSE();
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: true, myPlayerIndex: null }));
        const h = renderHook(() => useSKTableSession());

        // Someone took over: the refetched table says another user hosts now.
        const takenOver = makeTable({
            id: pid("t1"),
            host_user_id: pid("someone-else"),
            game_state: makeState("waiting-for-bids"),
        });
        vi.mocked(getTablePromise).mockResolvedValue(takenOver);
        await act(async () => {
            await h.current.value.refreshFromServer();
        });

        expect(toast.info).toHaveBeenCalledWith("Ведение передано другому игроку");
        expect(h.current.value.session).toEqual({ tableId: pid("t1"), isHost: false, myPlayerIndex: 0 });
        expect(JSON.parse(localStorage.getItem(TABLE_SESSION_KEY)!)).toEqual({
            tableId: "t1",
            isHost: false,
            myPlayerIndex: 0,
        });
    });

    it("same user claiming from another device (token drift) downgrades this host", async () => {
        mockSSE();
        localStorage.setItem("game-table/client-token", "device-a");
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: true, myPlayerIndex: null }));
        const h = renderHook(() => useSKTableSession());

        // Same host user, but hosting was claimed from device B.
        const claimedElsewhere = makeTable({
            id: pid("t1"),
            host_user_id: pid("u1"),
            host_client_token: "device-b",
            game_state: makeState("waiting-for-bids"),
        });
        vi.mocked(getTablePromise).mockResolvedValue(claimedElsewhere);
        await act(async () => {
            await h.current.value.refreshFromServer();
        });

        expect(toast.info).toHaveBeenCalledWith("Ведущий режим открыт на другом устройстве");
        expect(h.current.value.session).toEqual({ tableId: pid("t1"), isHost: false, myPlayerIndex: 0 });
    });

    it("a host device whose token still matches stays host", async () => {
        mockSSE();
        localStorage.setItem("game-table/client-token", "device-a");
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: true, myPlayerIndex: null }));
        const h = renderHook(() => useSKTableSession());

        vi.mocked(getTablePromise).mockResolvedValue(makeTable({
            id: pid("t1"),
            host_user_id: pid("u1"),
            host_client_token: "device-a",
            game_state: makeState("waiting-for-bids"),
        }));
        await act(async () => {
            await h.current.value.refreshFromServer();
        });

        expect(toast.info).not.toHaveBeenCalled();
        expect(h.current.value.session?.isHost).toBe(true);
    });

    it("takeoverHosting claims the table and enters host mode", async () => {
        mockSSE();
        // The taker is a connected player of the table.
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: false, myPlayerIndex: 0 }));
        vi.mocked(takeoverTablePromise).mockResolvedValue(
            makeTable({ id: pid("t1"), host_user_id: pid("u1"), game_state: makeState() }),
        );
        const h = renderHook(() => useSKTableSession());

        await act(async () => {
            await h.current.value.takeoverHosting();
        });

        expect(takeoverTablePromise).toHaveBeenCalledWith(pid("t1"));
        expect(h.current.value.session).toEqual({ tableId: pid("t1"), isHost: true, myPlayerIndex: null });
        expect(h.current.value.gameState.phase).toBe("waiting-for-bids");
    });
});
