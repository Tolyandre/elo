"use client"

import { createContext, useContext, ReactNode } from "react";
import { GameListItem, getGamesPromise } from "./api";
import { useCachedAsyncResource } from "@/hooks/useCachedAsyncResource";

type GamesContextType = {
  games: GameListItem[];
  invalidate: () => void;
};

const GamesContext = createContext<GamesContextType | undefined>(undefined);

// The games list is cached in localStorage: game-creation forms validate the
// typed name against it, so a truly offline visit (cold service-worker cache)
// must still resolve the last known list rather than validate against nothing.
const GAMES_CACHE_KEY = "games-cache-v1";

export const GamesProvider = ({ children }: { children: ReactNode }) => {
  const { data, invalidate } = useCachedAsyncResource(getGamesPromise, GAMES_CACHE_KEY);

  const games = data?.games ?? [];

  return (
    <GamesContext.Provider value={{ games, invalidate }}>
      {children}
    </GamesContext.Provider>
  );
};

export const useGames = () => {
  const ctx = useContext(GamesContext);
  if (!ctx) {
    throw new Error("useGames must be used within a GamesProvider");
  }
  return ctx;
};
