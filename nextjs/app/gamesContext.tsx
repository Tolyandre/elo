"use client"

import { createContext, useContext, useEffect, useMemo, ReactNode } from "react";
import { GameListItem, getGamesPromise } from "./api";
import { useCachedAsyncResource } from "@/hooks/useCachedAsyncResource";
import { writeEntities } from "@/lib/offline/db";

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

  const games = useMemo(() => data?.games ?? [], [data]);

  // Write-through to the Dexie entity replica (ADR-37 phase 6): the name
  // resolution layer mirrors every successful fetch.
  useEffect(() => {
    if (games.length === 0) return;
    // Games carry their tag ids too — the offline replay's gameTags
    // mapping (ADR-39).
    void writeEntities("game", games.map((g) => ({
      id: g.id,
      name: g.name,
      tags: (g.tags ?? []).map((t) => ({ id: t.id, name: t.name })),
    })));
  }, [games]);

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
