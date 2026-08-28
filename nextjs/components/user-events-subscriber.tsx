"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EloWebServiceBaseUrl } from "@/app/api";
import { useMe } from "@/app/meContext";
import { useSSE } from "@/hooks/useSSE";

/**
 * Local-storage key the Skull King page uses for its active table session.
 * Read directly (not via the page's hook) to suppress invite popups while the
 * user is already sitting at a table.
 */
const SKULL_KING_TABLE_SESSION_KEY = "skull-king-game/table-session";

function hasActiveTableSession(): boolean {
    try {
        const raw = localStorage.getItem(SKULL_KING_TABLE_SESSION_KEY);
        return raw != null && raw !== "null" && raw !== "";
    } catch {
        return false;
    }
}

/**
 * Invisible app-wide subscriber to the per-user event stream (`GET /me/events`),
 * mounted only for signed-in users. Handles:
 *
 *   - "table-invite": another user created a Skull King table with this user's
 *     player in it → toast with a "Войти" action that deep-links to the game
 *     page (?join=<tableId>) and auto-joins. Transient by design — users who
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
                const tableId = data.table_id;
                toast(`Вас позвали за стол Skull King${data.host_name ? ` — ${data.host_name}` : ""}`, {
                    action: {
                        label: "Войти",
                        onClick: () => router.push(`/calculators/skull-king-game?join=${tableId}`),
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

    useSSE(me.isAuthenticated ? `${EloWebServiceBaseUrl}/me/events` : null, { onEvent });

    return null;
}
