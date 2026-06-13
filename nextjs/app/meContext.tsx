"use client"

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getMePromise, logout, User } from "./api";
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
  /**
   * True until the identity is determined (cached value applied or the network
   * call settled). Gate auth-dependent UI on this so messages like
   * "log in to add a match" don't flash before the cached user loads.
   */
  loading: boolean;
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
  const [loading, setLoading] = useState<boolean>(true);
  const [stamp, setStamp] = useState<number>(0);
  const [roundToInteger, setRoundToInteger] = useLocalStorage<boolean>("matches-round-to-integer", true);
  const [selectedClubId, setSelectedClubId] = useLocalStorage<string | null>("selected-club-id", null);
  const [geologistMode, setGeologistMode] = useLocalStorage<boolean>("geologist-mode", false);

  useEffect(() => {
    let cancelled = false;

    // Apply the cached identity first so a returning authorized user is known
    // immediately (no flash of "log in" while the /auth/me request is in flight,
    // which can hang when the server is down). A confident cached answer ends the
    // loading state right away; without a cache we wait for the network.
    const cached = readMeCache();
    if (cached) {
      /* eslint-disable react-hooks/set-state-in-effect -- SSR-safe hydration: localStorage is only available after mount */
      setId(cached.id);
      setName(cached.name);
      setCanEdit(cached.can_edit ?? false);
      setPlayerId(cached.player_id ?? undefined);
      setLoading(false);
      /* eslint-enable react-hooks/set-state-in-effect */
    }

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
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Offline / server down: keep the cached identity already applied above.
        setLoading(false);
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
      loading,
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
