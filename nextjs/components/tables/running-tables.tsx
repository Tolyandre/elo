"use client";

import { useEffect, useState } from "react";
import { listTablesPromise, TableSummary } from "@/app/api";
import { useMe } from "@/app/meContext";
import { useTenantScope } from "@/app/tenantScopeContext";
import { useTablesLobbySSE } from "@/hooks/useTableSSE";
import { ActiveTables } from "./active-tables";

/**
 * The running-tables lobby on the main page, between the «Сейчас» block and
 * the arena tabs: the current tenant's active tables (ADR-36 phase 7 — the
 * lobby is tenant-scoped like every other feed) with a join button that
 * deep-links into the tables page. Hidden entirely when nothing is running.
 * Refreshes on the tables-lobby SSE signal so tables appear/disappear live,
 * and on a tenant switch so the list always names the displayed community.
 */
export function RunningTables() {
    const me = useMe();
    const { ready: scopeReady, tenantId } = useTenantScope();
    const [tables, setTables] = useState<TableSummary[]>([]);
    const [ready, setReady] = useState(false);
    const tick = useTablesLobbySSE(true);

    useEffect(() => {
        if (!scopeReady || !tenantId) return;
        let cancelled = false;
        listTablesPromise(tenantId)
            .then((list) => {
                if (!cancelled) setTables(list);
            })
            .catch(() => {})
            .finally(() => {
                if (!cancelled) setReady(true);
            });
        return () => {
            cancelled = true;
        };
    }, [tick, scopeReady, tenantId]);

    // The feed-guard pattern (ADR-36): nothing renders before the tenant
    // scope resolves, so a fresh visit never flashes another community's
    // tables; rows of a previous tenant (a switch still in flight) stay
    // hidden because the lobby read is tenant-filtered server-side.
    if (!scopeReady || !tenantId) return null;
    if (!ready || tables.length === 0) return null;

    return (
        // Same column as the «Сейчас» block above and the arena tabs below —
        // with air on both sides, so the card never stretches over the full
        // shell width (the wrapper lives here: the component returns null
        // when nothing runs, leaving no stray padding behind).
        <div className="max-w-sm mx-auto py-4">
            <ActiveTables
                tables={tables}
                me={{ isAuthenticated: me.isAuthenticated, playerId: me.playerId, id: me.id }}
            />
        </div>
    );
}
