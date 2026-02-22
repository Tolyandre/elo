"use client"

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { GameListItem, getGamesPromise } from "./api";

type GamesContextType = {
  games: GameListItem[];
  invalidate: () => void;
};

const GamesContext = createContext<GamesContextType | undefined>(undefined);

export const GamesProvider = ({ children }: { children: ReactNode }) => {
  const [games, setGames] = useState<GameListItem[]>([]);
  const [stamp, setStamp] = useState<number>(0);

  useEffect(() => {
    loadGames();
  }, [stamp]);

  const loadGames = async () => {
    const data = await getGamesPromise();
    setGames(data.games);
  };

  const invalidate = () => {
    setStamp((s) => s + 1);
  };

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
