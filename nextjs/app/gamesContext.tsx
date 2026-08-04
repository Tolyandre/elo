"use client"

import { createContext, useContext, ReactNode } from "react";
import { GameListItem, getGamesPromise } from "./api";
import { useAsyncResource } from "@/hooks/useAsyncResource";

type GamesContextType = {
  games: GameListItem[];
  invalidate: () => void;
};

const GamesContext = createContext<GamesContextType | undefined>(undefined);

export const GamesProvider = ({ children }: { children: ReactNode }) => {
  const { data, invalidate } = useAsyncResource(getGamesPromise);

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
