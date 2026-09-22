"use client";
import type { Base58ID } from "@/lib/id";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { getTablePromise, TableSummary } from "@/app/api";
import { gameAppByGameId } from "@/lib/game-apps";
import { toBase58ID } from "@/lib/id";
import { useUrlQuery, setUrlQuery } from "@/lib/url-state";
import type { TableSession } from "@/hooks/useTableSession";

type Options = {
    hydrated: boolean;
    session: TableSession | null;
    me: { isAuthenticated: boolean; playerId?: Base58ID };
    setSession: (session: TableSession | null) => void;
    joinTable: (table: TableSummary, myPlayerId: Base58ID) => Promise<void>;
    resetTableSession: () => void;
};

/** Drops the table-binding param (a failed binding leaves a clean URL). */
function clearTableParams() {
    setUrlQuery((params) => {
        params.delete("id");
    });
}

/**
 * URL bindings of the unified table page (ADR-18) — one page serves every
 * game; the game is resolved from the bound table's game_id.
 *
 *   - `?id=<table id>`: the sticky, shareable binding — the param is never
 *     cleared, so a refresh, a shared link, or a reopened invite all open
 *     exactly that table. A stored session on the table resumes as-is (a
 *     host stays host); otherwise the table is joined as a connected player,
 *     or — for a visitor who cannot join (signed out, no linked player) —
 *     watched read-only as an observer (GET /tables/{id} and its SSE stream
 *     are public).
 *   - No param: a stored session resumes (the «Вернуться» lobby path); the
 *     empty state is shown otherwise.
 */
export function useTableDeepLink(options: Options): void {
    const { hydrated, session, me, setSession, joinTable, resetTableSession } = options;
    // Param reads/writes go through lib/url-state (ADR-25): the router is
    // blind to same-route query changes on the static export.
    const searchParams = useUrlQuery();

    // The sticky binding: make sure this visit ends up on exactly the table
    // in the URL. Idempotent — a session already bound to the table (host
    // resume, joined player) short-circuits, so a refresh never re-joins.
    const tableParam = toBase58ID(searchParams.get("id") ?? "");
    const canJoin = me.isAuthenticated && !!me.playerId;
    const boundToParam = session?.tableId === tableParam && tableParam !== null;
    // A table reported missing is not refetched for the rest of this binding
    // (the not-found path resets the session, which would re-run this effect).
    const missingReportedRef = useRef<Base58ID | null>(null);
    // A param this page has already bound a session to. If the session is torn
    // down (host deleted/saved the table, "closed" broadcast) while the param
    // stays in the URL, that is teardown — not a fresh visit — and must not
    // trigger a re-join or the "not found" fallback racing the redirect.
    const everBoundParamRef = useRef<Base58ID | null>(null);
    useEffect(() => {
        if (!tableParam || !hydrated) return;
        if (missingReportedRef.current === tableParam) return;
        if (boundToParam) {
            everBoundParamRef.current = tableParam;
        } else if (!session && everBoundParamRef.current === tableParam) {
            return;
        }
        if (boundToParam && (session!.isHost || session!.myPlayerIndex !== null || !canJoin)) return;
        const alreadyHere = boundToParam;

        let cancelled = false;
        (async () => {
            let table: TableSummary;
            try {
                table = await getTablePromise(tableParam);
            } catch {
                if (cancelled) return;
                missingReportedRef.current = tableParam;
                toast.error("Стол не найден или уже завершён");
                if (alreadyHere) resetTableSession();
                clearTableParams();
                return;
            }
            if (cancelled) return;
            if (!gameAppByGameId(table.game_id)) {
                // A table of an unknown game (older client, removed game)
                // cannot be rendered — treat it like a missing table.
                missingReportedRef.current = tableParam;
                toast.error("Стол не найден или уже завершён");
                if (alreadyHere) resetTableSession();
                clearTableParams();
                return;
            }
            // Entering never claims hosting (ADR-18): join as a connected
            // player, or watch read-only when joining is impossible.
            if (canJoin) {
                try {
                    await joinTable(table, me.playerId!);
                } catch (err) {
                    if (!cancelled) {
                        toast.error(err instanceof Error ? err.message : String(err));
                    }
                    return; // keep the binding; a refresh retries
                }
                return; // the join response adopted the table; URL keeps ?id=
            }
            // Not joinable (signed out / no linked player): watch read-only.
            // Reached only when no session is bound yet — a bound observer
            // short-circuited above.
            setSession({ tableId: tableParam, isHost: false, myPlayerIndex: null });
        })();
        return () => {
            cancelled = true;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- joinTable/reset are per-render closures; keyed by the primitives they use
    }, [tableParam, hydrated, boundToParam, session?.isHost, session?.myPlayerIndex, canJoin, me.playerId]);
}
