"use client";

import { useMemo } from "react";
import { getFavoriteGamesPromise, type FavoriteGames } from "./api";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useMatches } from "@/app/matches/MatchesContext";
import { useMe } from "./meContext";
import { useGames } from "./gamesContext";
import { clientFavoriteGameIds, FAVORITE_GAMES_LIMIT, type FavoriteGameIds } from "@/lib/game-groups";

/**
 * The game picker's «Избранные» sections for the signed-in user.
 *
 * The server computes them: «Недавние» — games recently played by the user's
 * player or a member of their clubs (most recent match first); «Популярные» —
 * games most played among their clubs (globally when they have no club).
 *
 * It refetches whenever the matches list refreshes (SSE data change, filter
 * change), so a just-submitted match updates the tab. While loading, on error,
 * or when signed out, it falls back to the offline client-side computation:
 * the current player's own most recent games plus the globally most played.
 */
export function useFavoriteGames(): FavoriteGameIds {
    const { matches } = useMatches();
    const { games } = useGames();
    const { isAuthenticated, playerId } = useMe();

    const resource = useAsyncResource(
        (): Promise<FavoriteGames> => (isAuthenticated ? getFavoriteGamesPromise() : Promise.resolve({ recent: [], popular: [] })),
        [isAuthenticated, matches],
    );

    const fallback = useMemo(
        () => clientFavoriteGameIds(games, matches, playerId, FAVORITE_GAMES_LIMIT),
        [games, matches, playerId],
    );

    return useMemo(() => {
        if (resource.data) {
            return {
                recent: resource.data.recent.map((g) => g.id),
                popular: resource.data.popular.map((g) => g.id),
            };
        }
        return fallback;
    }, [resource.data, fallback]);
}
