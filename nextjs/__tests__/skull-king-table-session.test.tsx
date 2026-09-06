// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// Enable React's act() environment so async state updates don't warn.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import type { Base58ID } from "@/lib/id";
import type { UseSkullKingSSEOptions } from "@/hooks/useSkullKingSSE";
import { useSkullKingTableSession, TABLE_SESSION_KEY } from "@/hooks/useSkullKingTableSession";
import { renderHook } from "./render-hook";
import { joinSkullKingTablePromise, type SkullKingGameState } from "@/app/api";
import { toast } from "sonner";

vi.mock("@/app/api", () => ({
    getSkullKingTablePromise: vi.fn(),
    joinSkullKingTablePromise: vi.fn(),
}));

vi.mock("@/hooks/useSkullKingSSE", () => ({
    useSkullKingSSE: vi.fn(),
}));

vi.mock("sonner", () => ({
    toast: { info: vi.fn(), error: vi.fn() },
}));

import { useSkullKingSSE } from "@/hooks/useSkullKingSSE";

const STATE_KEY = "skull-king-game/state";

const pid = (s: string) => s as Base58ID;

function makeState(phase: SkullKingGameState["phase"] = "bidding") {
    return {
        phase,
        players: [{ id: pid("p1"), name: "Alice" }, { id: pid("p2"), name: "Bob" }],
        currentRound: 2,
        currentPlayerIndex: 0,
        rounds: [],
    };
}

/** Configures the mocked SSE hook and captures its options (onTableGone). */
function mockSSE(overrides: { closed?: boolean } = {}) {
    let state = { table: null, savedMatchId: null, closed: false, ...overrides };
    let options: UseSkullKingSSEOptions | undefined;
    vi.mocked(useSkullKingSSE).mockImplementation(
        ((_id: unknown, opts?: UseSkullKingSSEOptions) => {
            options = opts;
            return state;
        }) as typeof useSkullKingSSE,
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

describe("useSkullKingTableSession", () => {
    it("sanitizes the optimistic empty-tableId placeholder into local-only mode", () => {
        mockSSE();
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: "", isHost: true, myPlayerIndex: null }));
        localStorage.setItem(STATE_KEY, JSON.stringify(makeState("round-complete")));

        const h = renderHook(() => useSkullKingTableSession());
        expect(h.current.value.hydrated).toBe(true);
        expect(h.current.value.session).toBeNull();
        // The local game survives — the host keeps their state.
        expect(h.current.value.gameState.phase).toBe("round-complete");
    });

    it("hydrates a connected session and discards any legacy local state", () => {
        mockSSE();
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: false, myPlayerIndex: 1 }));
        localStorage.setItem(STATE_KEY, JSON.stringify(makeState("round-complete")));

        const h = renderHook(() => useSkullKingTableSession());
        expect(h.current.value.session).toEqual({ tableId: pid("t1"), isHost: false, myPlayerIndex: 1 });
        // Server owns the state: nothing local, snapshot not yet arrived.
        expect(localStorage.getItem(STATE_KEY)).toBeNull();
        expect(h.current.value.gameState.phase).toBe("setup");
        expect(h.current.value.awaitingSnapshot).toBe(true);
    });

    it("persists game state to localStorage only in host/local mode", () => {
        mockSSE();
        const h = renderHook(() => useSkullKingTableSession());
        act(() => {
            h.current.value.setGameState(makeState("bidding"));
        });
        expect(JSON.parse(localStorage.getItem(STATE_KEY)!).phase).toBe("bidding");
    });

    it("never persists game state for a connected player", async () => {
        mockSSE();
        vi.mocked(joinSkullKingTablePromise).mockResolvedValue({
            game_state: makeState("waiting-for-bids"),
            connected_player_ids: [],
        } as never);
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: false, myPlayerIndex: 0 }));
        const h = renderHook(() => useSkullKingTableSession());

        await act(async () => {
            await h.current.value.joinTable(
                { id: pid("t1"), connected_player_ids: [pid("p1")] } as never,
                pid("p1"),
            );
        });

        act(() => {
            h.current.value.setGameState(makeState("result-entry"));
        });
        expect(h.current.value.gameState.phase).toBe("result-entry");
        expect(localStorage.getItem(STATE_KEY)).toBeNull();
    });

    it("joinTable adopts the server state and session", async () => {
        mockSSE();
        vi.mocked(joinSkullKingTablePromise).mockResolvedValue({
            game_state: makeState("waiting-for-bids"),
            connected_player_ids: [pid("p2")],
        } as never);

        const h = renderHook(() => useSkullKingTableSession());
        await act(async () => {
            await h.current.value.joinTable(
                { id: pid("t9") } as never,
                pid("p2"),
            );
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

    it("resetGame clears the session, the state, and both storage keys", () => {
        mockSSE();
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: true, myPlayerIndex: null }));
        localStorage.setItem(STATE_KEY, JSON.stringify(makeState()));
        const h = renderHook(() => useSkullKingTableSession());

        act(() => {
            h.current.value.setGameState(makeState("round-complete"));
        });
        act(() => {
            h.current.value.resetGame();
        });

        expect(h.current.value.session).toBeNull();
        expect(h.current.value.gameState.phase).toBe("setup");
        expect(localStorage.getItem(TABLE_SESSION_KEY)).toBeNull();
        expect(localStorage.getItem(STATE_KEY)).toBeNull();
    });

    it("table gone while connected: toast + clean exit to setup", () => {
        const sse = mockSSE();
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: false, myPlayerIndex: 0 }));
        const h = renderHook(() => useSkullKingTableSession());

        act(() => {
            sse.onTableGone!();
        });

        expect(toast.info).toHaveBeenCalled();
        expect(h.current.value.session).toBeNull();
        expect(h.current.value.gameState.phase).toBe("setup");
        expect(localStorage.getItem(TABLE_SESSION_KEY)).toBeNull();
    });

    it("table gone while hosting: downgrade to local, state preserved", () => {
        const sse = mockSSE();
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: true, myPlayerIndex: null }));
        localStorage.setItem(STATE_KEY, JSON.stringify(makeState("round-complete")));
        const h = renderHook(() => useSkullKingTableSession());

        act(() => {
            sse.onTableGone!();
        });

        expect(toast.error).toHaveBeenCalled();
        expect(h.current.value.session).toBeNull();
        expect(h.current.value.gameState.phase).toBe("round-complete");
        // Still a local game — state stays persisted.
        expect(JSON.parse(localStorage.getItem(STATE_KEY)!).phase).toBe("round-complete");
    });

    it("closed event (host reset) sends connected players to setup", () => {
        const sse = mockSSE();
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: false, myPlayerIndex: 0 }));
        const h = renderHook(() => useSkullKingTableSession());

        act(() => {
            sse.setClosed(true);
        });
        h.rerender(() => useSkullKingTableSession());

        expect(toast.info).toHaveBeenCalled();
        expect(h.current.value.session).toBeNull();
        expect(h.current.value.gameState.phase).toBe("setup");
    });
});
