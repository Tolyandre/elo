"use client"

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getSettingsPromise } from "./api";

export type SettingsState = {
  eloConstK: number,
  eloConstD: number
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
      eloConstD: Number(data.elo_const_d)
    });
  };

  return (
    <SettingsContext.Provider value={{
      eloConstD: settings === undefined ? 0 : settings.eloConstD,
      eloConstK: settings === undefined ? 0 : settings.eloConstK
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