"use client";

import { useCallback, useMemo } from "react";
import { EloWebServiceBaseUrl } from "@/app/api";
import { useMatches } from "@/app/matches/MatchesContext";
import { usePlayers } from "@/app/players/PlayersContext";
import { useSSE } from "@/hooks/useSSE";
import { createDataEventBatcher } from "@/lib/live-data";

/**
 * Invisible app-wide subscriber to the global data-change stream
 * (`GET /data/events`). Whenever any user adds/edits a match, applies a
 * correction or touches players, every open app invalidates its matches and
 * players contexts, so lists and rating values update live.
 *
 * Signals are debounced via createDataEventBatcher: a burst of mutations
 * (e.g. offline sync) collapses into a single refetch.
 */
export function LiveDataSubscriber() {
    const { invalidate: invalidateMatches } = useMatches();
    const { invalidate: invalidatePlayers } = usePlayers();

    const batcher = useMemo(
        () =>
            createDataEventBatcher((batch) => {
                if (batch.matches) invalidateMatches();
                if (batch.players) invalidatePlayers();
            }),
        [invalidateMatches, invalidatePlayers],
    );

    const onEvent = useCallback(
        (event: { type: string }) => {
            batcher.add(event.type);
        },
        [batcher],
    );

    useSSE(`${EloWebServiceBaseUrl}/data/events`, { onEvent });

    return null;
}
