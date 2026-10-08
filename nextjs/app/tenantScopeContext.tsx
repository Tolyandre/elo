"use client"

import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { toBase58ID, type Base58ID } from "@/lib/id";
import { useUrlQuery, setUrlQuery } from "@/lib/url-state";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useTenants } from "./tenantsContext";
import { useClubs } from "./clubsContext";
import { memberPlayerIds } from "@/lib/tenant-members";
import type { Tenant } from "./api";

// The current tenant (ADR-36 phase 4, revised phase 7): the community the
// tenant-dependent pages render. Resolution is explicit only — the URL's
// ?tenant=, then the last displayed tenant (localStorage) — and stops there:
// no silent defaults (the signed-in user's tenant, the single-tenant
// auto-select) ever pick a community the user did not choose. A fresh visit
// resolves to nothing and the pages render the tenant chooser in place of
// their content; one click stores the choice.
const TENANT_STORAGE_KEY = "current-tenant-id";

// The pages whose URL carries the current tenant (deep-linkable surfaces).
// Everywhere else the tenant lives in localStorage and is re-resolved on
// navigation. /new and /matches/edit are among them: their forms create and
// edit under the tenant, so the URL must always name it — a created or
// edited match lands in that tenant's feed, and a stale default would be a
// silent mismatch.
function pageHonorsTenant(pathname: string | null): boolean {
    return pathname === "/" || (pathname?.startsWith("/players/view") ?? false) || pathname === "/new" || pathname === "/matches/edit";
}

export type TenantScope = {
    /** The resolved current tenant id, null when none is in force (yet). */
    tenantId: Base58ID | null;
    /** The resolved tenant object, null while unresolved or when no tenant is in force. */
    tenant: Tenant | null;
    /** True once the resolution chain has settled (initial loads done). */
    ready: boolean;
    /** Switch the community: persists the choice and puts ?tenant= in the URL. */
    setTenant: (id: Base58ID) => void;
    /** Link to a player profile, carrying the current tenant when one is in force. */
    playerHref: (playerId: string) => string;
};

const TenantScopeContext = createContext<TenantScope | undefined>(undefined);

export const TenantScopeProvider = ({ children }: { children: ReactNode }) => {
    const params = useUrlQuery();
    const pathname = usePathname();
    const { tenants } = useTenants();
    const [storedRaw, setStoredTenant] = useLocalStorage<string | null>(TENANT_STORAGE_KEY, null);

    const urlTenant = useMemo(() => toBase58ID(params.get("tenant") ?? ""), [params]);
    const storedTenant = useMemo(() => toBase58ID(storedRaw ?? ""), [storedRaw]);

    // Explicit resolution only (ADR-36 phase 7): the URL wins, then the
    // stored choice — never a silent default. Not ready until the did-mount
    // flag is set: useLocalStorage applies the stored value in a post-mount
    // effect, and effects run in registration order, so by the time `mounted`
    // is true the stored read has landed — a resolved-but-tenantless first
    // commit would flash the chooser before the stored choice appears.
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        /* eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe did-mount flag (same pattern as meContext): the first commit must match the server; only after it may the stored tenant steer resolution and writes */
        setMounted(true);
    }, []);
    const resolved = useMemo((): { id: Base58ID | null; ready: boolean } => {
        if (urlTenant) return { id: urlTenant, ready: true };
        if (storedTenant) return { id: storedTenant, ready: true };
        if (!mounted) return { id: null, ready: false };
        return { id: null, ready: true };
    }, [urlTenant, storedTenant, mounted]);

    const { id: tenantId, ready } = resolved;
    // The tenant object fills in from the list once it loads; the id is the
    // source of truth for everything tenant-scoped.
    const tenant = useMemo(() => tenants.find((t) => t.id === tenantId) ?? null, [tenants, tenantId]);

    // Every displayed tenant becomes the stored one, so the choice survives
    // navigation and reloads. The gate matters: useLocalStorage applies the
    // stored value in a post-mount effect, and a first-commit persist would
    // clobber the unread value (the stored tenant would never survive a
    // reload).
    useEffect(() => {
        if (!mounted) return;
        if (tenantId != null && tenantId !== storedTenant) {
            setStoredTenant(tenantId);
        }
    }, [mounted, tenantId, storedTenant, setStoredTenant]);

    // Deep-linkable pages carry the tenant in the URL: the stored choice is
    // written back ("replace" — the resolution is not a navigation step), so
    // a refresh or a shared link keeps naming the community.
    useEffect(() => {
        if (!mounted || !ready || tenantId == null || !pageHonorsTenant(pathname)) return;
        if (urlTenant !== tenantId) {
            setUrlQuery((p) => p.set("tenant", tenantId), "replace");
        }
    }, [mounted, ready, tenantId, urlTenant, pathname]);

    const setTenant = (id: Base58ID) => {
        setStoredTenant(id);
        setUrlQuery((p) => p.set("tenant", id), "push");
    };

    const playerHref = (playerId: string) =>
        tenantId ? `/players/view?id=${playerId}&tenant=${tenantId}` : `/players/view?id=${playerId}`;

    return (
        <TenantScopeContext.Provider value={{ tenantId, tenant, ready, setTenant, playerHref }}>
            {children}
        </TenantScopeContext.Provider>
    );
};

export const useTenantScope = () => {
    const ctx = useContext(TenantScopeContext);
    if (!ctx) {
        throw new Error("useTenantScope must be used within a TenantScopeProvider");
    }
    return ctx;
};

/**
 * The current tenant's member player ids (ADR-36): active participants of any
 * of its clubs. The creation forms consult this to keep rosters within what
 * the tenant accepts into its feed — see lib/tenant-members.ts.
 */
export function useTenantMemberIds(): Set<string> {
    const { tenant } = useTenantScope();
    const { clubs } = useClubs();
    return useMemo(() => memberPlayerIds(tenant, clubs), [tenant, clubs]);
}