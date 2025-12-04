"use client"

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { GameList, getGamesPromise } from "./api";

const GamesContext = createContext<GameList | undefined>(undefined);

export const GamesProvider = ({ children }: { children: ReactNode }) => {
  const [games, setGames] = useState<GameList>({ games: [] });

  useEffect(() => {
    loadGames();
  }, []);

  const loadGames = async () => {
    const data = await getGamesPromise();
    setGames(data);
  };

  return (
    <GamesContext.Provider value={games}>
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
