"use client"

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getMePromise, logout } from "./api";

export type MeState = {
  id: string;
  name: string;
  logout: () => void;
  invalidate: () => void;
};

const MeContext = createContext<MeState | undefined>(undefined);

export const MeProvider = ({ children }: { children: ReactNode }) => {
  const [id, setId] = useState<string | undefined>(undefined);
  const [name, setName] = useState<string | undefined>(undefined);
  const [stamp, setStamp] = useState<number>(0);

  useEffect(() => {
    loadMe();
  }, [stamp]);

  const loadMe = async () => {
    const user = await getMePromise();
    setId(user ? user.id : "");
    setName(user ? user.name : "");
  };

  const doLogout = () => {
    logout()
      .then(() => {
        setId(undefined);
        setName(undefined);
      });
  };

  const invalidate = () => {
    setStamp((s) => s + 1);
  };

  return (
    <MeContext.Provider value={{ id: id ?? "", name: name ?? "", logout: doLogout, invalidate }}>
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
