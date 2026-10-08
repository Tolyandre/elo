// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// Enable React's act() environment so async state updates don't warn.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { renderHook } from "./render-hook";
import { emitDataChange } from "@/lib/live-data";
import { getArenaFeedPagePromise, getTenantFeedPagePromise, type FeedEvent, type Market } from "@/app/api";
import { useArenaFeed } from "@/app/arenas/view/use-arena-feed";
import type { Base58ID } from "@/lib/id";

vi.mock("@/app/api", () => ({
    getArenaFeedPagePromise: vi.fn(),
    getTenantFeedPagePromise: vi.fn(),
}));

// The markets-lobby SSE subscription stays mocked out: the tests assert fetch
// behavior, not the connection. The mock honors `enabled` like the real hook
// (a disabled subscription never ticks), and tests drive the tick value.
const marketsSSE = vi.hoisted(() => ({ tick: 0 }));
vi.mock("@/hooks/useMarketsSSE", () => ({
    useMarketsLobbySSE: vi.fn((enabled: boolean) => (enabled ? marketsSSE.tick : 0)),
}));

const ARENA_ID = "arena-1" as Base58ID;
const TENANT_ID = "tenant-1" as Base58ID;

// The two scopes most tests exercise: the tenant-mode main page (community
// feed) and an explicit arena's own feed.
const tenantScope = { arenaId: ARENA_ID, tenantId: TENANT_ID as Base58ID | null };
const arenaScope = { arenaId: ARENA_ID, tenantId: null as Base58ID | null };

function matchEvent(id: string): FeedEvent {
    return {
        type: "match",
        data: {
            id: id as Base58ID,
            game_id: "g1" as Base58ID,
            game_name: "Game",
            date: new Date("2026-01-01T00:00:0Z"),
            dateISO: "2026-01-01T00:00:00Z",
            score: {},
            has_markets: false,
            mode: "competitive",
            game_score: null,
            game_won: null,
            camps: [],
        },
    };
}

function marketEvent(id: string): FeedEvent {
    // loadAll keeps only match events; the market payload's shape beyond the
    // id is irrelevant to that filter.
    return { type: "market", data: { id: id as Base58ID } as unknown as Market };
}

async function flushFetches() {
    await act(async () => {
        for (let i = 0; i < 5; i++) await Promise.resolve();
    });
}

describe("useArenaFeed endpoint selection", () => {
    beforeEach(() => {
        vi.mocked(getArenaFeedPagePromise).mockReset();
        vi.mocked(getTenantFeedPagePromise).mockReset();
        vi.mocked(getArenaFeedPagePromise).mockResolvedValue({ items: [], next: null });
        vi.mocked(getTenantFeedPagePromise).mockResolvedValue({ items: [], next: null });
        marketsSSE.tick = 0;
    });

    it("uses the arena feed for an explicit arena", async () => {
        const { unmount } = renderHook(() => useArenaFeed(arenaScope, {}));
        await flushFetches();
        expect(getArenaFeedPagePromise).toHaveBeenCalledTimes(1);
        expect(getTenantFeedPagePromise).not.toHaveBeenCalled();
        unmount();
    });

    it("uses the tenant community feed for the tenant-mode main page (ADR-36)", async () => {
        const { unmount } = renderHook(() =>
            useArenaFeed(tenantScope, { clubId: "c1" as Base58ID }),
        );
        await flushFetches();
        expect(getTenantFeedPagePromise).toHaveBeenCalledWith(TENANT_ID, { club_id: "c1" });
        expect(getArenaFeedPagePromise).not.toHaveBeenCalled();
        unmount();
    });

    it("continues the tenant feed with the cursor only", async () => {
        vi.mocked(getTenantFeedPagePromise)
            .mockResolvedValueOnce({ items: [matchEvent("m1")], next: "tcursor-1" })
            .mockResolvedValueOnce({ items: [], next: null });

        const { current, unmount } = renderHook(() => useArenaFeed(tenantScope, {}));
        await flushFetches();
        act(() => {
            current.value.loadMore();
        });
        await flushFetches();
        expect(getTenantFeedPagePromise).toHaveBeenLastCalledWith(TENANT_ID, { next: "tcursor-1" });
        expect(current.value.events.map((e) => e.data.id)).toEqual(["m1"]);
        unmount();
    });

    it("passes filters on page 1 and only the cursor on continuation", async () => {
        vi.mocked(getArenaFeedPagePromise)
            .mockResolvedValueOnce({ items: [matchEvent("m1")], next: "cursor-1" })
            .mockResolvedValueOnce({ items: [marketEvent("c1")], next: null });

        const { current, unmount } = renderHook(() =>
            useArenaFeed(arenaScope, { playerId: "p1" as Base58ID }),
        );
        await flushFetches();
        expect(getArenaFeedPagePromise).toHaveBeenCalledWith({
            id: ARENA_ID,
            player_id: "p1",
        });
        expect(current.value.events.map((e) => e.data.id)).toEqual(["m1"]);

        act(() => {
            current.value.loadMore();
        });
        await flushFetches();
        expect(getArenaFeedPagePromise).toHaveBeenLastCalledWith({
            id: ARENA_ID,
            next: "cursor-1",
        });
        expect(current.value.events.map((e) => e.data.id)).toEqual(["m1", "c1"]);
        expect(current.value.hasMore).toBe(false);
        unmount();
    });

    it("deduplicates events on continuation", async () => {
        vi.mocked(getTenantFeedPagePromise)
            .mockResolvedValueOnce({ items: [matchEvent("m1")], next: "cursor-1" })
            .mockResolvedValueOnce({ items: [matchEvent("m1"), matchEvent("m2")], next: null });

        const { current, unmount } = renderHook(() => useArenaFeed(tenantScope, {}));
        await flushFetches();
        act(() => {
            current.value.loadMore();
        });
        await flushFetches();
        expect(current.value.events.map((e) => e.data.id)).toEqual(["m1", "m2"]);
        unmount();
    });
});

