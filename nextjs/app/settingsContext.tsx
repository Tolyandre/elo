"use client"

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getSettingsPromise } from "./api";

export type SettingsState = {
  eloConstK: number,
  eloConstD: number,
  startingElo: number,
  winReward: number,
  newbieLeagueGoal: number,
  eliteMatches6m: number,
  eliteMatches2m: number,
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
      newbieLeagueGoal: Number(data.newbie_league_goal),
      eliteMatches6m: Number(data.elite_league_matches_6months),
      eliteMatches2m: Number(data.elite_league_matches_2months),
    });
  };

  return (
    <SettingsContext.Provider value={{
      eloConstD: settings === undefined ? 0 : settings.eloConstD,
      eloConstK: settings === undefined ? 0 : settings.eloConstK,
      startingElo: settings === undefined ? 1000 : settings.startingElo,
      winReward: settings === undefined ? 1 : settings.winReward,
      newbieLeagueGoal: settings === undefined ? 0 : settings.newbieLeagueGoal,
      eliteMatches6m: settings === undefined ? 0 : settings.eliteMatches6m,
      eliteMatches2m: settings === undefined ? 0 : settings.eliteMatches2m,
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