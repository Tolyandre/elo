"use client"

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getMatchesPromise, Match } from "../api";

type MatchesState = {
  matches: Match[] | null; // `null` – данные ещё не загружены
  loading: boolean;
  error: string | null;
  invalidate: () => void;
};

/* --- Контекст --- */
const MatchesContext = createContext<MatchesState | undefined>(undefined);

/* --- Провайдер --- */
export const MatchesProvider = ({ children }: { children: ReactNode }) => {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [stamp, setStamp] = useState<number>(0);

  const loadMatches = async () => {
    try {
      setLoading(true);
      const data = await getMatchesPromise();
      setMatches(data.sort((a: { id: number; }, b: { id: number; }) => b.id - a.id));
    } catch (e: any) {
      setError(e.message ?? "Неизвестная ошибка");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMatches();
  }, [stamp]);

  const invalidate = () => {
    setStamp((s) => s + 1);
  };
  return (
    <MatchesContext.Provider value={{ matches, loading, error, invalidate }}>
      {children}
    </MatchesContext.Provider>
  );
};

/* --- Хук для удобного доступа к контексту --- */
export const useMatches = () => {
  const ctx = useContext(MatchesContext);
  if (!ctx) {
    throw new Error("useMatches must be used within a MatchesProvider");
  }
  return ctx;
};