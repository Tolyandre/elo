"use client"

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { Tournament, listTournamentsPromise } from "./api";

type TournamentsContextType = {
  tournaments: Tournament[];
  /** Tournaments whose [start_date, end_date] window contains `date` (default: now). */
  activeTournaments: (date?: Date) => Tournament[];
  invalidate: () => void;
};

const TournamentsContext = createContext<TournamentsContextType | undefined>(undefined);

export const TournamentsProvider = ({ children }: { children: ReactNode }) => {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [stamp, setStamp] = useState(0);

  // Preloaded on mount (and cached by the service worker) so offline match entry
  // can still tag matches with a tournament.
  useEffect(() => {
    listTournamentsPromise().then(setTournaments).catch(() => {});
  }, [stamp]);

  const invalidate = () => setStamp((s) => s + 1);

  const activeTournaments = useCallback(
    (date: Date = new Date()): Tournament[] => {
      const t = date.getTime();
      return tournaments.filter(
        (tr) => new Date(tr.start_date).getTime() <= t && t <= new Date(tr.end_date).getTime(),
      );
    },
    [tournaments],
  );

  return (
    <TournamentsContext.Provider value={{ tournaments, activeTournaments, invalidate }}>
      {children}
    </TournamentsContext.Provider>
  );
};

export const useTournaments = () => {
  const ctx = useContext(TournamentsContext);
  if (!ctx) throw new Error("useTournaments must be used within a TournamentsProvider");
  return ctx;
};
