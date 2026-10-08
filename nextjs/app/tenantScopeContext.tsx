"use client"

import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { toBase58ID, type Base58ID } from "@/lib/id";
import { useUrlQuery, setUrlQuery } from "@/lib/url-state";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useTenants } from "./tenantsContext";
import { useClubs } from "./clubsContext";
import { useMe } from "./meContext";
import { memberPlayerIds } from "@/lib/tenant-members";
import type { Tenant } from "./api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// The current tenant (ADR-36 phase 4): the community the main page and the
// player page render. Resolution follows the UI contract — the URL's
// ?tenant=, then the last displayed tenant (localStorage), then the
// signed-in user player's tenant (via their clubs), then a single tenant
// auto-selected, then a prompt. The stored tenant intentionally outranks the
// user-player default: an explicit switch is "the user switching it", and the
// header tenant must survive navigation until switched again.
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
    const { tenants, loading: tenantsLoading } = useTenants();
    const { clubs, loading: clubsLoading } = useClubs();
    const { playerId, loading: meLoading } = useMe();
    const [storedRaw, setStoredTenant] = useLocalStorage<string | null>(TENANT_STORAGE_KEY, null);
    const [promptClosed, setPromptClosed] = useState(false);

    const urlTenant = useMemo(() => toBase58ID(params.get("tenant") ?? ""), [params]);
    const storedTenant = useMemo(() => toBase58ID(storedRaw ?? ""), [storedRaw]);

    // The signed-in user player's tenant: any club of theirs that belongs to
    // one. A player straddling several tenants gets the first in list order —
    // switchable like any other.
    const myTenantId = useMemo(() => {
        if (!playerId) return null;
        for (const tenant of tenants) {
            if (tenant.club_ids.some((clubId) =>
                clubs.some((c) => c.id === clubId && c.player_ids.includes(playerId)))) {
                return tenant.id;
            }
        }
        return null;
    }, [playerId, clubs, tenants]);

    const identityReady = !meLoading && !clubsLoading;
    const tenantsReady = !tenantsLoading;
    // The ADR-36 resolution chain. Unsettled (null, not ready) while the
    // initial loads are in flight and neither the URL nor the store has an
    // answer yet.
    const resolved = useMemo((): { id: Base58ID | null; ready: boolean } => {
        if (urlTenant) return { id: urlTenant, ready: true };
        if (storedTenant) return { id: storedTenant, ready: true };
        if (!identityReady || !tenantsReady) return { id: null, ready: false };
        if (myTenantId) return { id: myTenantId, ready: true };
        if (tenants.length === 1) return { id: tenants[0].id, ready: true };
        return { id: null, ready: true };
    }, [urlTenant, storedTenant, identityReady, tenantsReady, myTenantId, tenants]);

    const { id: tenantId, ready } = resolved;
    const tenant = useMemo(() => tenants.find((t) => t.id === tenantId) ?? null, [tenants, tenantId]);

    // Every displayed tenant becomes the stored one, so the choice — explicit
    // or defaulted — survives navigation and reloads. The gate matters:
    // useLocalStorage applies the stored value in a post-mount effect, and a
    // first-commit persist would clobber the unread value with the resolved
    // default (the stored tenant would never survive a reload).
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        /* eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe did-mount flag (same pattern as meContext): the first commit must match the server; only after it may the stored tenant steer resolution and writes */
        setMounted(true);
    }, []);
    useEffect(() => {
        if (!mounted) return;
        if (tenantId != null && tenantId !== storedTenant) {
            setStoredTenant(tenantId);
        }
    }, [mounted, tenantId, storedTenant, setStoredTenant]);

    // Deep-linkable pages carry the tenant in the URL: a resolved default is
    // written back ("replace" — the resolution is not a navigation step).
    // Also mounted-gated: writing the pre-read resolution would put a stale
    // default into the URL, where it outranks the stored tenant forever.
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

    const promptOpen = ready && tenantId == null && tenants.length > 1 && !promptClosed;

    return (
        <TenantScopeContext.Provider value={{ tenantId, tenant, ready, setTenant, playerHref }}>
            {children}
            <Dialog open={promptOpen} onOpenChange={(open) => { if (!open) setPromptClosed(true); }}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Выберите сообщество</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col gap-2">
                        {tenants.map((t) => (
                            <Button key={t.id} variant="outline" onClick={() => setTenant(t.id)}>
                                {t.name}
                            </Button>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>
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
