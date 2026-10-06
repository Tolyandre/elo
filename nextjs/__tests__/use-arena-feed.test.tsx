// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// Enable React's act() environment so async state updates don't warn.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { renderHook } from "./render-hook";
import { emitDataChange } from "@/lib/live-data";
import { getArenaFeedPagePromise, getHomeFeedPagePromise, type FeedEvent } from "@/app/api";
import { useArenaFeed } from "@/app/arenas/view/use-arena-feed";
import type { Base58ID } from "@/lib/id";

vi.mock("@/app/api", () => ({
    getArenaFeedPagePromise: vi.fn(),
    getHomeFeedPagePromise: vi.fn(),
}));

const ARENA_ID = "arena-1" as Base58ID;

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
            camps: [],
        },
    };
}

function correctionEvent(id: string): FeedEvent {
    return {
        type: "correction",
        data: { id: id as Base58ID, player_id: "p1" as Base58ID, player_name: "P", diff: 5, date: new Date("2026-01-02T00:00:00Z") },
    };
}

async function flushFetches() {
    await act(async () => {
        for (let i = 0; i < 5; i++) await Promise.resolve();
    });
}

describe("useArenaFeed endpoint selection", () => {
    beforeEach(() => {
        vi.mocked(getArenaFeedPagePromise).mockReset();
        vi.mocked(getHomeFeedPagePromise).mockReset();
        vi.mocked(getArenaFeedPagePromise).mockResolvedValue({ items: [], next: null });
        vi.mocked(getHomeFeedPagePromise).mockResolvedValue({ items: [], next: null });
    });

    it("uses the home feed for the main page and the arena feed for an explicit arena", async () => {
        const { unmount } = renderHook(() => useArenaFeed(true, ARENA_ID, {}));
        await flushFetches();
        expect(getHomeFeedPagePromise).toHaveBeenCalledTimes(1);
        expect(getArenaFeedPagePromise).not.toHaveBeenCalled();
        unmount();

        const { unmount: unmount2 } = renderHook(() => useArenaFeed(false, ARENA_ID, {}));
        await flushFetches();
        expect(getArenaFeedPagePromise).toHaveBeenCalledTimes(1);
        unmount2();
    });

    it("passes filters on page 1 and only the cursor on continuation", async () => {
        vi.mocked(getArenaFeedPagePromise)
            .mockResolvedValueOnce({ items: [matchEvent("m1")], next: "cursor-1" })
            .mockResolvedValueOnce({ items: [correctionEvent("c1")], next: null });

        const { current, unmount } = renderHook(() =>
            useArenaFeed(false, ARENA_ID, { playerId: "p1" as Base58ID }),
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
        vi.mocked(getHomeFeedPagePromise)
            .mockResolvedValueOnce({ items: [matchEvent("m1")], next: "cursor-1" })
            .mockResolvedValueOnce({ items: [matchEvent("m1"), matchEvent("m2")], next: null });

        const { current, unmount } = renderHook(() => useArenaFeed(true, ARENA_ID, {}));
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
        vi.mocked(getHomeFeedPagePromise).mockReset();
        vi.mocked(getArenaFeedPagePromise).mockResolvedValue({ items: [], next: null });
        vi.mocked(getHomeFeedPagePromise).mockResolvedValue({ items: [], next: null });
    });

    it("refetches page 1 when a matches data-change batch arrives", async () => {
        const { current, unmount } = renderHook(() => useArenaFeed(true, ARENA_ID, {}));
        await flushFetches();
        expect(getHomeFeedPagePromise).toHaveBeenCalledTimes(1);
        expect(current.value.loading).toBe(false);

        act(() => emitDataChange({ matches: true, players: false }));
        await flushFetches();

        expect(getHomeFeedPagePromise).toHaveBeenCalledTimes(2);
        expect(current.value.loading).toBe(false);
        unmount();
    });

    it("ignores players-only batches", async () => {
        const { unmount } = renderHook(() => useArenaFeed(true, ARENA_ID, {}));
        await flushFetches();

        act(() => emitDataChange({ matches: false, players: true }));
        await flushFetches();

        expect(getHomeFeedPagePromise).toHaveBeenCalledTimes(1);
        unmount();
    });

    it("exposes invalidate for a direct refresh", async () => {
        const { current, unmount } = renderHook(() => useArenaFeed(true, ARENA_ID, {}));
        await flushFetches();

        act(() => {
            current.value.invalidate();
        });
        await flushFetches();

        expect(getHomeFeedPagePromise).toHaveBeenCalledTimes(2);
        unmount();
    });

    it("unsubscribes on unmount", async () => {
        const { unmount } = renderHook(() => useArenaFeed(true, ARENA_ID, {}));
        await flushFetches();
        unmount();

        act(() => emitDataChange({ matches: true, players: false }));
        await flushFetches();

        expect(getHomeFeedPagePromise).toHaveBeenCalledTimes(1);
    });
});

describe("useArenaFeed loadAll (leaders tab)", () => {
    beforeEach(() => {
        vi.mocked(getArenaFeedPagePromise).mockReset();
        vi.mocked(getHomeFeedPagePromise).mockReset();
    });

    it("drains the cursor keeping only match events", async () => {
        vi.mocked(getHomeFeedPagePromise)
            .mockResolvedValueOnce({ items: [matchEvent("m1")], next: "cursor-1" })
            .mockResolvedValueOnce({ items: [correctionEvent("c1"), matchEvent("m2")], next: "cursor-2" })
            .mockResolvedValueOnce({ items: [], next: null });

        const { current, unmount } = renderHook(() => useArenaFeed(true, ARENA_ID, {}));
        await flushFetches();

        await act(async () => {
            await current.value.loadAll();
        });

        expect(getHomeFeedPagePromise).toHaveBeenLastCalledWith({ next: "cursor-2", limit: 100 });
        expect(current.value.allMatches.map((m) => m.id)).toEqual(["m1", "m2"]);
        expect(current.value.hasMore).toBe(false);
        unmount();
    });
});
