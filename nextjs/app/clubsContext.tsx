"use client"

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Club, listClubsPromise } from "./api";

type ClubsContextType = {
  clubs: Club[];
  invalidate: () => void;
};

const ClubsContext = createContext<ClubsContextType | undefined>(undefined);

export const ClubsProvider = ({ children }: { children: ReactNode }) => {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [stamp, setStamp] = useState(0);

  useEffect(() => {
    listClubsPromise().then(setClubs).catch(() => {});
  }, [stamp]);

  const invalidate = () => setStamp((s) => s + 1);

  return (
    <ClubsContext.Provider value={{ clubs, invalidate }}>
      {children}
    </ClubsContext.Provider>
  );
};

export const useClubs = () => {
  const ctx = useContext(ClubsContext);
  if (!ctx) throw new Error("useClubs must be used within a ClubsProvider");
  return ctx;
};
