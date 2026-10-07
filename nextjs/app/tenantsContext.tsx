"use client"

import { createContext, useContext, useMemo, ReactNode } from "react";
import { Tenant, listTenantsPromise } from "./api";
import { useAsyncResource } from "@/hooks/useAsyncResource";

type TenantsContextType = {
  tenants: Tenant[];
  /** True while the tenant list is in flight (the tenant-scope default resolution waits for it). */
  loading: boolean;
  invalidate: () => void;
};

const TenantsContext = createContext<TenantsContextType | undefined>(undefined);

// Tenants (ADR-36): the communities tournaments and markets can belong to.
// Lightweight read-side context — the create forms pick a tenant from it and
// the tenant-scope provider resolves the current one (ADR-36 phase 4).
export const TenantsProvider = ({ children }: { children: ReactNode }) => {
  const { data, loading, invalidate } = useAsyncResource(listTenantsPromise);
  const tenants = useMemo(() => data ?? [], [data]);

  return (
    <TenantsContext.Provider value={{ tenants, loading, invalidate }}>
      {children}
    </TenantsContext.Provider>
  );
};

export const useTenants = () => {
  const ctx = useContext(TenantsContext);
  if (!ctx) throw new Error("useTenants must be used within a TenantsProvider");
  return ctx;
};
