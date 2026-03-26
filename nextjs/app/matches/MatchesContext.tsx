"use client"

import { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from "react";
import { getMatchesPagePromise, Match } from "../api";

type Filters = {
  playerId?: string;
  gameId?: string;
  clubId?: string | null;
};

type MatchesState = {
  matches: Match[];
  loading: boolean;       // true during initial/reset load
  loadingMore: boolean;   // true while fetching additional pages
  error: string | null;
  hasMore: boolean;
  filters: Filters;
  setFilters: (f: Filters) => void;
  loadMore: () => void;
  invalidate: () => void;
};

const MatchesContext = createContext<MatchesState | undefined>(undefined);

export const MatchesProvider = ({ children }: { children: ReactNode }) => {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [filters, setFiltersState] = useState<Filters>({});

  // Internal cursor state — not exposed to consumers
  const nextCursorRef = useRef<string | null>(null);
  // Stamp triggers re-fetch from page 1
  const [stamp, setStamp] = useState(0);

  // Load page 1 whenever filters or stamp change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    nextCursorRef.current = null;

    getMatchesPagePromise({
      player_id: filters.playerId,
      game_id: filters.gameId,
      club_id: filters.clubId ?? undefined,
    })
      .then(page => {
        if (cancelled) return;
        nextCursorRef.current = page.next;
        setMatches(page.items);
        setHasMore(page.next !== null);
      })
      .catch(e => {
        if (cancelled) return;
        setError(e.message ?? "Неизвестная ошибка");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, stamp]);

  const loadMore = useCallback(() => {
    if (!nextCursorRef.current || loadingMore) return;
    const cursor = nextCursorRef.current;
    setLoadingMore(true);

    getMatchesPagePromise({ next: cursor })
      .then(page => {
        nextCursorRef.current = page.next;
        setMatches(prev => [...prev, ...page.items]);
        setHasMore(page.next !== null);
      })
      .catch(e => {
        setError(e.message ?? "Неизвестная ошибка");
      })
      .finally(() => {
        setLoadingMore(false);
      });
  }, [loadingMore]);

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
      matches,
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
