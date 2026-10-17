// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// React 19 flushes passive effects on a later scheduler macrotask whose
// callback reads window.event; without the act environment the flush can
// leak past this file's jsdom teardown and crash whichever test file runs
// next with "window is not defined".
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { Base58ID } from "@/lib/id";
import type { TableSSE, UseTableSSEOptions } from "@/hooks/useTableSSE";
import { useTableSession, TABLE_SESSION_KEY, writeTableSession } from "@/hooks/useTableSession";
import { renderHook } from "./render-hook";
import { joinTablePromise, type SkullKingGameState, type TableGameState, type TableSummary } from "@/app/api";
import { toast } from "sonner";
import { pid, makeSkullKingState, makeTable } from "./test-utils";

vi.mock("@/app/api", async () => {
    const { mockApiModule } = await import("./test-utils");
    return mockApiModule({
        getTablePromise: vi.fn(),
        joinTablePromise: vi.fn(),
        submitTablePromise: vi.fn(),
        takeoverTablePromise: vi.fn(),
        updateTableState: vi.fn(),
    });
});

vi.mock("@/hooks/useTableSSE", () => ({
    useTableSSE: vi.fn(),
}));

vi.mock("sonner", async () => {
    const { mockSonnerModule } = await import("./test-utils");
    return mockSonnerModule();
});

import { useTableSSE } from "@/hooks/useTableSSE";
import { getTablePromise, takeoverTablePromise, updateTableState } from "@/app/api";

type SKState = SkullKingGameState;

const makeState = (phase: SKState["phase"] = "waiting-for-bids"): SKState => makeSkullKingState({ phase });

const ME = { id: "u1", playerId: pid("p1") };

// The hook is game-agnostic: narrowing and the conflict merge are dispatched
// by the adopted table's game_id (mergeTableStates → mergeSkullKingStates),
// so every scenario below runs a Skull King table and relies on the real
// per-game merge.

function useSKTableSession(me: { id?: string; playerId?: Base58ID } = ME) {
    return useTableSession({ me });
}

/** Configures the mocked SSE hook and captures its options (onTableGone). */
function mockSSE(overrides: { closed?: boolean } = {}) {
    let state: TableSSE = { table: null, savedMatchId: null, closed: false, connected: true, ...overrides };
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
        /** Delivers a server snapshot the way a real "state" SSE event would. */
        setTable(table: TableSummary) {
            state = { ...state, table };
        },
    };
}

type SessionHook = ReturnType<typeof useTableSession>;

/**
 * Renders useTableSession with a child component whose effect fires the host
 * mutation, mirroring the real page's structure (the Skull King auto-advance
 * effect in the game view vs this hook's effects in the table page): the
 * child's effect runs before the hook owner's own effects, which a bare
 * renderHook (no children) cannot reproduce.
 */
function renderAutoAdvanceProbe(): {
    rerender: () => void;
    unmount: () => void;
    /** Resolves of every host mutation the child effect has fired. */
    mutations: Array<Promise<unknown>>;
} {
    const container = document.createElement("div");
    const root = createRoot(container);
    const mutations: Array<Promise<unknown>> = [];

    function AutoAdvance({ gameState, syncHostState }: {
        gameState: TableGameState | null;
        syncHostState: SessionHook["syncHostState"];
    }) {
        useEffect(() => {
            const s = gameState as SkullKingGameState | null;
            if (!s || s.phase !== "result-entry") return;
            const allDone = (s.rounds[s.currentRound - 1] ?? [])
                .every((e) => e !== null && e.actual !== null);
            if (allDone) {
                mutations.push(syncHostState((prev) => ({ ...(prev as SkullKingGameState), phase: "round-complete" as const })).then(() => undefined));
            }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mirror the auto-advance: once per arriving state
        }, [gameState]);
        return null;
    }

    function Probe() {
        const s = useTableSession({ me: ME });
        return <AutoAdvance gameState={s.gameState} syncHostState={s.syncHostState} />;
    }

    const render = () => {
        act(() => {
            root.render(<Probe />);
        });
    };
    render();
    return {
        rerender: render,
        unmount: () => {
            act(() => {
                root.unmount();
            });
        },
        mutations,
    };
}

/**
 * Host resume in miniature: the persisted session hydrates, then the first
 * server snapshot is adopted — the sequence the tables page guarantees before
 * any host action becomes possible (the shell shows its connecting card
 * until the table is adopted).
 */
async function renderHostWithTable() {
    localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: true, myPlayerIndex: null }));
    const h = renderHook(() => useSKTableSession());
    vi.mocked(getTablePromise).mockResolvedValue(makeTable({ game_state: makeState() }));
    await act(async () => {
        await h.current.value.refreshFromServer();
    });
    return h;
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
});

