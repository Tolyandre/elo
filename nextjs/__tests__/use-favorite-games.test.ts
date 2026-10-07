// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderHook } from "./render-hook";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Shared mutable state the module mocks read from on every render.
const state = vi.hoisted(() => ({
    games: [] as { id: string; name: string; total_matches: number; last_played_order: number }[],
    matches: [] as { date: string; game_id: string; score: Record<string, unknown> }[],
    isAuthenticated: false,
    playerId: undefined as string | undefined,
    getFavorites: vi.fn<() => Promise<{ recent: { id: string; recent_at: string }[]; popular: { id: string; match_count: number }[] }>>(),
}));

vi.mock("../app/api", () => ({
    getFavoriteGamesPromise: () => state.getFavorites(),
}));
vi.mock("../app/matches/MatchesContext", () => ({
    useMatches: () => ({ matches: state.matches }),
}));
vi.mock("../app/meContext", () => ({
    useMe: () => ({ isAuthenticated: state.isAuthenticated, playerId: state.playerId }),
}));
vi.mock("../app/gamesContext", () => ({
    useGames: () => ({ games: state.games }),
}));

import { useFavoriteGames } from "../app/useFavoriteGames";

beforeEach(() => {
    state.getFavorites.mockReset();
});

const myMatch = (gameId: string) => ({ date: "2026-01-01", game_id: gameId, score: { me: 10, p1: 5 } });
const game = (id: string, totalMatches = 0) => ({ id, name: id, total_matches: totalMatches, last_played_order: 0 });

describe("useFavoriteGames", () => {
    it("falls back to my own recent games while the server request is pending", async () => {
        state.isAuthenticated = true;
        state.playerId = "me";
        state.games = [game("g1", 5), game("g2", 1)];
        state.matches = [myMatch("g1")];
        state.getFavorites.mockReturnValue(new Promise(() => {})); // never settles

        const { current } = renderHook(() => useFavoriteGames());
        expect(current.value).toEqual({ recent: ["g1"], popular: ["g2"] });
        expect(state.getFavorites).toHaveBeenCalledTimes(1);
    });

    it("uses the server sections once loaded", async () => {
        state.isAuthenticated = true;
        state.playerId = "me";
        state.matches = [myMatch("g1")];
        state.getFavorites.mockResolvedValue({
            recent: [{ id: "s1", recent_at: "2026-01-01T00:00:00Z" }],
            popular: [{ id: "s2", match_count: 3 }],
        });

        const { current } = renderHook(() => useFavoriteGames());
        await act(async () => {});
        expect(current.value).toEqual({ recent: ["s1"], popular: ["s2"] });
    });

    it("falls back when the server request fails", async () => {
        state.isAuthenticated = true;
        state.playerId = "me";
        state.games = [game("g1", 5)];
        state.matches = [myMatch("g1")];
        state.getFavorites.mockRejectedValue(new Error("offline"));

        const { current } = renderHook(() => useFavoriteGames());
        await act(async () => {});
        expect(current.value).toEqual({ recent: ["g1"], popular: [] });
    });

    it("does not request the server list when signed out", async () => {
        state.isAuthenticated = false;
        state.playerId = undefined;
        state.matches = [myMatch("g1")];
        state.getFavorites.mockResolvedValue({ recent: [], popular: [] });

        const { current } = renderHook(() => useFavoriteGames());
        await act(async () => {});
        expect(state.getFavorites).not.toHaveBeenCalled();
        expect(current.value).toEqual({ recent: [], popular: [] });
    });

    it("refetches when the matches list refreshes", async () => {
        state.isAuthenticated = true;
        state.playerId = "me";
        state.matches = [myMatch("g1")];
        state.getFavorites.mockResolvedValue({ recent: [{ id: "s1", recent_at: "2026-01-01T00:00:00Z" }], popular: [] });

        const { current, rerender } = renderHook(() => useFavoriteGames());
        await act(async () => {});
        expect(current.value).toEqual({ recent: ["s1"], popular: [] });

        // A fresh matches array (SSE data change / filter change) triggers a refetch.
        state.matches = [myMatch("g9")];
        state.getFavorites.mockResolvedValue({ recent: [{ id: "s2", recent_at: "2026-01-02T00:00:00Z" }], popular: [] });
        await act(async () => {
            rerender(() => useFavoriteGames());
        });
        expect(state.getFavorites).toHaveBeenCalledTimes(2);
        expect(current.value).toEqual({ recent: ["s2"], popular: [] });
    });
});
