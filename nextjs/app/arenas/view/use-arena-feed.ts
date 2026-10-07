"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Base58ID } from "@/lib/id";
import {
    Match,
    getArenaFeedPagePromise,
    getHomeFeedPagePromise,
    getTenantFeedPagePromise,
    type FeedEvent,
    type FeedPage,
} from "@/app/api";
import { subscribeDataChange } from "@/lib/live-data";
import { useMarketsLobbySSE } from "@/hooks/useMarketsSSE";

export type ArenaMatchFilters = {
    playerId?: Base58ID;
    clubId?: Base58ID;
    gameId?: Base58ID;
};

export type ArenaFeedScope = {
    /** The home feed (GET /feed) — the id-less main page without a tenant (ADR-32). */
    home: boolean;
    /** The arena whose own feed renders (an explicit ?id= view). */
    arenaId: Base58ID | null;
    /** The tenant whose community feed renders (the tenant-mode main page, ADR-36). */
    tenantId: Base58ID | null;
};

/**
 * Drops items already present (defends against double-append on reload).
 */
function appendUnique<T>(prev: T[], next: T[], key: (item: T) => string): T[] {
    if (next.length === 0) return prev;
    const seen = new Set(prev.map(key));
    const fresh = next.filter((item) => !seen.has(key(item)));
    return fresh.length === 0 ? prev : [...prev, ...fresh];
}

function eventKey(e: FeedEvent): string {
    return `${e.type}:${e.data.id}`;
}

/**
 * Cursor-paginated feed loader (ADR-32). The server merges the event stream
 * (matches, and for the global arena corrections and market resolutions), so
 * the client keeps one cursor instead of merging two timelines.
 *
 * The scope selects the source (ADR-36 phase 4): a tenantId renders the
 * tenant's community feed (membership-scoped, the tenant's own markets and
 * coop matches included); `home` selects the home feed (GET /feed); an
 * explicit arena page always renders that arena's own feed, even when it is
 * the global one.
 *
 * `allMatches` is the match-only slice the leaders tab pulls once via loadAll
 * (draining the feed's cursor); it stays separate so switching tabs never
 * re-renders hundreds of cards.
 */
export function useArenaFeed(
    scope: ArenaFeedScope,
    filters: ArenaMatchFilters,
) {
    const { home, arenaId, tenantId } = scope;
    const [events, setEvents] = useState<FeedEvent[]>([]);
    const [allMatches, setAllMatches] = useState<Match[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const cursorRef = useRef<string | null>(null);

    // Live invalidation: the feed must reflect matches recorded elsewhere
    // (SSE "matches-changed") and landed by this device's offline sync — the
    // redirect to the arena races the background POST, so the mount-time
    // fetch is routinely stale. The home and tenant feeds carry markets
    // (ADR-32/36), so a market opening, being locked or settling — the
    // markets-lobby SSE tick — reloads them too; for arena feeds the
    // subscription stays off.
    const [stamp, setStamp] = useState(0);
    const invalidate = useCallback(() => setStamp((s) => s + 1), []);
    const marketsTick = useMarketsLobbySSE(home || tenantId != null);
    useEffect(() => {
        return subscribeDataChange((batch) => {
            if (batch.matches) invalidate();
        });
    }, [invalidate]);

    const { playerId, clubId, gameId } = filters;

    const fetchPage = useCallback(
        (params: { player_id?: Base58ID; club_id?: Base58ID; game_id?: Base58ID; next?: string; limit?: number }): Promise<FeedPage> => {
            if (tenantId) return getTenantFeedPagePromise(tenantId, params);
            return home ? getHomeFeedPagePromise(params) : getArenaFeedPagePromise({ id: arenaId!, ...params });
        },
        [home, arenaId, tenantId],
    );

    // (Re)load page 1 whenever the scope, the filters, the invalidation
    // stamp, or the markets tick change.
    useEffect(() => {
        if (!home && !tenantId && !arenaId) return;
        let cancelled = false;
        /* eslint-disable-next-line react-hooks/set-state-in-effect -- reset loading before async fetch */
        setLoading(true);
        cursorRef.current = null;

        fetchPage({ player_id: playerId, club_id: clubId, game_id: gameId })
            .then((page) => {
                if (cancelled) return;
                cursorRef.current = page.next;
                setEvents(page.items);
                setAllMatches(null);
                setHasMore(page.next !== null);
            })
            .catch(() => {
                // toast shown by API helper
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [home, arenaId, tenantId, playerId, clubId, gameId, stamp, marketsTick, fetchPage]);

    const loadMore = useCallback(() => {
        if (loadingMore || (!home && !tenantId && !arenaId)) return;
        const cursor = cursorRef.current;
        if (!cursor) return;

        setLoadingMore(true);
        fetchPage({ next: cursor })
            .then((page) => {
                cursorRef.current = page.next;
                setHasMore(page.next !== null);
                setEvents((prev) => appendUnique(prev, page.items, eventKey));
            })
            .finally(() => setLoadingMore(false));
    }, [loadingMore, home, arenaId, tenantId, fetchPage]);

    // The leaders tab needs the full match set. Drains the feed's cursor,
    // keeping only match events, into allMatches (a separate state, seeded
    // from the already loaded pages).
    const matchEvents = useMemo(
        () => events.filter((e): e is Extract<FeedEvent, { type: "match" }> => e.type === "match"),
        [events],
    );

    const loadAll = useCallback(async () => {
        if (!home && !tenantId && !arenaId) return;
        setLoadingMore(true);
        try {
            let acc: Match[] = matchEvents.map((e) => e.data);
            let cursor = cursorRef.current;
            while (cursor) {
                const page = await fetchPage({ next: cursor, limit: 100 });
                cursorRef.current = page.next;
                acc = appendUnique(
                    acc,
                    page.items
                        .filter((e): e is Extract<FeedEvent, { type: "match" }> => e.type === "match")
                        .map((e) => e.data),
                    (m) => m.id,
                );
                setAllMatches(acc);
                cursor = page.next;
            }
            setHasMore(false);
        } finally {
            setLoadingMore(false);
        }
    }, [home, arenaId, tenantId, matchEvents, fetchPage]);

    return {
        events,
        matches: matchEvents.map((e) => e.data),
        allMatches: allMatches ?? matchEvents.map((e) => e.data),
        loading,
        loadingMore,
        hasMore,
        loadMore,
        loadAll,
        invalidate,
    };
}
