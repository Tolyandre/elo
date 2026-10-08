"use client"

import { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from "react";
import { getMatchesPagePromise, Match } from "../api";
import { useTenantScope } from "../tenantScopeContext";
import type { Base58ID } from "@/lib/id";

type Filters = {
  playerId?: Base58ID;
  gameId?: Base58ID;
  clubId?: Base58ID | null;
};

type MatchesState = {
  matches: Match[];
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

export const MatchesProvider = ({ children }: { children: ReactNode }) => {
  const [allMatches, setAllMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchHasMore, setMatchHasMore] = useState(false);
  const [filters, setFiltersState] = useState<Filters>({});

  // The settlement columns (rating staked/earned/after) are scoped to the
  // current tenant's main arena (ADR-36) — the match set itself is global.
  // The fetch waits for the tenant scope to settle so the cache never mixes
  // arenas; pickers and lists that ignore the columns only see a refetch.
  const { tenantId, ready: tenantScopeReady } = useTenantScope();

  const matchCursorRef = useRef<string | null>(null);
  const [stamp, setStamp] = useState(0);

  const hasMore = matchHasMore;

  // Load page 1 whenever filters, the tenant scope, or the stamp change
  useEffect(() => {
    // Hold loading until the tenant scope settles AND resolves — the list read
    // is tenant-required (ADR-36 phase 5); an unresolved scope shows the
    // prompt instead of loading.
    if (!tenantScopeReady || !tenantId) return;
    let cancelled = false;
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- reset loading/error before async fetch */
    setLoading(true);
    setError(null);
    matchCursorRef.current = null;

    getMatchesPagePromise({
      player_id: filters.playerId,
      game_id: filters.gameId,
      club_id: filters.clubId ?? undefined,
      tenant: tenantId,
    })
      .then((matchPage) => {
        if (cancelled) return;
        matchCursorRef.current = matchPage.next;
        setAllMatches(matchPage.items);
        setMatchHasMore(matchPage.next !== null);
      })
      .catch(e => {
        if (cancelled) return;
        setError((e as Error).message ?? "Неизвестная ошибка");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };

  }, [filters, stamp, tenantScopeReady, tenantId]);

  const loadMore = useCallback(() => {
    if (loadingMore || !tenantScopeReady || !tenantId) return;
    const matchCursor = matchCursorRef.current;
    if (!matchCursor) return;

    setLoadingMore(true);

    getMatchesPagePromise({ next: matchCursor, tenant: tenantId })
      .then((matchPage) => {
        matchCursorRef.current = matchPage.next;
        setMatchHasMore(matchPage.next !== null);
        setAllMatches(prev => [...prev, ...matchPage.items]);
      })
      .catch(e => {
        setError((e as Error).message ?? "Неизвестная ошибка");
      })
      .finally(() => {
        setLoadingMore(false);
      });

  }, [loadingMore, tenantScopeReady, tenantId]);

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
