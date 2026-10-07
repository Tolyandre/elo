// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderHook } from "./render-hook";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Shared mutable state the module mocks read from on every render.
const state = vi.hoisted(() => ({
    matches: [] as { date: string; score: Record<string, unknown> }[],
    isAuthenticated: false,
    playerId: undefined as string | undefined,
    getRecent: vi.fn<() => Promise<{ id: string; name: string }[]>>(),
}));

vi.mock("../app/api", () => ({
    getRecentPlayersPromise: () => state.getRecent(),
}));
vi.mock("../app/matches/MatchesContext", () => ({
    useMatches: () => ({ matches: state.matches }),
}));
vi.mock("../app/meContext", () => ({
    useMe: () => ({ isAuthenticated: state.isAuthenticated, playerId: state.playerId }),
}));

import { useRecentPlayerIds } from "../app/players/useRecentPlayerIds";

beforeEach(() => {
    state.getRecent.mockReset();
});

const myMatch = (date: string, ids: string[]) => ({ date, score: Object.fromEntries(ids.map((id) => [id, {}])) });

describe("useRecentPlayerIds", () => {
    it("falls back to my own co-players while the server request is pending", async () => {
        state.isAuthenticated = true;
        state.playerId = "me";
        state.matches = [myMatch("2026-01-01", ["me", "p1", "p2"])];
        state.getRecent.mockReturnValue(new Promise(() => {})); // never settles

        const { current } = renderHook(() => useRecentPlayerIds());
        expect(current.value).toEqual(["me", "p1", "p2"]);
        expect(state.getRecent).toHaveBeenCalledTimes(1);
    });

    it("uses the server list once loaded", async () => {
        state.isAuthenticated = true;
        state.playerId = "me";
        state.matches = [myMatch("2026-01-01", ["me", "p1"])];
        state.getRecent.mockResolvedValue([
            { id: "s1", name: "Server One" },
            { id: "s2", name: "Server Two" },
        ]);

        const { current } = renderHook(() => useRecentPlayerIds());
        await act(async () => {});
        expect(current.value).toEqual(["s1", "s2"]);
    });

    it("falls back to my own co-players when the server request fails", async () => {
        state.isAuthenticated = true;
        state.playerId = "me";
        state.matches = [myMatch("2026-01-01", ["me", "p1"])];
        state.getRecent.mockRejectedValue(new Error("offline"));

        const { current } = renderHook(() => useRecentPlayerIds());
        await act(async () => {});
        expect(current.value).toEqual(["me", "p1"]);
    });

    it("does not request the server list when signed out", async () => {
        state.isAuthenticated = false;
        state.playerId = undefined;
        state.matches = [myMatch("2026-01-01", ["a", "b"])];
        state.getRecent.mockResolvedValue([]);

        const { current } = renderHook(() => useRecentPlayerIds());
        await act(async () => {});
        expect(state.getRecent).not.toHaveBeenCalled();
        expect(current.value).toEqual([]);
    });

    it("refetches when the matches list refreshes", async () => {
        state.isAuthenticated = true;
        state.playerId = "me";
        state.matches = [myMatch("2026-01-01", ["me", "p1"])];
        state.getRecent.mockResolvedValue([{ id: "s1", name: "Server One" }]);

        const { current, rerender } = renderHook(() => useRecentPlayerIds());
        await act(async () => {});
        expect(current.value).toEqual(["s1"]);

        // A fresh matches array (SSE data change / filter change) triggers a refetch.
        state.matches = [myMatch("2026-01-02", ["me", "p9"])];
        state.getRecent.mockResolvedValue([{ id: "s2", name: "Fresh" }]);
        await act(async () => {
            rerender(() => useRecentPlayerIds());
        });
        expect(state.getRecent).toHaveBeenCalledTimes(2);
        expect(current.value).toEqual(["s2"]);
    });
});
