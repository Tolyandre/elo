// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// Enable React's act() environment so async state updates don't warn.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { renderHook } from "./render-hook";
import { emitDataChange } from "@/lib/live-data";
import { getArenaMatchesPagePromise, getCorrectionsPagePromise } from "@/app/api";
import { useArenaMatches } from "@/app/arenas/view/use-arena-matches";
import type { Base58ID } from "@/lib/id";

vi.mock("@/app/api", () => ({
    getArenaMatchesPagePromise: vi.fn(),
    getCorrectionsPagePromise: vi.fn(),
}));

const ARENA_ID = "arena-1" as Base58ID;

async function flushFetches() {
    await act(async () => {
        for (let i = 0; i < 5; i++) await Promise.resolve();
    });
}

describe("useArenaMatches live invalidation", () => {
    beforeEach(() => {
        vi.mocked(getArenaMatchesPagePromise).mockReset();
        vi.mocked(getCorrectionsPagePromise).mockReset();
        vi.mocked(getArenaMatchesPagePromise).mockResolvedValue({ items: [], next: null });
        vi.mocked(getCorrectionsPagePromise).mockResolvedValue({ items: [], next: null });
    });

    it("refetches page 1 when a matches data-change batch arrives", async () => {
        const { current, unmount } = renderHook(() => useArenaMatches(ARENA_ID, {}, false));
        await flushFetches();
        expect(getArenaMatchesPagePromise).toHaveBeenCalledTimes(1);
        expect(current.value.loading).toBe(false);

        act(() => emitDataChange({ matches: true, players: false }));
        await flushFetches();

        expect(getArenaMatchesPagePromise).toHaveBeenCalledTimes(2);
        expect(current.value.loading).toBe(false);
        unmount();
    });

    it("ignores players-only batches", async () => {
        const { unmount } = renderHook(() => useArenaMatches(ARENA_ID, {}, false));
        await flushFetches();

        act(() => emitDataChange({ matches: false, players: true }));
        await flushFetches();

        expect(getArenaMatchesPagePromise).toHaveBeenCalledTimes(1);
        unmount();
    });

    it("exposes invalidate for a direct refresh", async () => {
        const { current, unmount } = renderHook(() => useArenaMatches(ARENA_ID, {}, false));
        await flushFetches();

        act(() => {
            current.value.invalidate();
        });
        await flushFetches();

        expect(getArenaMatchesPagePromise).toHaveBeenCalledTimes(2);
        unmount();
    });

    it("unsubscribes on unmount", async () => {
        const { unmount } = renderHook(() => useArenaMatches(ARENA_ID, {}, false));
        await flushFetches();
        unmount();

        act(() => emitDataChange({ matches: true, players: false }));
        await flushFetches();

        expect(getArenaMatchesPagePromise).toHaveBeenCalledTimes(1);
    });
});