describe("useArenaFeed live invalidation", () => {
    beforeEach(() => {
        vi.mocked(getArenaFeedPagePromise).mockReset();
        vi.mocked(getTenantFeedPagePromise).mockReset();
        vi.mocked(getArenaFeedPagePromise).mockResolvedValue({ items: [], next: null });
        vi.mocked(getTenantFeedPagePromise).mockResolvedValue({ items: [], next: null });
        marketsSSE.tick = 0;
    });

    it("refetches page 1 when a matches data-change batch arrives", async () => {
        const { current, unmount } = renderHook(() => useArenaFeed(tenantScope, {}));
        await flushFetches();
        expect(getTenantFeedPagePromise).toHaveBeenCalledTimes(1);
        expect(current.value.loading).toBe(false);

        act(() => emitDataChange({ matches: true, players: false, arenas: false }));
        await flushFetches();

        expect(getTenantFeedPagePromise).toHaveBeenCalledTimes(2);
        expect(current.value.loading).toBe(false);
        unmount();
    });

    it("refetches the tenant feed on a markets tick, but never the arena feed", async () => {
        const { rerender, unmount } = renderHook(() => useArenaFeed(tenantScope, {}));
        await flushFetches();
        expect(getTenantFeedPagePromise).toHaveBeenCalledTimes(1);

        marketsSSE.tick = 1;
        rerender(() => useArenaFeed(tenantScope, {}));
        await flushFetches();
        expect(getTenantFeedPagePromise).toHaveBeenCalledTimes(2);
        unmount();

        const { rerender: rerenderArena, unmount: unmountArena } = renderHook(() =>
            useArenaFeed(arenaScope, {}),
        );
        await flushFetches();
        expect(getArenaFeedPagePromise).toHaveBeenCalledTimes(1);

        marketsSSE.tick = 2;
        rerenderArena(() => useArenaFeed(arenaScope, {}));
        await flushFetches();
        expect(getArenaFeedPagePromise).toHaveBeenCalledTimes(1);
        unmountArena();
    });

    it("ignores players-only batches", async () => {
        const { unmount } = renderHook(() => useArenaFeed(tenantScope, {}));
        await flushFetches();

        act(() => emitDataChange({ matches: false, players: true, arenas: false }));
        await flushFetches();

        expect(getTenantFeedPagePromise).toHaveBeenCalledTimes(1);
        unmount();
    });

    it("exposes invalidate for a direct refresh", async () => {
        const { current, unmount } = renderHook(() => useArenaFeed(tenantScope, {}));
        await flushFetches();

        act(() => {
            current.value.invalidate();
        });
        await flushFetches();

        expect(getTenantFeedPagePromise).toHaveBeenCalledTimes(2);
        unmount();
    });

    it("unsubscribes on unmount", async () => {
        const { unmount } = renderHook(() => useArenaFeed(tenantScope, {}));
        await flushFetches();
        unmount();

        act(() => emitDataChange({ matches: true, players: false, arenas: false }));
        await flushFetches();

        expect(getTenantFeedPagePromise).toHaveBeenCalledTimes(1);
    });
});

describe("useArenaFeed loadAll (leaders tab)", () => {
    beforeEach(() => {
        vi.mocked(getArenaFeedPagePromise).mockReset();
        vi.mocked(getTenantFeedPagePromise).mockReset();
        marketsSSE.tick = 0;
    });

    it("drains the cursor keeping only match events", async () => {
        vi.mocked(getTenantFeedPagePromise)
            .mockResolvedValueOnce({ items: [matchEvent("m1")], next: "cursor-1" })
            .mockResolvedValueOnce({ items: [marketEvent("c1"), matchEvent("m2")], next: "cursor-2" })
            .mockResolvedValueOnce({ items: [], next: null });

        const { current, unmount } = renderHook(() => useArenaFeed(tenantScope, {}));
        await flushFetches();

        await act(async () => {
            await current.value.loadAll();
        });

        expect(getTenantFeedPagePromise).toHaveBeenLastCalledWith(TENANT_ID, { next: "cursor-2", limit: 100 });
        expect(current.value.allMatches.map((m) => m.id)).toEqual(["m1", "m2"]);
        expect(current.value.hasMore).toBe(false);
        unmount();
    });
});
