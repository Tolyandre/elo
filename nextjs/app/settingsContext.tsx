"use client"

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getSettingsPromise } from "./api";

export type SettingsState = {
  eloConstK: number,
  eloConstD: number,
  startingElo: number,
  winReward: number,
  newbieLeagueEarnedMin: number,
  newbieLeagueEarnedMax: number,
  newbieLeagueEarnedTau: number,
  newbieLeagueGoalGap: number,
  startingRatingGlobalArena: number,
  startingRatingGameArena: number,
  eliteMatches6m: number,
  eliteMatches2m: number,
};

const SettingsContext = createContext<SettingsState | undefined>(undefined);

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const [settings, setSettings] = useState<SettingsState | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getSettingsPromise().then((data) => {
      if (cancelled) return;
      setSettings({
      eloConstK: Number(data.elo_const_k),
      eloConstD: Number(data.elo_const_d),
      startingElo: Number(data.starting_elo),
      winReward: Number(data.win_reward),
      newbieLeagueEarnedMin: Number(data.newbie_league_earned_min),
      newbieLeagueEarnedMax: Number(data.newbie_league_earned_max),
      newbieLeagueEarnedTau: Number(data.newbie_league_earned_tau),
      newbieLeagueGoalGap: Number(data.newbie_league_goal_gap),
      startingRatingGlobalArena: Number(data.starting_rating_global_arena),
      startingRatingGameArena: Number(data.starting_rating_game_arena),
      eliteMatches6m: Number(data.elite_league_matches_6months),
      eliteMatches2m: Number(data.elite_league_matches_2months),
      });
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <SettingsContext.Provider value={{
      eloConstD: settings === undefined ? 0 : settings.eloConstD,
      eloConstK: settings === undefined ? 0 : settings.eloConstK,
      startingElo: settings === undefined ? 1000 : settings.startingElo,
      winReward: settings === undefined ? 1 : settings.winReward,
      newbieLeagueEarnedMin: settings === undefined ? 2 : settings.newbieLeagueEarnedMin,
      newbieLeagueEarnedMax: settings === undefined ? 64 : settings.newbieLeagueEarnedMax,
      newbieLeagueEarnedTau: settings === undefined ? 100 : settings.newbieLeagueEarnedTau,
      newbieLeagueGoalGap: settings === undefined ? 16 : settings.newbieLeagueGoalGap,
      startingRatingGlobalArena: settings === undefined ? 0 : settings.startingRatingGlobalArena,
      startingRatingGameArena: settings === undefined ? 900 : settings.startingRatingGameArena,
      eliteMatches6m: settings === undefined ? 20 : settings.eliteMatches6m,
      eliteMatches2m: settings === undefined ? 3 : settings.eliteMatches2m,
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
