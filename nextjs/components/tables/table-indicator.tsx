"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listTablesPromise, TableSummary } from "@/app/api";
import { useMe } from "@/app/meContext";
import { useTablesLobbySSE } from "@/hooks/useTableSSE";
import { gameAppByTable } from "@/lib/game-apps";
import { tablePlayerNames, tableStatus } from "./active-tables";

/**
 * Header indicator for tables this user participates in (host, connected
 * player, or a player the host picked into the game), shown next to the
 * offline-mode icon. One icon PER TABLE — several tables of the same game may
 * run at once, so same-game icons get a small ordinal badge — linking into
 * that exact table via the ?table= deep-link, which resumes/joins it on the
 * game page. Viewers see nothing.
 */
export function TableIndicator() {
    const me = useMe();
    const [tables, setTables] = useState<TableSummary[]>([]);
    const tick = useTablesLobbySSE(me.isAuthenticated);

    useEffect(() => {
        if (!me.isAuthenticated) return;
        let cancelled = false;
        listTablesPromise()
            .then((list) => {
                if (!cancelled) setTables(list);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [me.isAuthenticated, tick]);

    // Participating = hosting, joined (connected_player_ids), or picked into
    // the game by the host (game_state.players) — the icon must show as soon
    // as such a table exists, before the player enters it.
    const mine = tables.filter(
        (t) =>
            (me.id !== undefined && t.host_user_id === me.id) ||
            (me.playerId !== undefined &&
                (t.connected_player_ids.includes(me.playerId) ||
                    t.game_state.players.some((p) => p.id === me.playerId))),
    );
    if (mine.length === 0) return null;

    // Same-game tables are numbered (1, 2, …) so their identical game icons
    // are tellable apart; single-table games get no badge.
    const tablesPerGame = new Map<string, number>();
    for (const t of mine) {
        tablesPerGame.set(t.game_id, (tablesPerGame.get(t.game_id) ?? 0) + 1);
    }
    const ordinalByTableId = new Map<string, number>();
    const seenPerGame = new Map<string, number>();
    for (const t of mine) {
        const n = (seenPerGame.get(t.game_id) ?? 0) + 1;
        seenPerGame.set(t.game_id, n);
        if ((tablesPerGame.get(t.game_id) ?? 0) > 1) {
            ordinalByTableId.set(t.id, n);
        }
    }

    return (
        <>
            {mine.map((table) => {
                const app = gameAppByTable(table);
                if (!app) return null;
                const Icon = app.icon;
                const ordinal = ordinalByTableId.get(table.id) ?? null;
                const title = `Стол «${app.title}» · ${tableStatus(table)} — ${tablePlayerNames(table) || "без игроков"}`;
                return (
                    <Link
                        key={table.id}
                        href={`${app.href}?table=${table.id}`}
                        title={title}
                        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                        <Icon className="h-4 w-4" />
                        {ordinal !== null && (
                            <span className="absolute bottom-0.5 right-0.5 text-[9px] leading-none font-semibold">
                                {ordinal}
                            </span>
                        )}
                    </Link>
                );
            })}
        </>
    );
}
