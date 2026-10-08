"use client"

import { createContext, useContext, useMemo, ReactNode } from "react";
import { Tenant, listTenantsPromise } from "./api";
import { useCachedAsyncResource } from "@/hooks/useCachedAsyncResource";

type TenantsContextType = {
  tenants: Tenant[];
  /** True while the tenant list is in flight (the tenant-scope default resolution waits for it). */
  loading: boolean;
  /**
   * Set when the fetch failed and no cached copy stands in. Pages must treat
   * this as "list unavailable" — never as "the community is gone": offline,
   * the list the current tenant resolves from simply did not load.
   */
  error: string | null;
  invalidate: () => void;
};

const TenantsContext = createContext<TenantsContextType | undefined>(undefined);

// Tenants (ADR-36): the communities tournaments and markets can belong to.
// Lightweight read-side context — the create forms pick a tenant from it and
// the tenant-scope provider resolves the current one (ADR-36 phase 4). The
// list is cached in localStorage: the whole tenant-scoped UI gates on it, so
// offline it must resolve from the last known state, not from a live fetch.
const TENANTS_CACHE_KEY = "tenants-cache-v1";

export const TenantsProvider = ({ children }: { children: ReactNode }) => {
  const { data, loading, error, invalidate } = useCachedAsyncResource(listTenantsPromise, TENANTS_CACHE_KEY);
  const tenants = useMemo(() => data ?? [], [data]);

  return (
    <TenantsContext.Provider value={{ tenants, loading, error, invalidate }}>
      {children}
    </TenantsContext.Provider>
  );
};

export const useTenants = () => {
  const ctx = useContext(TenantsContext);
  if (!ctx) throw new Error("useTenants must be used within a TenantsProvider");
  return ctx;
};
