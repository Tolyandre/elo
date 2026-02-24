"use client"

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getMePromise, logout } from "./api";
import { useLocalStorage } from "@/hooks/useLocalStorage";

export type MeState = {
  id: string | undefined;
  name: string | undefined;
  canEdit: boolean;
  isAuthenticated: boolean;
  logout: () => void;
  invalidate: () => void;
  roundToInteger: boolean;
  setRoundToInteger: (value: boolean) => void;
};

const MeContext = createContext<MeState | undefined>(undefined);

export const MeProvider = ({ children }: { children: ReactNode }) => {
  const [id, setId] = useState<string | undefined>(undefined);
  const [name, setName] = useState<string | undefined>(undefined);
  const [canEdit, setCanEdit] = useState<boolean>(false);
  const [stamp, setStamp] = useState<number>(0);
  const [roundToInteger, setRoundToInteger] = useLocalStorage<boolean>("matches-round-to-integer", true);

  useEffect(() => {
    loadMe();
  }, [stamp]);

  const loadMe = async () => {
    const user = await getMePromise();
    setId(user?.id);
    setName(user?.name);
    setCanEdit(user?.can_edit ?? false);
  };

  const doLogout = () => {
    logout()
      .then(() => {
        setId(undefined);
        setName(undefined);
        setCanEdit(false);
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
      isAuthenticated: !!id,
      logout: doLogout,
      invalidate,
      roundToInteger,
      setRoundToInteger,
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
