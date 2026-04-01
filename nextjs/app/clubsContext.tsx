"use client"

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { Club, listClubsPromise } from "./api";
import { useMe } from "./meContext";

type ClubsContextType = {
  clubs: Club[];
  clubDisplayName: (club: Pick<Club, "name" | "geologist_name">) => string;
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

  return (
    <ClubsContext.Provider value={{ clubs, clubDisplayName, invalidate }}>
      {children}
    </ClubsContext.Provider>
  );
};

export const useClubs = () => {
  const ctx = useContext(ClubsContext);
  if (!ctx) throw new Error("useClubs must be used within a ClubsProvider");
  return ctx;
};
