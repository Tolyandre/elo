"use client"

import { createContext, useContext, useCallback, useMemo, ReactNode } from "react";
import { Club, listClubsPromise } from "./api";
import { useMe } from "./meContext";
import { useAsyncResource } from "@/hooks/useAsyncResource";

type ClubsContextType = {
  clubs: Club[];
  clubDisplayName: (club: Pick<Club, "name" | "geologist_name">) => string;
  /** Clubs the given player belongs to, ordered by display name. Empty if none. */
  clubsForPlayer: (playerId: string) => Club[];
  invalidate: () => void;
};

const ClubsContext = createContext<ClubsContextType | undefined>(undefined);

export const ClubsProvider = ({ children }: { children: ReactNode }) => {
    const { data, invalidate } = useAsyncResource(listClubsPromise);
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
    <ClubsContext.Provider value={{ clubs, clubDisplayName, clubsForPlayer, invalidate }}>
      {children}
    </ClubsContext.Provider>
  );
};

export const useClubs = () => {
  const ctx = useContext(ClubsContext);
  if (!ctx) throw new Error("useClubs must be used within a ClubsProvider");
  return ctx;
};
