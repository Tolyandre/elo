"use client";
import type { Base58ID } from "@/lib/id";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { getTablePromise, TableSummary } from "@/app/api";
import { gameAppByGameId } from "@/lib/game-apps";
import { toBase58ID } from "@/lib/id";
import type { TableSession } from "@/hooks/useTableSession";

type Options = {
    /** The game page's own path, e.g. "/matches/table/skull-king". */
    pagePath: string;
    /** The game this page hosts; a link to another game's table redirects there. */
    gameId: Base58ID;
    hydrated: boolean;
    session: TableSession | null;
    me: { isAuthenticated: boolean; playerId?: Base58ID };
    setSession: (session: TableSession | null) => void;
    joinTable: (table: TableSummary, myPlayerId: Base58ID) => Promise<void>;
    resetTableSession: () => void;
};

/**
 * URL bindings of a game-table page (ADR-18).
 *
 *   - `?new=1` (the "Создать стол" links on /matches/new): this visit must
 *     produce a NEW table, so any stored session is discarded once and the
 *     param is stripped — the setup screen stays until the page's create
 *     action succeeds and swaps the URL to `?table=<id>`. Several tables of
 *     the same game may coexist (any host, any game).
 *   - `?table=<id>`: the sticky, shareable binding — the param is never
 *     cleared, so a refresh or a shared link reopens exactly that table. A
 *     stored session on the table resumes as-is (host stays host); otherwise
 *     the table is joined as a connected player, or — for a visitor who
 *     cannot join (signed out, no linked player) — watched read-only as an
 *     observer (GET /tables/:id and its SSE stream are public). A table of
 *     another game redirects to that game's page keeping the param.
 *   - `?join=<id>`: legacy alias of `?table=`, normalized to it on entry.
 */
export function useTableDeepLink(options: Options): void {
    const { pagePath, gameId, hydrated, session, me, setSession, joinTable, resetTableSession } = options;
    const router = useRouter();
    const searchParams = useSearchParams();

    // Force-new entry (/matches/new): a new table must always be created
    // here, so a stored session (this game's or another game's) is discarded
    // once, and the param is stripped — the setup screen takes over.
    const isNew = searchParams.get("new") != null;
    useEffect(() => {
        if (!isNew || !hydrated) return;
        resetTableSession();
        router.replace(pagePath, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot per ?new=1 entry
    }, [isNew, hydrated]);

    // Legacy ?join= is normalized to the sticky ?table= form right away, so
    // after the join the URL is already shareable.
    const rawTable = searchParams.get("table");
    const rawJoin = searchParams.get("join");
    useEffect(() => {
        if (rawJoin == null || rawTable != null) return;
        const id = toBase58ID(rawJoin);
        if (!id) return;
        router.replace(`${pagePath}?table=${id}`, { scroll: false });
    }, [rawJoin, rawTable, pagePath, router]);

    // The sticky binding: make sure this visit ends up on exactly the table
    // in the URL. Idempotent — a session already bound to the table (host
    // resume, joined player) short-circuits, so a refresh never re-joins.
    // The legacy ?join= alias is parsed here too, so the join does not have
    // to wait for the URL normalization round-trip.
    const tableParam = toBase58ID(rawTable ?? rawJoin ?? "");
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
                router.replace(pagePath, { scroll: false });
                return;
            }
            if (cancelled) return;
            // A shared link to another game's table opens that game's page.
            if (table.game_id !== gameId) {
                const app = gameAppByGameId(table.game_id);
                if (app) {
                    router.replace(`${app.href}?table=${tableParam}`, { scroll: false });
                    return;
                }
                missingReportedRef.current = tableParam;
                toast.error("Стол не найден или уже завершён");
                if (alreadyHere) resetTableSession();
                router.replace(pagePath, { scroll: false });
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
                return; // the join response adopted the table; URL keeps ?table=
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
