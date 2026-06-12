"use client"

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getMePromise, logout, NetworkError, User } from "./api";
import { useLocalStorage } from "@/hooks/useLocalStorage";

// Cached /auth/me identity so canEdit gating keeps working while offline.
const ME_CACHE_KEY = "me-cache-v1";

type MeCache = Pick<User, "id" | "name" | "can_edit" | "player_id">;

function readMeCache(): MeCache | undefined {
    try {
        const raw = localStorage.getItem(ME_CACHE_KEY);
        return raw ? (JSON.parse(raw) as MeCache) : undefined;
    } catch {
        return undefined;
    }
}

export type MeState = {
  id: string | undefined;
  name: string | undefined;
  canEdit: boolean;
  playerId: string | undefined;
  isAuthenticated: boolean;
  logout: () => void;
  invalidate: () => void;
  roundToInteger: boolean;
  setRoundToInteger: (value: boolean) => void;
  selectedClubId: string | null;
  setSelectedClubId: (value: string | null) => void;
  geologistMode: boolean;
  setGeologistMode: (value: boolean) => void;
};

const MeContext = createContext<MeState | undefined>(undefined);

export const MeProvider = ({ children }: { children: ReactNode }) => {
  const [id, setId] = useState<string | undefined>(undefined);
  const [name, setName] = useState<string | undefined>(undefined);
  const [canEdit, setCanEdit] = useState<boolean>(false);
  const [playerId, setPlayerId] = useState<string | undefined>(undefined);
  const [stamp, setStamp] = useState<number>(0);
  const [roundToInteger, setRoundToInteger] = useLocalStorage<boolean>("matches-round-to-integer", true);
  const [selectedClubId, setSelectedClubId] = useLocalStorage<string | null>("selected-club-id", null);
  const [geologistMode, setGeologistMode] = useLocalStorage<boolean>("geologist-mode", false);

  useEffect(() => {
    let cancelled = false;
    getMePromise()
      .then((user) => {
        if (cancelled) return;
        setId(user?.id);
        setName(user?.name);
        setCanEdit(user?.can_edit ?? false);
        setPlayerId(user?.player_id ?? undefined);
        if (user) {
          localStorage.setItem(ME_CACHE_KEY, JSON.stringify({
            id: user.id, name: user.name, can_edit: user.can_edit, player_id: user.player_id,
          } satisfies MeCache));
        } else {
          // 401 — the session is gone, the cached identity must go too.
          localStorage.removeItem(ME_CACHE_KEY);
        }
      })
      .catch((e) => {
        if (cancelled || !(e instanceof NetworkError)) return;
        // Offline: fall back to the identity cached on the last successful login.
        const cached = readMeCache();
        if (!cached) return;
        setId(cached.id);
        setName(cached.name);
        setCanEdit(cached.can_edit ?? false);
        setPlayerId(cached.player_id ?? undefined);
      });
    return () => { cancelled = true; };
  }, [stamp]);

  const doLogout = () => {
    logout()
      .then(() => {
        localStorage.removeItem(ME_CACHE_KEY);
        setId(undefined);
        setName(undefined);
        setCanEdit(false);
        setPlayerId(undefined);
      });
  };

  const invalidate = () => {
    setStamp((s) => s + 1);
  };

  return (
    <MeContext.Provider value={{
      id,
      name,
      canEdit,
      playerId,
      isAuthenticated: !!id,
      logout: doLogout,
      invalidate,
      roundToInteger,
      setRoundToInteger,
      selectedClubId,
      setSelectedClubId,
      geologistMode,
      setGeologistMode,
    }}>
      {children}
    </MeContext.Provider>
  );
};

export const useMe = () => {
  const ctx = useContext(MeContext);
  if (!ctx) {
    throw new Error("useMe must be used within a MeProvider");
  }
  return ctx;
};
