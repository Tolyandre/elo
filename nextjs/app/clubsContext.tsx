"use client"

import { createContext, useContext, useCallback, useMemo, ReactNode } from "react";
import { Club, listClubsPromise } from "./api";
import { useMe } from "./meContext";
import { useCachedAsyncResource } from "@/hooks/useCachedAsyncResource";

type ClubsContextType = {
  clubs: Club[];
  /** True while the club list is in flight (the tenant-scope default resolution waits for it). */
  loading: boolean;
  /** Set when the fetch failed and no cached copy stands in (offline with a cold cache). */
  error: string | null;
  clubDisplayName: (club: Pick<Club, "name" | "geologist_name">) => string;
  /** Clubs the given player belongs to, ordered by display name. Empty if none. */
  clubsForPlayer: (playerId: string) => Club[];
  invalidate: () => void;
};

const ClubsContext = createContext<ClubsContextType | undefined>(undefined);

// The club list is cached in localStorage: the tenant membership rule
// (lib/tenant-members.ts) is computed from it, so offline creation forms must
// resolve it from the last known state rather than block on a failed fetch.
const CLUBS_CACHE_KEY = "clubs-cache-v1";

export const ClubsProvider = ({ children }: { children: ReactNode }) => {
    const { data, loading, error, invalidate } = useCachedAsyncResource(listClubsPromise, CLUBS_CACHE_KEY);
    const clubs = useMemo(() => data ?? [], [data]);

    const { geologistMode } = useMe();

  const clubDisplayName = useCallback(
    (club: Pick<Club, "name" | "geologist_name">): string => {
      return (geologistMode && club.geologist_name) || club.name;
    },
    [geologistMode]
  );

  // Map of player id → clubs they belong to, ordered by display name. Rebuilt only when
  // the club list or naming changes; consumed by club-icon rendering next to player names.
  const clubsByPlayerId = useMemo(() => {
    const ordered = [...clubs].sort((a, b) =>
      clubDisplayName(a).localeCompare(clubDisplayName(b), undefined, { sensitivity: "base" })
    );
    const map = new Map<string, Club[]>();
    for (const club of ordered) {
      for (const pid of club.player_ids) {
        const list = map.get(pid);
        if (list) list.push(club);
        else map.set(pid, [club]);
      }
    }
    return map;
  }, [clubs, clubDisplayName]);

  const clubsForPlayer = useCallback(
    (playerId: string): Club[] => clubsByPlayerId.get(playerId) ?? [],
    [clubsByPlayerId]
  );

  return (
    <ClubsContext.Provider value={{ clubs, loading, error, clubDisplayName, clubsForPlayer, invalidate }}>
      {children}
    </ClubsContext.Provider>
  );
};

export const useClubs = () => {
  const ctx = useContext(ClubsContext);
  if (!ctx) throw new Error("useClubs must be used within a ClubsProvider");
  return ctx;
};
