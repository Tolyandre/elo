"use client";

import { useEffect, useState } from "react";
import { listTablesPromise, TableSummary } from "@/app/api";
import { useMe } from "@/app/meContext";
import { useTablesLobbySSE } from "@/hooks/useTableSSE";
import { ActiveTables } from "./active-tables";

/**
 * The running-tables lobby shown at the top of the matches page: every active
 * table (any game) with a join button that deep-links into the game page.
 * Hidden entirely when nothing is running. Refreshes on the tables-lobby SSE
 * signal so tables appear/disappear live.
 */
export function RunningTables() {
    const me = useMe();
    const [tables, setTables] = useState<TableSummary[]>([]);
    const [ready, setReady] = useState(false);
    const tick = useTablesLobbySSE(true);

    useEffect(() => {
        let cancelled = false;
        listTablesPromise()
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
    }, [tick]);

    if (!ready || tables.length === 0) return null;

    return (
        <ActiveTables
            tables={tables}
            me={{ isAuthenticated: me.isAuthenticated, playerId: me.playerId, id: me.id }}
        />
    );
}
