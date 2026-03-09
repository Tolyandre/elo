"use client"

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getSettingsPromise } from "./api";

export type SettingsState = {
  eloConstK: number,
  eloConstD: number,
  startingElo: number,
  winReward: number,
};

const SettingsContext = createContext<SettingsState | undefined>(undefined);

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const [settings, setSettings] = useState<SettingsState | undefined>(undefined);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const data = await getSettingsPromise();
    setSettings({
      eloConstK: Number(data.elo_const_k),
      eloConstD: Number(data.elo_const_d),
      startingElo: Number(data.starting_elo),
      winReward: Number(data.win_reward),
    });
  };

  return (
    <SettingsContext.Provider value={{
      eloConstD: settings === undefined ? 0 : settings.eloConstD,
      eloConstK: settings === undefined ? 0 : settings.eloConstK,
      startingElo: settings === undefined ? 1000 : settings.startingElo,
      winReward: settings === undefined ? 1 : settings.winReward,
    }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return ctx;
};