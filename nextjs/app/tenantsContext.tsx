"use client"

import { createContext, useContext, useMemo, ReactNode } from "react";
import { Tenant, listTenantsPromise } from "./api";
import { useAsyncResource } from "@/hooks/useAsyncResource";

type TenantsContextType = {
  tenants: Tenant[];
  invalidate: () => void;
};

const TenantsContext = createContext<TenantsContextType | undefined>(undefined);

// Tenants (ADR-36): the communities tournaments and markets can belong to.
// Lightweight read-side context — the two create forms pick a tenant from it;
// the management UI is a later ADR-36 phase.
export const TenantsProvider = ({ children }: { children: ReactNode }) => {
  const { data, invalidate } = useAsyncResource(listTenantsPromise);
  const tenants = useMemo(() => data ?? [], [data]);

  return (
    <TenantsContext.Provider value={{ tenants, invalidate }}>
      {children}
    </TenantsContext.Provider>
  );
};

export const useTenants = () => {
  const ctx = useContext(TenantsContext);
  if (!ctx) throw new Error("useTenants must be used within a TenantsProvider");
  return ctx;
};
