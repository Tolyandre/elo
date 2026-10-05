// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

import { act } from "react";
import type { Base58ID } from "@/lib/id";
import { useTableSession, TABLE_SESSION_KEY } from "@/hooks/useTableSession";
import { useTableDeepLink } from "@/hooks/useTableDeepLink";
import { renderHook } from "./render-hook";
import { getTablePromise, joinTablePromise, type SkullKingGameState, type TableSummary } from "@/app/api";
import { toast } from "sonner";
import { pid, makeTable as makeBaseTable } from "./test-utils";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

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
    useTablesLobbySSE: vi.fn(() => 0),
}));

vi.mock("sonner", async () => {
    const { mockSonnerModule } = await import("./test-utils");
    return mockSonnerModule();
});

import { useTableSSE } from "@/hooks/useTableSSE";

type SKState = SkullKingGameState;

// This file's scenarios talk about table t9 hosted by someone else.
function makeTable(overrides: Partial<TableSummary> & { game_state?: SKState } = {}): TableSummary {
    return makeBaseTable({ id: pid("t9"), host_user_id: pid("uOther"), ...overrides });
}


const ME = { isAuthenticated: true, id: "uMe", playerId: pid("p1") };

// The tables page in miniature: the session hook plus the URL-bindings hook.
// The page serves every game — the game is resolved from the bound table, so
// the bindings carry no game id.
function useHarness(me: { isAuthenticated: boolean; id?: string; playerId?: Base58ID }) {
    const s = useTableSession({ me: { id: me.id, playerId: me.playerId } });
    useTableDeepLink({
        hydrated: s.hydrated,
        session: s.session,
        me: { isAuthenticated: me.isAuthenticated, playerId: me.playerId },
        setSession: s.setSession,
        joinTable: s.joinTable,
        resetTableSession: s.resetTableSession,
    });
    return s;
}

function setParams(entries: Record<string, string>) {
    const query = new URLSearchParams(entries).toString();
    window.history.replaceState(null, "", "/matches/table" + (query ? `?${query}` : ""));
}

/** Configures the mocked SSE hook as inert. */
function mockSSE() {
    vi.mocked(useTableSSE).mockImplementation(
        (() => ({ table: null, savedMatchId: null, closed: false, connected: true })) as typeof useTableSSE,
    );
}

/** Flushes the effect-driven async work (fetch + join). */
async function flush() {
    await act(async () => {});
    await act(async () => {});
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setParams({});
    mockSSE();
});

describe("useTableDeepLink", () => {
    it("?id=<table id> joins as a connected player and keeps the id in the URL", async () => {
        setParams({ id: "t9" });
        vi.mocked(getTablePromise).mockResolvedValue(makeTable({ connected_player_ids: [pid("p2")] }));
        vi.mocked(joinTablePromise).mockResolvedValue(makeTable({ connected_player_ids: [pid("p1"), pid("p2")] }));

        const h = renderHook(() => useHarness(ME));
        await flush();

        expect(getTablePromise).toHaveBeenCalledWith(pid("t9"));
        expect(joinTablePromise).toHaveBeenCalledWith(pid("t9"));
        expect(h.current.value.session).toEqual({ tableId: pid("t9"), isHost: false, myPlayerIndex: 0 });
        // The sticky binding: the URL is not cleared after the join.
        expect(location.search).toBe("?id=t9");
    });

    it("a stored host session on the linked table resumes without joining", async () => {
        setParams({ id: "t9" });
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t9"), isHost: true, myPlayerIndex: null }));

        const h = renderHook(() => useHarness(ME));
        await flush();

        expect(getTablePromise).not.toHaveBeenCalled();
        expect(joinTablePromise).not.toHaveBeenCalled();
        expect(h.current.value.session).toEqual({ tableId: pid("t9"), isHost: true, myPlayerIndex: null });
    });

    it("a stored session resumes on the bare page (no params)", async () => {
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: true, myPlayerIndex: null }));

        const h = renderHook(() => useHarness(ME));
        await flush();

        expect(getTablePromise).not.toHaveBeenCalled();
        expect(joinTablePromise).not.toHaveBeenCalled();
        expect(h.current.value.session).toEqual({ tableId: pid("t1"), isHost: true, myPlayerIndex: null });
        expect(location.search).toBe("");
    });

    it("a session on another table is replaced by the linked table", async () => {
        setParams({ id: "t9" });
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("tOld"), isHost: false, myPlayerIndex: 1 }));
        vi.mocked(getTablePromise).mockResolvedValue(makeTable());
        vi.mocked(joinTablePromise).mockResolvedValue(makeTable({ connected_player_ids: [pid("p1")] }));

        const h = renderHook(() => useHarness(ME));
        await flush();

        expect(h.current.value.session).toEqual({ tableId: pid("t9"), isHost: false, myPlayerIndex: 0 });
    });

    it("a visitor who cannot join watches read-only (observer session)", async () => {
        setParams({ id: "t9" });
        vi.mocked(getTablePromise).mockResolvedValue(makeTable());

        const h = renderHook(() => useHarness({ isAuthenticated: false }));
        await flush();

        expect(joinTablePromise).not.toHaveBeenCalled();
        expect(h.current.value.session).toEqual({ tableId: pid("t9"), isHost: false, myPlayerIndex: null });
        expect(h.current.value.awaitingSnapshot).toBe(true);
    });

    it("a table of an unknown game is treated as missing", async () => {
        setParams({ id: "t9" });
        vi.mocked(getTablePromise).mockResolvedValue(makeTable({ game_id: pid("gUnknown") }));

        const h = renderHook(() => useHarness(ME));
        await flush();

        expect(joinTablePromise).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith("Стол не найден или уже завершён");
        expect(location.search).toBe("");
        expect(h.current.value.session).toBeNull();
    });

    it("a missing table toasts, strips the binding, and keeps the untouched session", async () => {
        setParams({ id: "tGone" });
        // This device is sitting on another table; the shared link is dead.
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("tOld"), isHost: false, myPlayerIndex: 0 }));
        vi.mocked(getTablePromise).mockRejectedValue(new Error("404"));

        const h = renderHook(() => useHarness(ME));
        await flush();

        expect(toast.error).toHaveBeenCalledWith("Стол не найден или уже завершён");
        expect(location.search).toBe("");
        // The untouched session (the other table) is kept.
        expect(h.current.value.session).toEqual({ tableId: pid("tOld"), isHost: false, myPlayerIndex: 0 });
    });

    it("a bound observer whose table is gone is reset to the empty state", async () => {
        setParams({ id: "tGone" });
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("tGone"), isHost: false, myPlayerIndex: null }));
        vi.mocked(getTablePromise).mockRejectedValue(new Error("404"));

        const h = renderHook(() => useHarness(ME));
        await flush();

        expect(toast.error).toHaveBeenCalledWith("Стол не найден или уже завершён");
        expect(location.search).toBe("");
        expect(h.current.value.session).toBeNull();
        expect(h.current.value.gameState).toBeNull();
    });
});
