"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Base58ID } from "@/lib/id";
import {
    Correction,
    Match,
    getArenaMatchesPagePromise,
    getCorrectionsPagePromise,
} from "@/app/api";

export type TimelineItem =
    | { type: "match"; data: Match }
    | { type: "correction"; data: Correction };

export type ArenaMatchFilters = {
    playerId?: Base58ID;
    clubId?: Base58ID;
    gameId?: Base58ID;
};

/**
 * Merges matches and corrections into one newest-first timeline; on the same
 * date the match comes first (it is the earlier user event, ADR-01).
 */
export function mergeTimelineItems(matches: Match[], corrections: Correction[]): TimelineItem[] {
    const result: TimelineItem[] = [];
    let i = 0;
    let j = 0;
    while (i < matches.length && j < corrections.length) {
        const matchDate = matches[i].date?.getTime() ?? 0;
        const correctionDate = corrections[j].date?.getTime() ?? 0;
        if (matchDate >= correctionDate) {
            result.push({ type: "match", data: matches[i++] });
        } else {
            result.push({ type: "correction", data: corrections[j++] });
        }
    }
    while (i < matches.length) result.push({ type: "match", data: matches[i++] });
    while (j < corrections.length) result.push({ type: "correction", data: corrections[j++] });
    return result;
}

/** Drops matches already present (defends against double-append on reload). */
function appendUnique(prev: Match[], next: Match[]): Match[] {
    if (next.length === 0) return prev;
    const seen = new Set(prev.map((m) => m.id));
    const fresh = next.filter((m) => !seen.has(m.id));
    return fresh.length === 0 ? prev : [...prev, ...fresh];
}

/**
 * Cursor-paginated arena match timeline (ADR-24), mirroring the /matches page
 * loader: optional player/club/game filters (the cursor token carries them),
 * lazy "load more", and — for the global arena, whose settlements include
 * corrections — a merged corrections timeline from /corrections.
 *
 * `matches` holds only the lazily loaded pages (the Партии tab); `allMatches`
 * is the full set the leaders tab pulls once via loadAll — kept separate so
 * switching tabs never re-renders hundreds of cards.
 */
export function useArenaMatches(
    arenaId: Base58ID | null,
    filters: ArenaMatchFilters,
    includeCorrections: boolean,
) {
    const [matches, setMatches] = useState<Match[]>([]);
    const [allMatches, setAllMatches] = useState<Match[] | null>(null);
    const [corrections, setCorrections] = useState<Correction[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [matchHasMore, setMatchHasMore] = useState(false);
    const [correctionsHasMore, setCorrectionsHasMore] = useState(false);
    const matchCursorRef = useRef<string | null>(null);
    const correctionCursorRef = useRef<string | null>(null);

    const { playerId, clubId, gameId } = filters;

    // (Re)load page 1 whenever the arena or the filters change.
    useEffect(() => {
        if (!arenaId) return;
        let cancelled = false;
        /* eslint-disable-next-line react-hooks/set-state-in-effect -- reset loading before async fetch */
        setLoading(true);
        matchCursorRef.current = null;
        correctionCursorRef.current = null;

        const matchesPromise = getArenaMatchesPagePromise({
            id: arenaId,
            player_id: playerId,
            club_id: clubId,
            game_id: gameId,
        });
        const correctionsPromise = includeCorrections
            ? getCorrectionsPagePromise({})
            : Promise.resolve({ items: [] as Correction[], next: null });

        Promise.all([matchesPromise, correctionsPromise])
            .then(([matchPage, correctionPage]) => {
                if (cancelled) return;
                matchCursorRef.current = matchPage.next;
                correctionCursorRef.current = correctionPage.next;
                setMatches(matchPage.items);
                setAllMatches(null);
                setCorrections(correctionPage.items);
                setMatchHasMore(matchPage.next !== null);
                setCorrectionsHasMore(correctionPage.next !== null);
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
    }, [arenaId, playerId, clubId, gameId, includeCorrections]);

    const loadMore = useCallback(() => {
        if (loadingMore || !arenaId) return;
        const matchCursor = matchCursorRef.current;
        const correctionCursor = correctionCursorRef.current;
        if (!matchCursor && !correctionCursor) return;

        setLoadingMore(true);

        const matchesPromise = matchCursor
            ? getArenaMatchesPagePromise({ id: arenaId, next: matchCursor })
            : Promise.resolve({ items: [] as Match[], next: null });
        const correctionsPromise =
            includeCorrections && correctionCursor
                ? getCorrectionsPagePromise({ next: correctionCursor })
                : Promise.resolve({ items: [] as Correction[], next: null });

        Promise.all([matchesPromise, correctionsPromise])
            .then(([matchPage, correctionPage]) => {
                if (matchCursor) {
                    matchCursorRef.current = matchPage.next;
                    setMatchHasMore(matchPage.next !== null);
                    setMatches((prev) => appendUnique(prev, matchPage.items));
                }
                if (includeCorrections && correctionCursor) {
                    correctionCursorRef.current = correctionPage.next;
                    setCorrectionsHasMore(correctionPage.next !== null);
                    setCorrections((prev) => {
                        const seen = new Set(prev.map((c) => c.id));
                        return [...prev, ...correctionPage.items.filter((c) => !seen.has(c.id))];
                    });
                }
            })
            .finally(() => setLoadingMore(false));
    }, [arenaId, loadingMore, includeCorrections]);

    // The leaders tab needs the full match set. Accumulates into allMatches
    // (a separate state, seeded from the already loaded pages) so the paginated
    // tab stays small.
    const loadAll = useCallback(async () => {
        if (!arenaId) return;
        setLoadingMore(true);
        try {
            let acc: Match[] | null = null;
            let cursor = matchCursorRef.current;
            while (cursor) {
                const page = await getArenaMatchesPagePromise({ id: arenaId, next: cursor, limit: 100 });
                matchCursorRef.current = page.next;
                setAllMatches((prev) => appendUnique(prev ?? matches, page.items));
                acc = appendUnique(acc ?? matches, page.items);
                cursor = page.next;
            }
            setMatchHasMore(false);
            if (acc) setAllMatches(acc);
        } finally {
            setLoadingMore(false);
        }
    }, [arenaId, matches]);

    // The merged timeline is derived — no extra state needed.
    const items = useMemo(() => mergeTimelineItems(matches, corrections), [matches, corrections]);

    const hasMore = matchHasMore || correctionsHasMore;
    return { items, matches, allMatches: allMatches ?? matches, loading, loadingMore, hasMore, loadMore, loadAll };
}
