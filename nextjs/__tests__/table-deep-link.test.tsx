// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import type { Base58ID } from "@/lib/id";
import { useTableSession, TABLE_SESSION_KEY } from "@/hooks/useTableSession";
import { useTableDeepLink } from "@/hooks/useTableDeepLink";
import { GAME_ID_SKULL_KING, GAME_ID_IAWW } from "@/lib/game-apps";
import { renderHook } from "./render-hook";
import { getTablePromise, joinTablePromise, type SkullKingGameState, type TableSummary } from "@/app/api";
import { toast } from "sonner";

// The URL the harness page "renders at": tests swap entries between renders.
const mocks = vi.hoisted(() => ({
    params: new Map<string, string>(),
    replace: vi.fn(),
    push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
    useSearchParams: () => ({ get: (key: string) => mocks.params.get(key) ?? null }),
}));

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
    useTablesLobbySSE: vi.fn(() => 0),
}));

vi.mock("sonner", () => ({
    toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { useTableSSE } from "@/hooks/useTableSSE";

const pid = (s: string) => s as Base58ID;

const PAGE_PATH = "/matches/table/skull-king";

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

function makeTable(overrides: Partial<TableSummary> & { game_state?: SKState } = {}): TableSummary {
    return {
        id: pid("t9"),
        game_id: GAME_ID_SKULL_KING,
        host_user_id: pid("uOther"),
        host_client_token: "",
        connected_player_ids: [],
        version: 1,
        created_at: "2026-01-01T00:00:00Z",
        expires_at: "2026-01-02T00:00:00Z",
        game_state: makeState(),
        ...overrides,
    };
}

const initial = makeState("setup");

function isSK(state: unknown): state is SKState {
    return typeof state === "object" && state !== null && "rounds" in state;
}

const ME = { isAuthenticated: true, id: "uMe", playerId: pid("p1") };

function mergeSK(before: SKState, local: SKState, fresh: SKState): SKState {
    const mergeField = <K extends "phase" | "currentRound">(field: K): SKState[K] =>
        local[field] === before[field] ? fresh[field] : local[field];
    return { ...fresh, phase: mergeField("phase"), currentRound: mergeField("currentRound") };
}

// The game page in miniature: the session hook plus the URL-bindings hook.
function useHarness(me: { isAuthenticated: boolean; id?: string; playerId?: Base58ID }) {
    const s = useTableSession<SKState>({
        initial,
        isGameState: isSK,
        me: { id: me.id, playerId: me.playerId },
        mergeStates: mergeSK,
    });
    useTableDeepLink({
        pagePath: PAGE_PATH,
        gameId: GAME_ID_SKULL_KING,
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
    mocks.params = new Map(Object.entries(entries));
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
    it("?new=1 discards the stored session once and strips the param", async () => {
        setParams({ new: "1" });
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t1"), isHost: true, myPlayerIndex: null }));

        const h = renderHook(() => useHarness(ME));

        expect(h.current.value.session).toBeNull();
        expect(h.current.value.gameState.phase).toBe("setup");
        expect(mocks.replace).toHaveBeenCalledWith(PAGE_PATH, { scroll: false });
        expect(getTablePromise).not.toHaveBeenCalled();
        expect(joinTablePromise).not.toHaveBeenCalled();
    });

    it("?table=<id> joins as a connected player and keeps the id in the URL", async () => {
        setParams({ table: "t9" });
        vi.mocked(getTablePromise).mockResolvedValue(makeTable({ connected_player_ids: [pid("p2")] }));
        vi.mocked(joinTablePromise).mockResolvedValue(makeTable({ connected_player_ids: [pid("p1"), pid("p2")] }));

        const h = renderHook(() => useHarness(ME));
        await flush();

        expect(getTablePromise).toHaveBeenCalledWith(pid("t9"));
        expect(joinTablePromise).toHaveBeenCalledWith(pid("t9"));
        expect(h.current.value.session).toEqual({ tableId: pid("t9"), isHost: false, myPlayerIndex: 0 });
        // The sticky binding: the URL is not cleared after the join.
        expect(mocks.replace).not.toHaveBeenCalledWith(PAGE_PATH, { scroll: false });
    });

    it("legacy ?join=<id> works and is normalized to ?table=<id>", async () => {
        setParams({ join: "t9" });
        vi.mocked(getTablePromise).mockResolvedValue(makeTable());
        vi.mocked(joinTablePromise).mockResolvedValue(makeTable({ connected_player_ids: [pid("p1")] }));

        const h = renderHook(() => useHarness(ME));
        await flush();

        expect(joinTablePromise).toHaveBeenCalledWith(pid("t9"));
        expect(h.current.value.session?.tableId).toEqual(pid("t9"));
        expect(mocks.replace).toHaveBeenCalledWith(`${PAGE_PATH}?table=${pid("t9")}`, { scroll: false });
    });

    it("a stored host session on the linked table resumes without joining", async () => {
        setParams({ table: "t9" });
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("t9"), isHost: true, myPlayerIndex: null }));

        const h = renderHook(() => useHarness(ME));
        await flush();

        expect(getTablePromise).not.toHaveBeenCalled();
        expect(joinTablePromise).not.toHaveBeenCalled();
        expect(h.current.value.session).toEqual({ tableId: pid("t9"), isHost: true, myPlayerIndex: null });
    });

    it("a session on another table is replaced by the linked table", async () => {
        setParams({ table: "t9" });
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("tOld"), isHost: false, myPlayerIndex: 1 }));
        vi.mocked(getTablePromise).mockResolvedValue(makeTable());
        vi.mocked(joinTablePromise).mockResolvedValue(makeTable({ connected_player_ids: [pid("p1")] }));

        const h = renderHook(() => useHarness(ME));
        await flush();

        expect(h.current.value.session).toEqual({ tableId: pid("t9"), isHost: false, myPlayerIndex: 0 });
    });

    it("a visitor who cannot join watches read-only (observer session)", async () => {
        setParams({ table: "t9" });
        vi.mocked(getTablePromise).mockResolvedValue(makeTable());

        const h = renderHook(() => useHarness({ isAuthenticated: false }));
        await flush();

        expect(joinTablePromise).not.toHaveBeenCalled();
        expect(h.current.value.session).toEqual({ tableId: pid("t9"), isHost: false, myPlayerIndex: null });
        expect(h.current.value.awaitingSnapshot).toBe(true);
    });

    it("a linked table of another game redirects to that game's page", async () => {
        setParams({ table: "t9" });
        vi.mocked(getTablePromise).mockResolvedValue(makeTable({ game_id: GAME_ID_IAWW }));

        renderHook(() => useHarness(ME));
        await flush();

        expect(joinTablePromise).not.toHaveBeenCalled();
        expect(mocks.replace).toHaveBeenCalledWith(`/matches/table/iaww?table=${pid("t9")}`, { scroll: false });
    });

    it("a missing table toasts, strips the binding, and keeps the untouched session", async () => {
        setParams({ table: "tGone" });
        // This device is sitting on another table; the shared link is dead.
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("tOld"), isHost: false, myPlayerIndex: 0 }));
        vi.mocked(getTablePromise).mockRejectedValue(new Error("404"));

        const h = renderHook(() => useHarness(ME));
        await flush();

        expect(toast.error).toHaveBeenCalledWith("Стол не найден или уже завершён");
        expect(mocks.replace).toHaveBeenCalledWith(PAGE_PATH, { scroll: false });
        // The untouched session (the other table) is kept.
        expect(h.current.value.session).toEqual({ tableId: pid("tOld"), isHost: false, myPlayerIndex: 0 });
    });

    it("a bound observer whose table is gone is reset to the setup screen", async () => {
        setParams({ table: "tGone" });
        localStorage.setItem(TABLE_SESSION_KEY, JSON.stringify({ tableId: pid("tGone"), isHost: false, myPlayerIndex: null }));
        vi.mocked(getTablePromise).mockRejectedValue(new Error("404"));

        const h = renderHook(() => useHarness(ME));
        await flush();

        expect(toast.error).toHaveBeenCalledWith("Стол не найден или уже завершён");
        expect(mocks.replace).toHaveBeenCalledWith(PAGE_PATH, { scroll: false });
        expect(h.current.value.session).toBeNull();
        expect(h.current.value.gameState.phase).toBe("setup");
    });
});