describe("useTableSession", () => {
    it("writeTableSession persists a host session the hook hydrates", () => {
        mockSSE();
        act(() => {
            writeTableSession({ tableId: pid("t9"), isHost: true, myPlayerIndex: null });
        });

        expect(JSON.parse(localStorage.getItem(TABLE_SESSION_KEY)!)).toEqual({
            tableId: "t9",
            isHost: true,
            myPlayerIndex: null,
        });

        const h = renderHook(() => useSKTableSession());
        expect(h.current.value.session).toEqual({ tableId: pid("t9"), isHost: true, myPlayerIndex: null });
    });

    it("sanitizes the optimistic empty-tableId placeholder into a null session", () => {
        mockSSE();
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: "", isHost: true, myPlayerIndex: null }));

        const h = renderHook(() => useSKTableSession());
        expect(h.current.value.hydrated).toBe(true);
        expect(h.current.value.session).toBeNull();
        // Server-only: without a bound table there is no game state at all.
        expect(h.current.value.gameState).toBeNull();
    });

    it("hydrates a connected session and waits for the first snapshot", () => {
        mockSSE();
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: false, myPlayerIndex: 1 }));

        const h = renderHook(() => useSKTableSession());
        expect(h.current.value.session).toEqual({ tableId: pid("t1"), isHost: false, myPlayerIndex: 1 });
        expect(h.current.value.gameState).toBeNull();
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
        expect(h.current.value.gameState?.phase).toBe("waiting-for-bids");
        expect(h.current.value.connectedPlayerIds).toEqual([pid("p2")]);
        expect(h.current.value.awaitingSnapshot).toBe(false);
        expect(JSON.parse(localStorage.getItem(TABLE_SESSION_KEY)!)).toEqual({
            tableId: "t9",
            isHost: false,
            myPlayerIndex: 1,
        });
    });

    it("resetTableSession clears the session and the game state", () => {
        mockSSE();
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: true, myPlayerIndex: null }));
        const h = renderHook(() => useSKTableSession());

        act(() => {
            h.current.value.resetTableSession();
        });

        expect(h.current.value.session).toBeNull();
        expect(h.current.value.gameState).toBeNull();
        expect(localStorage.getItem(TABLE_SESSION_KEY)).toBeNull();
    });

    it("table gone while connected: toast + clean exit to the empty state", () => {
        const sse = mockSSE();
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: false, myPlayerIndex: 0 }));
        const h = renderHook(() => useSKTableSession());

        act(() => {
            sse.onTableGone!();
        });

        expect(toast.info).toHaveBeenCalled();
        expect(h.current.value.session).toBeNull();
        expect(h.current.value.gameState).toBeNull();
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
        expect(h.current.value.gameState).toBeNull();
    });

    it("closed event (host closed the table) sends connected players to the empty state", () => {
        const sse = mockSSE();
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: false, myPlayerIndex: 0 }));
        const h = renderHook(() => useSKTableSession());

        act(() => {
            sse.setClosed(true);
        });
        h.rerender(() => useSKTableSession());

        expect(toast.info).toHaveBeenCalled();
        expect(h.current.value.session).toBeNull();
        expect(h.current.value.gameState).toBeNull();
    });

    it("syncHostState without an adopted table is a no-op error", async () => {
        mockSSE();
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: true, myPlayerIndex: null }));
        const h = renderHook(() => useSKTableSession());

        let result: string | undefined;
        await act(async () => {
            result = await h.current.value.syncHostState((prev) => prev);
        });

        expect(result).toBe("error");
        expect(updateTableState).not.toHaveBeenCalled();
    });

    it("syncHostState merges the edit with the fresh state on conflict and retries once", async () => {
        mockSSE();
        // A player's submit landed between the host's read and write (fresh:
        // round 3, result-entry): the first patch conflicts with version 1,
        // the merge must keep the host's phase edit AND the fresh round, and
        // the merged state is retried with v2.
        const fresh = makeTable({ version: 2, game_state: { ...makeState("result-entry"), currentRound: 3 } });
        const done = makeTable({ version: 3, game_state: { ...makeState("round-complete"), currentRound: 3 } });
        vi.mocked(updateTableState)
            .mockResolvedValueOnce({ status: "conflict", table: fresh })
            .mockResolvedValueOnce({ status: "ok", table: done });

        const h = await renderHostWithTable();
        let result: string | undefined;
        await act(async () => {
            result = await h.current.value.syncHostState((prev) => ({ ...(prev as SkullKingGameState), phase: "bid-review" }));
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
        expect(h.current.value.gameState?.phase).toBe("round-complete");
    });

    it("syncHostState gives up after a second conflict with a toast", async () => {
        mockSSE();
        const fresh = makeTable({ version: 2, game_state: makeState() });
        vi.mocked(updateTableState)
            .mockResolvedValue({ status: "conflict", table: fresh });

        const h = await renderHostWithTable();
        let result: string | undefined;
        await act(async () => {
            result = await h.current.value.syncHostState((prev) => ({ ...(prev as SkullKingGameState), phase: "bid-review" }));
        });

        expect(result).toBe("conflict");
        expect(updateTableState).toHaveBeenCalledTimes(2);
        expect(toast.error).toHaveBeenCalled();
    });

    it("the conflict merge combines non-overlapping edits and retries with the merged state", async () => {
        mockSSE();
        // The player's submission moved the round on the server while the host
        // only changed the phase: the merged retry must carry both. (The
        // session is host-side; `before` is the state the edit was based on.)
        const fresh = makeTable({ version: 2, game_state: { ...makeState("waiting-for-bids"), currentRound: 3 } });
        const done = makeTable({ version: 3, game_state: { ...makeState(), currentRound: 3, phase: "bid-review" } });
        vi.mocked(updateTableState)
            .mockResolvedValueOnce({ status: "conflict", table: fresh })
            .mockResolvedValueOnce({ status: "ok", table: done });

        const h = await renderHostWithTable();
        let result: string | undefined;
        await act(async () => {
            result = await h.current.value.syncHostState((prev) => ({ ...(prev as SkullKingGameState), phase: "bid-review" }));
        });

        expect(result).toBe("ok");
        expect(updateTableState).toHaveBeenCalledTimes(2);
        expect(vi.mocked(updateTableState).mock.calls[1][1]).toBe(2);
        const retried = vi.mocked(updateTableState).mock.calls[1][2] as SkullKingGameState;
        expect(retried.phase).toBe("bid-review"); // the host's edit
        expect(retried.currentRound).toBe(3); // the player's concurrent change
    });

    it("the conflict merge keeps the editor's value in a same-field race", async () => {
        mockSSE();
        // Both sides changed the phase, to different values — a race after the
        // edit dialog already checked the seen value: last write wins.
        const fresh = makeTable({ version: 2, game_state: makeState("result-entry") });
        const done = makeTable({ version: 3, game_state: makeState("bid-review") });
        vi.mocked(updateTableState)
            .mockResolvedValueOnce({ status: "conflict", table: fresh })
            .mockResolvedValueOnce({ status: "ok", table: done });

        const h = await renderHostWithTable();
        let result: string | undefined;
        await act(async () => {
            result = await h.current.value.syncHostState((prev) => ({ ...(prev as SkullKingGameState), phase: "bid-review" }));
        });

        expect(result).toBe("ok");
        const retried = vi.mocked(updateTableState).mock.calls[1][2] as SkullKingGameState;
        expect(retried.phase).toBe("bid-review");
        expect(h.current.value.gameState?.phase).toBe("bid-review");
    });

    it("an SSE-triggered auto-advance patches the adopted snapshot's state, not a stale one", async () => {
        // The last player's result arrives via SSE; the page's auto-advance
        // (a child effect) fires before the hook owner's effects would have
        // caught up. The PATCH must carry the just-adopted snapshot's state —
        // pairing it with the fresh version is what let the auto-advance
        // pass the version check and wipe the submission server-side.
        const sse = mockSSE();
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: true, myPlayerIndex: null }));

        // v1 — the host's last known state, arriving via SSE: result entry,
        // Bob has not submitted yet.
        const settled = makeTable({
            version: 1,
            game_state: makeSkullKingState({
                phase: "result-entry",
                rounds: [[null], [{ bid: 1, actual: 1, bonus: 0 }, null]],
            }),
        });
        // v2 — Bob's result (a legal 0 bid) lands via SSE: every slot filled,
        // so the auto-advance fires.
        const snapshot = makeTable({
            version: 2,
            game_state: makeSkullKingState({
                phase: "result-entry",
                rounds: [[null], [{ bid: 1, actual: 1, bonus: 0 }, { bid: 0, actual: 2, bonus: 10 }]],
            }),
        });
        vi.mocked(updateTableState).mockResolvedValue({
            status: "ok",
            table: makeTable({
                version: 3,
                game_state: { ...snapshot.game_state, phase: "round-complete" } as SkullKingGameState,
            }),
        });

        const probe = renderAutoAdvanceProbe();

        // The host settles on v1 (all effects flushed — the ref is in sync).
        sse.setTable(settled);
        probe.rerender();
        expect(updateTableState).not.toHaveBeenCalled();

        // v2 arrives: adoptTable runs in the hook's own effect; the child
        // auto-advance effect fires on the next commit.
        sse.setTable(snapshot);
        probe.rerender();
        // The mutation's promise chain (PATCH → adopt) and the passive-effect
        // flush it schedules must settle while the jsdom environment is still
        // alive: a scheduler tick landing after teardown throws
        // "window is not defined" in whichever file runs next.
        await act(async () => {
            await Promise.all(probe.mutations);
            await new Promise((resolve) => setImmediate(resolve));
        });
        probe.unmount();

        expect(updateTableState).toHaveBeenCalledTimes(1);
        expect(vi.mocked(updateTableState).mock.calls[0][1]).toBe(2);
        const patched = vi.mocked(updateTableState).mock.calls[0][2] as SkullKingGameState;
        expect(patched.phase).toBe("round-complete");
        // Bob's just-submitted result survives the auto-advance.
        expect(patched.rounds[1][1]).toEqual({ bid: 0, actual: 2, bonus: 10 });
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
        expect(h.current.value.gameState?.phase).toBe("waiting-for-bids");
    });
});
