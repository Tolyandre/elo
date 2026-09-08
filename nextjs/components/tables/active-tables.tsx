"use client";
import type { Base58ID } from "@/lib/id";

import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import type { TableSummary } from "@/app/api";
import { gameAppByTable } from "@/lib/game-apps";
import { Button } from "@/components/ui/button";
import {
    Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";

type Props = {
    tables: TableSummary[];
    loading?: boolean;
    /** Restrict to one game's tables (a game's setup screen); omit for all. */
    gameId?: Base58ID;
    me: { isAuthenticated: boolean; playerId: Base58ID | undefined; id?: string };
    title?: string;
};

/** One-line, game-aware status of a table ("Раунд 3", "Готовы 2/4", …). */
export function tableStatus(table: TableSummary): string {
    const state = table.game_state;
    if ("rounds" in state) {
        return state.phase === "setup" ? "Ожидание игроков" : `Раунд ${state.currentRound}`;
    }
    if ("entries" in state) {
        const done = state.entries.filter((e) => e.done).length;
        return `Готовы ${done}/${state.entries.length}`;
    }
    return "";
}

export function tablePlayerNames(table: TableSummary): string {
    return table.game_state.players.map((p) => p.name).join(", ");
}

/**
 * The "Активные столы" lobby card: live tables with their game icon, players
 * and status. All buttons deep-link to the game's page via ?table= (the
 * sticky, shareable binding); entering never claims hosting — the host role
 * is claimed there only via the explicit "Стать ведущим" button (ADR-18).
 * A visitor who cannot join (signed out, no linked player) opens the table
 * read-only as a viewer on the game page.
 */
export function ActiveTables({
    tables,
    loading,
    gameId,
    me,
    title = "Активные столы",
}: Props) {
    const router = useRouter();
    const visible = gameId ? tables.filter((t) => t.game_id === gameId) : tables;
    const canJoin = me.isAuthenticated && !!me.playerId;

    if (!loading && visible.length === 0) return null;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    {title}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
                {loading && (
                    <p className="text-sm text-muted-foreground">Загрузка...</p>
                )}
                {visible.map((table) => {
                    const app = gameAppByTable(table);
                    const Icon = app?.icon;
                    const status = tableStatus(table);
                                    // Label only: whether this account hosts the
                                    // table. Entering never claims hosting — the
                                    // deep link joins like any player; hosting is
                                    // taken over explicitly in the game page.
                                    const isHostHere = me.isAuthenticated && me.id !== undefined && table.host_user_id === me.id;
                    return (
                        <div
                            key={table.id}
                            className="flex items-center justify-between rounded border border-border px-3 py-2 gap-2"
                        >
                            <div className="flex items-center gap-2 min-w-0">
                                {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
                                <div className="min-w-0">
                                    <p className="text-sm font-medium truncate">
                                        {tablePlayerNames(table) || "—"}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {app ? `${app.title} · ${status}` : status}
                                    </p>
                                </div>
                            </div>
                            {isHostHere ? (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => app && router.push(`${app.href}?table=${table.id}`)}
                                >
                                    Вернуться
                                </Button>
                            ) : (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => app && router.push(`${app.href}?table=${table.id}`)}
                                    title={
                                        canJoin
                                            ? undefined
                                            : "Открыть для просмотра — чтобы играть, войдите и привяжите игрока"
                                    }
                                >
                                    {canJoin ? "Войти" : "Смотреть"}
                                </Button>
                            )}
                        </div>
                    );
                })}
                {!me.isAuthenticated && (
                    <p className="text-xs text-muted-foreground">
                        Без входа столы открываются только для просмотра; чтобы играть, войдите и привяжите игрока
                    </p>
                )}
                {me.isAuthenticated && !me.playerId && (
                    <p className="text-xs text-muted-foreground">
                        Привяжите аккаунт к игроку, чтобы играть за столом
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
