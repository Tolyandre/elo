// Win-streak market progress: which global-arena matches count toward a
// market, and how far the streak has gotten. Mirrors the server's counting —
// GetPlayerStreakStats (elo-web-service/pkg/db/query/markets.sql) counts a
// match as a win when the target player's score equals the match's max score
// (ties at the top included) and as a loss when it is strictly below.

import { getMatchesPagePromise, Match, WinStreakParams } from "@/app/api";
import type { Market } from "@/app/api";

/** Upper bound on cursor pages fetched per game, so a pathological feed can't hang the page. */
const MAX_PAGES_PER_GAME = 5;
const PAGE_LIMIT = 100;

/**
 * The exclusive end of the window in which matches count for the market:
 * the resolution moment once resolved, `closes_at` once betting closed or
 * overdue, and null (no bound) while open — null callers treat as "now".
 */
export function streakWindowEnd(market: Market): Date | null {
    if (market.status === "resolved" && market.resolved_at) return new Date(market.resolved_at);
    if (market.status === "resolved" || market.status === "cancelled") return null;
    if (market.status === "open") return null;
    return market.closes_at ? new Date(market.closes_at) : null;
}

/**
 * Matches counting for a win_streak market: the target player's matches in the
 * market's games within [starts_at, end]. Composed from the same paginated
 * global feed the /matches page uses; pages are followed until a page is
 * entirely older than the window start.
 */
export async function fetchStreakMatches(params: WinStreakParams, start: Date, end: Date | null): Promise<Match[]> {
    const byId = new Map<string, Match>();
    await Promise.all(params.game_ids.map(async (gameId) => {
        let next: string | undefined;
        for (let page = 0; page < MAX_PAGES_PER_GAME; page++) {
            const res = await getMatchesPagePromise({
                player_id: params.target_player_id,
                game_id: gameId,
                next,
                limit: PAGE_LIMIT,
            });
            for (const m of res.items) byId.set(m.id, m);
            // The feed is newest-first; once a whole page predates the window
            // (or is undated) everything after it does too.
            const beforeWindow = res.items.length > 0 && res.items.every((m) => !m.date || m.date < start);
            if (!res.next || beforeWindow) break;
            next = res.next;
        }
    }));
    return [...byId.values()]
        .filter((m) => m.date !== null && m.date >= start && (end === null || m.date <= end))
        .sort((a, b) => (b.date as Date).getTime() - (a.date as Date).getTime());
}

export type StreakProgress = { wins: number; losses: number };

/**
 * Wins and losses of the target player across already-filtered matches.
 * A tie at the top counts as a win, same as the server's resolution counter.
 */
export function computeStreakProgress(matches: Match[], targetPlayerId: string): StreakProgress {
    let wins = 0;
    let losses = 0;
    for (const match of matches) {
        const mine = match.score[targetPlayerId];
        if (!mine) continue;
        const max = Math.max(...Object.values(match.score).map((s) => s.score));
        if (mine.score >= max) wins++;
        else losses++;
    }
    return { wins, losses };
}

function plural(n: number, one: string, few: string, many: string): string {
    const mod100 = n % 100;
    const mod10 = n % 10;
    if (mod100 >= 11 && mod100 <= 19) return many;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
}

/**
 * Human-readable time left until `until`, e.g. "5 дней, 20 часов" — the two
 * largest non-zero units. Returns null once the moment has passed.
 */
export function formatRemainingTime(until: Date, now: Date = new Date()): string | null {
    const ms = until.getTime() - now.getTime();
    if (ms <= 0) return null;
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return "меньше минуты";
    const days = Math.floor(minutes / (24 * 60));
    const hours = Math.floor((minutes % (24 * 60)) / 60);
    const mins = minutes % 60;
    const parts: string[] = [];
    if (days > 0) parts.push(`${days} ${plural(days, "день", "дня", "дней")}`);
    if (hours > 0) parts.push(`${hours} ${plural(hours, "час", "часа", "часов")}`);
    if (days === 0 && mins > 0) parts.push(`${mins} ${plural(mins, "минута", "минуты", "минут")}`);
    return parts.join(", ");
}
