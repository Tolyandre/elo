"use client"

import { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from "react";
import { Club, listClubsPromise } from "./api";
import { useMe } from "./meContext";

type ClubsContextType = {
  clubs: Club[];
  clubDisplayName: (club: Pick<Club, "name" | "geologist_name">) => string;
  /** Clubs the given player belongs to, ordered by display name. Empty if none. */
  clubsForPlayer: (playerId: string) => Club[];
  invalidate: () => void;
};

const ClubsContext = createContext<ClubsContextType | undefined>(undefined);

export const ClubsProvider = ({ children }: { children: ReactNode }) => {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [stamp, setStamp] = useState(0);

  const { geologistMode } = useMe();

  useEffect(() => {
    listClubsPromise().then(setClubs).catch(() => {});
  }, [stamp]);

  const invalidate = () => setStamp((s) => s + 1);

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
      for (const pid of club.players) {
        const key = String(pid);
        const list = map.get(key);
        if (list) list.push(club);
        else map.set(key, [club]);
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
