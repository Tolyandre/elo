"use client"

import { createContext, useContext, ReactNode } from "react";
import { getSettingsPromise } from "./api";
import { useAsyncResource } from "@/hooks/useAsyncResource";

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

const DEFAULTS: SettingsState = {
  eloConstK: 0,
  eloConstD: 0,
  startingElo: 1000,
  winReward: 1,
  newbieLeagueEarnedMin: 2,
  newbieLeagueEarnedMax: 64,
  newbieLeagueEarnedTau: 100,
  newbieLeagueGoalGap: 16,
  startingRatingGlobalArena: 0,
  startingRatingGameArena: 900,
  eliteMatches6m: 20,
  eliteMatches2m: 3,
};

const SettingsContext = createContext<SettingsState | undefined>(undefined);

function mapSettings(data: Awaited<ReturnType<typeof getSettingsPromise>>): SettingsState {
  return {
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
  };
}

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const { data } = useAsyncResource(async () => mapSettings(await getSettingsPromise()));
  const settings = data ?? DEFAULTS;

  return (
    <SettingsContext.Provider value={settings}>
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
