"use client"

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Club, listClubsPromise } from "./api";

type ClubsContextType = {
  clubs: Club[];
};

const ClubsContext = createContext<ClubsContextType | undefined>(undefined);

export const ClubsProvider = ({ children }: { children: ReactNode }) => {
  const [clubs, setClubs] = useState<Club[]>([]);

  useEffect(() => {
    listClubsPromise().then(setClubs).catch(() => {});
  }, []);

  return (
    <ClubsContext.Provider value={{ clubs }}>
      {children}
    </ClubsContext.Provider>
  );
};

export const useClubs = () => {
  const ctx = useContext(ClubsContext);
  if (!ctx) throw new Error("useClubs must be used within a ClubsProvider");
  return ctx;
};
