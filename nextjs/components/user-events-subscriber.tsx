"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useMe } from "@/app/meContext";
import { useSSETopic } from "@/hooks/useSSETopic";
import { TABLE_SESSION_KEY } from "@/hooks/useTableSession";
import { gameAppByGameId } from "@/lib/game-apps";
import { toBase58ID } from "@/lib/id";

function hasActiveTableSession(): boolean {
    try {
        const raw = localStorage.getItem(TABLE_SESSION_KEY);
        return raw != null && raw !== "null" && raw !== "";
    } catch {
        return false;
    }
}

/**
 * Invisible app-wide subscriber to the per-user events (the "me" topic of
 * the multiplexed /events stream), mounted only for signed-in users. Handles:
 *
 *   - "table-invite": another user created a game table with this user's
 *     player in it → toast with a "Войти" action that deep-links to the game
 *     page (?table=<tableId>) and auto-joins. Transient by design — users who
 *     had the app closed find the table in the "Активные столы" lobby list.
 *   - "match-recorded": another user recorded a match with this user's player
 *     → toast linking to the match view.
 */
export function UserEventsSubscriber() {
    const me = useMe();
    const router = useRouter();

    const onEvent = useCallback(
        (event: { type: string; data?: unknown }) => {
            const data = (event.data ?? {}) as Record<string, string>;

            if (event.type === "table-invite" && data.table_id && !hasActiveTableSession()) {
                const app = data.game_id ? gameAppByGameId(toBase58ID(data.game_id)) : undefined;
                if (!app) return;
                const tableId = data.table_id;
                toast(`Вас позвали за стол «${app.title}»${data.host_name ? ` — ${data.host_name}` : ""}`, {
                    action: {
                        label: "Войти",
                        onClick: () => router.push(`${app.href}?table=${tableId}`),
                    },
                    duration: 20_000,
                });
                return;
            }

            if (event.type === "match-recorded" && data.match_id) {
                const matchId = data.match_id;
                toast(`Записана партия с вашим участием${data.actor_name ? ` — ${data.actor_name}` : ""}`, {
                    action: {
                        label: "Открыть",
                        onClick: () => router.push(`/matches/view?id=${matchId}`),
                    },
                    duration: 10_000,
                });
            }
        },
        [router],
    );

    useSSETopic(me.isAuthenticated ? "me" : null, { onEvent });

    return null;
}
