// Hydration of the ratings replica (ADR-38): while online, the raw material
// of the offline settlement replay — the arena's settlement ledger, the
// tenant's match history and the elo-settings time series — drains into the
// Dexie replica. Every drain is best-effort: a failure logs and leaves the
// replica as-is (the offline engine renders whatever was mirrored last; the
// server refines after sync).

import type { Base58ID } from "@/lib/id";
import { getArenaPromise, listArenaSettlementsPagePromise } from "@/app/api/arenas";
import { getMatchesPagePromise } from "@/app/api/matches";
import { listAllSettingsPromise } from "@/app/api/settings";
import {
    writeArenaDoc,
    writeArenaSettlements,
    writeMatchReplica,
    writeSettingsHistory,
    type LedgerRow,
    type MatchReplicaRow,
    type SettingsHistoryRow,
} from "@/lib/offline/db";

/** Page cap: a buggy cursor must terminate, not loop forever. */
const MAX_PAGES = 500;
const PAGE_SIZE = 2000;

/**
 * Drains one arena's settlement ledger into the replica (all pages, ascending).
 * Pages accumulate and replace the arena's rows wholesale at the end — a
 * replace-per-page would truncate the mirror mid-drain, and a failed page
 * leaves the previous mirror intact. Returns the mirrored row count.
 */
export async function drainArenaSettlements(arenaId: Base58ID): Promise<number> {
    let next: string | null = null;
    const rows: LedgerRow[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
        const res = await listArenaSettlementsPagePromise(arenaId, {
            limit: PAGE_SIZE,
            next: next ?? undefined,
        });
        rows.push(...res.rows.map((r) => ({ ...r, arenaId })));
        next = res.next;
        if (!next) break;
    }
    await writeArenaSettlements(arenaId, rows);
    return rows.length;
}

/**
 * Drains the tenant's match history into the replica (all pages). Match rows
 * are a union across tenants (bulkPut) — the match set itself is global
 * (ADR-36), only the settlement columns are tenant-scoped, and the replica
 * stores none of those.
 */
export async function drainMatchReplica(tenantId: Base58ID): Promise<number> {
    let next: string | null = null;
    let total = 0;
    const rows: MatchReplicaRow[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
        const res = await getMatchesPagePromise({ tenant: tenantId, next: next ?? undefined, limit: PAGE_SIZE });
        for (const m of res.items) {
            if (!m.dateISO) continue;
            rows.push({
                id: m.id,
                date: m.dateISO,
                gameId: m.game_id,
                mode: m.mode,
                scores: Object.fromEntries(Object.entries(m.score).map(([pid, s]) => [pid, s.score])),
                hasMarkets: m.has_markets,
            });
        }
        total = rows.length;
        next = res.next;
        if (!next) break;
    }
    await writeMatchReplica(rows);
    return total;
}

/** Mirrors the elo-settings history (the replay resolves values as-of date). */
export async function mirrorSettingsHistory(): Promise<number> {
    const entries = await listAllSettingsPromise();
    const rows: SettingsHistoryRow[] = entries.map((e) => ({
        effective_date: e.effective_date,
        elo_const_k: e.elo_const_k,
        elo_const_d: e.elo_const_d,
        starting_elo: e.starting_elo,
        win_reward: e.win_reward,
        newbie_league_earned_min: e.newbie_league_earned_min,
        newbie_league_earned_max: e.newbie_league_earned_max,
        newbie_league_earned_tau: e.newbie_league_earned_tau,
        newbie_league_goal_gap: e.newbie_league_goal_gap,
        elite_league_matches_6months: e.elite_league_matches_6months,
        elite_league_matches_2months: e.elite_league_matches_2months,
    }));
    await writeSettingsHistory(rows);
    return rows.length;
}

import { readRatingsReplica } from "@/lib/offline/db";

/**
 * Full ratings-replica hydration for the current tenant: the settings history,
 * the tenant's match history, and the settlement ledgers of the tenant's main
 * arena plus every arena whose view was mirrored (the followed set — a view's
 * write-through adds its arena here). The main arena's document mirrors
 * unconditionally so its leaderboard overlay can replay without opening the
 * view. Best-effort: failures log and the replica keeps its last state.
 */
export async function hydrateRatingsReplica(tenant: { id: Base58ID; main_arena_id: Base58ID }): Promise<void> {
    const [replica] = await Promise.all([readRatingsReplica(), mirrorSettingsHistory()]);
    const arenaIds = new Set<string>([tenant.main_arena_id]);
    for (const id of replica.arenaDocs.keys()) arenaIds.add(id);
    await writeArenaDoc(
        (await getArenaPromise(tenant.main_arena_id)) as unknown as Record<string, unknown>,
        tenant.main_arena_id,
    );
    await Promise.all([
        drainMatchReplica(tenant.id),
        ...[...arenaIds].map((id) =>
            drainArenaSettlements(id as Base58ID).catch((err) => console.error("settlements drain failed", id, err)),
        ),
    ]);
}
