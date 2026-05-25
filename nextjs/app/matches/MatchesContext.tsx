"use client"

import { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from "react";
import { getMatchesPagePromise, getCorrectionsPagePromise, Match, Correction } from "../api";

export type TimelineItem =
    | { type: "match"; data: Match }
    | { type: "correction"; data: Correction };

type Filters = {
  playerId?: string;
  gameId?: string;
  clubId?: string | null;
};

type MatchesState = {
  items: TimelineItem[];
  matches: Match[];  // match-only slice, for components that only need matches (e.g. recent-games logic)
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  filters: Filters;
  setFilters: (f: Filters) => void;
  loadMore: () => void;
  invalidate: () => void;
};

const MatchesContext = createContext<MatchesState | undefined>(undefined);

function mergeTimeline(matches: Match[], corrections: Correction[]): TimelineItem[] {
  const result: TimelineItem[] = [];
  let i = 0, j = 0;
  while (i < matches.length && j < corrections.length) {
    const aDate = matches[i].date?.getTime() ?? 0;
    const bDate = corrections[j].date?.getTime() ?? 0;
    if (aDate >= bDate) {
      result.push({ type: "match", data: matches[i++] });
    } else {
      result.push({ type: "correction", data: corrections[j++] });
    }
  }
  while (i < matches.length) result.push({ type: "match", data: matches[i++] });
  while (j < corrections.length) result.push({ type: "correction", data: corrections[j++] });
  return result;
}

export const MatchesProvider = ({ children }: { children: ReactNode }) => {
  const [allMatches, setAllMatches] = useState<Match[]>([]);
  const [allCorrections, setAllCorrections] = useState<Correction[]>([]);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchHasMore, setMatchHasMore] = useState(false);
  const [correctionsHasMore, setCorrectionsHasMore] = useState(false);
  const [filters, setFiltersState] = useState<Filters>({});

  const matchCursorRef = useRef<string | null>(null);
  const correctionCursorRef = useRef<string | null>(null);
  const [stamp, setStamp] = useState(0);

  const hasMore = matchHasMore || (!filters.gameId && correctionsHasMore);

  // Load page 1 whenever filters or stamp change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    matchCursorRef.current = null;
    correctionCursorRef.current = null;

    const matchesPromise = getMatchesPagePromise({
      player_id: filters.playerId,
      game_id: filters.gameId,
      club_id: filters.clubId ?? undefined,
    });

    const correctionsPromise = filters.gameId
      ? Promise.resolve({ items: [], next: null })
      : getCorrectionsPagePromise({
          player_id: filters.playerId,
          club_id: filters.clubId ?? undefined,
        });

    Promise.all([matchesPromise, correctionsPromise])
      .then(([matchPage, correctionPage]) => {
        if (cancelled) return;
        matchCursorRef.current = matchPage.next;
        correctionCursorRef.current = correctionPage.next;
        setAllMatches(matchPage.items);
        setAllCorrections(correctionPage.items);
        setItems(mergeTimeline(matchPage.items, correctionPage.items));
        setMatchHasMore(matchPage.next !== null);
        setCorrectionsHasMore(correctionPage.next !== null);
      })
      .catch(e => {
        if (cancelled) return;
        setError((e as Error).message ?? "Неизвестная ошибка");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, stamp]);

  const loadMore = useCallback(() => {
    if (loadingMore) return;
    const matchCursor = matchCursorRef.current;
    const correctionCursor = correctionCursorRef.current;
    if (!matchCursor && !correctionCursor) return;

    setLoadingMore(true);

    const matchesPromise = matchCursor
      ? getMatchesPagePromise({ next: matchCursor })
      : Promise.resolve({ items: [] as Match[], next: null });

    const correctionsPromise = (!filters.gameId && correctionCursor)
      ? getCorrectionsPagePromise({ next: correctionCursor })
      : Promise.resolve({ items: [] as Correction[], next: null });

    Promise.all([matchesPromise, correctionsPromise])
      .then(([matchPage, correctionPage]) => {
        if (matchCursor) {
          matchCursorRef.current = matchPage.next;
          setMatchHasMore(matchPage.next !== null);
        }
        if (!filters.gameId && correctionCursor) {
          correctionCursorRef.current = correctionPage.next;
          setCorrectionsHasMore(correctionPage.next !== null);
        }
        setAllMatches(prev => {
          const newMatches = [...prev, ...matchPage.items];
          setAllCorrections(prevC => {
            const newCorrections = [...prevC, ...correctionPage.items];
            setItems(mergeTimeline(newMatches, newCorrections));
            return newCorrections;
          });
          return newMatches;
        });
      })
      .catch(e => {
        setError((e as Error).message ?? "Неизвестная ошибка");
      })
      .finally(() => {
        setLoadingMore(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingMore, filters.gameId]);

  const setFilters = useCallback((f: Filters) => {
    setFiltersState(prev =>
      prev.playerId === f.playerId && prev.gameId === f.gameId && prev.clubId === f.clubId ? prev : f
    );
  }, []);

  const invalidate = useCallback(() => {
    setStamp(s => s + 1);
  }, []);

  return (
    <MatchesContext.Provider value={{
      items,
      matches: allMatches,
      loading,
      loadingMore,
      error,
      hasMore,
      filters,
      setFilters,
      loadMore,
      invalidate,
    }}>
      {children}
    </MatchesContext.Provider>
  );
};

export const useMatches = () => {
  const ctx = useContext(MatchesContext);
  if (!ctx) {
    throw new Error("useMatches must be used within a MatchesProvider");
  }
  return ctx;
};
