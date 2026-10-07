"use client";

import { useMemo } from "react";
import { getRecentPlayersPromise } from "../api";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useMatches } from "@/app/matches/MatchesContext";
import { useMe } from "../meContext";
import { recentCoPlayerIds, RECENT_PLAYERS_LIMIT } from "@/lib/player-groups";
import type { Base58ID } from "@/lib/id";

/**
 * Ids for the player picker's "Недавние" tab.
 *
 * The server computes the list for the signed-in user: players recently played
 * alongside their player or a member of their clubs, players recently created
 * by them or by their club's users (per the audit log), and their own player
 * pinned first — most recent activity (match or creation) first, at most
 * RECENT_PLAYERS_LIMIT entries.
 *
 * It refetches whenever the matches list refreshes (SSE data change, filter
 * change), so a just-submitted match updates the tab. While loading, on error,
 * or when signed out, it falls back to the offline client-side computation:
 * co-players of my own most recent matches.
 */
export function useRecentPlayerIds(): Base58ID[] {
    const { matches } = useMatches();
    const { isAuthenticated, playerId: myPlayerId } = useMe();

    const resource = useAsyncResource(
        () => (isAuthenticated ? getRecentPlayersPromise() : Promise.resolve([])),
        [isAuthenticated, matches],
    );

    const fallback = useMemo(
        () => recentCoPlayerIds(matches, myPlayerId, RECENT_PLAYERS_LIMIT),
        [matches, myPlayerId],
    );

    return useMemo(() => {
        if (resource.data) return resource.data.map((p) => p.id);
        return fallback;
    }, [resource.data, fallback]);
}
