// Hydration of the ratings replica (ADR-38, incremental per ADR-39): while
// online, the raw material of the offline settlement replay — the arenas
// lists, the settlement ledgers, the tenant's match history, the elo-settings
// time series, the clubs' membership stints and the tournaments — drains into
// the Dexie replica. Every step is isolated: a failure logs and leaves that
// step's mirror (and its sync cursor) as-is, so the next refresh retries just
// that step and the offline engine renders whatever was mirrored last.
//
// The incremental rules (ADR-39):
//   * settlement ledgers re-drain only when the arena's server-computed
//     (count, last_date, last_id) fingerprint differs from the stored one —
//     a recalculation re-inserts rows with fresh ids, so any change shows;
//   * the tenant's matches come through `?updated_since=` with the stored
//     stamp — rows are upserts, and matches are never deleted server-side;
//   * settings, arenas lists, stints and tournaments are small and always
//     refetched in full.

import type { Base58ID } from "@/lib/id";
import { getArenaPromise, getArenasPromise, listArenaSettlementsPagePromise } from "@/app/api/arenas";
import { getMatchesPagePromise } from "@/app/api/matches";
import { listClubMemberHistoryPromise } from "@/app/api/clubs";
import { getTournamentsPromise } from "@/app/api/tournaments";
import { listAllSettingsPromise } from "@/app/api/settings";
import {
    metaGet,
    metaSet,
    readRatingsReplica,
    writeArenasList,
    writeArenaDoc,
    writeArenaSettlements,
    writeClubStints,
    writeMatchReplica,
    writeSettingsHistory,
    writeTournaments,
    type LedgerRow,
    type MatchReplicaRow,
    type SettingsHistoryRow,
} from "@/lib/offline/db";

/** Page cap: a buggy cursor must terminate, not loop forever. */
const MAX_PAGES = 500;
const SETTLEMENTS_PAGE_SIZE = 2000;
// GET /matches clamps the limit to 100 (pageLimit) — asking for more silently
// degrades to the default 30-row pages.
const MATCHES_PAGE_SIZE = 100;

/** Meta keys of the incremental sync state (ADR-39). */
export const settlementsFingerprintKey = (arenaId: string) => `settlements-fp:${arenaId}`;
export const matchesCursorKey = (tenantId: string) => `matches-cursor:${tenantId}`;
/** The last full-hydration stamp, per tenant (the mount-time throttle reads it). */
export const hydratedAtKey = (tenantId: string) => `hydrated-at:${tenantId}`;

/** The arena fingerprint triple exactly as the wire carries it. */
export type SettlementsFingerprint = {
    count: number;
    last_date: string | null;
    last_id: string | null;
};

function fingerprintOf(arena: Record<string, unknown>): SettlementsFingerprint | null {
    if (typeof arena.settlements_count !== "number") return null;
    return {
        count: arena.settlements_count,
        last_date: (arena.settlements_last_date as string | undefined) ?? null,
        last_id: (arena.settlements_last_id as string | undefined) ?? null,
    };
}

function sameFingerprint(a: SettlementsFingerprint | null, b: SettlementsFingerprint | null): boolean {
    if (!a || !b) return false;
    return a.count === b.count && a.last_date === b.last_date && a.last_id === b.last_id;
}

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
            limit: SETTLEMENTS_PAGE_SIZE,
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
 * stores none of those. With `since` set, only rows whose server change stamp
 * is newer come down (the incremental pull, ADR-39); rows still upsert, so
 * re-fetching a row is always safe. Returns the drained rows and the newest
 * change stamp seen (across every listed row — even ones skipped from the
 * mirror — so the cursor never goes backwards).
 */
export async function drainMatchReplica(
    tenantId: Base58ID,
    since?: string,
): Promise<{ rows: MatchReplicaRow[]; maxUpdatedAt: string | null }> {
    let next: string | null = null;
    const rows: MatchReplicaRow[] = [];
    let maxUpdatedAt: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
        const res = await getMatchesPagePromise({
            tenant: tenantId,
            updated_since: since,
            next: next ?? undefined,
            limit: MATCHES_PAGE_SIZE,
        });
        for (const m of res.items) {
            // RFC3339 stamps can mix sub-second precisions, so the max is
            // taken by instant, not lexicographically.
            if (m.updated_at && (!maxUpdatedAt || Date.parse(m.updated_at) > Date.parse(maxUpdatedAt))) {
                maxUpdatedAt = m.updated_at;
            }
            if (!m.dateISO) continue;
            rows.push({
                id: m.id,
                date: m.dateISO,
                gameId: m.game_id,
                mode: m.mode,
                scores: Object.fromEntries(Object.entries(m.score).map(([pid, s]) => [pid, s.score])),
                hasMarkets: m.has_markets,
                campArenaIds: m.camps.map((c) => c.id),
                tournamentId: m.tournament?.id ?? null,
            });
        }
        next = res.next;
        if (!next) break;
    }
    await writeMatchReplica(rows);
    return { rows, maxUpdatedAt };
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

/**
 * Mirrors the settings history only when the replica holds none — the cheap
 * online fix for a cold replica (the replay degrades with an empty series).
 * Used by the ratings provider and the arena-view write-through, whose runs
 * must not wait for the next post-sync hydration.
 */
export async function ensureSettingsHistory(): Promise<void> {
    const replica = await readRatingsReplica();
    if (replica.settings.length > 0) return;
    await mirrorSettingsHistory();
}

/**
 * Full ratings-replica hydration for the current tenant (ADR-39's incremental
 * re-mirroring): the settings history, the arenas lists (their fingerprints
 * gate the ledger drains), the settlement ledgers of the tenant's main arena
 * plus every arena whose view was mirrored (the followed set — a view's
 * write-through adds its arena here), the tenant's matches since the stored
 * stamp, the clubs' stints (stint-based tenants only) and the tournaments.
 * Never throws — each step catches its own failures.
 */
export async function hydrateRatingsReplica(tenant: {
    id: Base58ID;
    main_arena_id: Base58ID;
    arena_membership_mode?: "all" | "any_member" | "members_only" | null;
    club_ids?: Base58ID[];
}): Promise<void> {
    // Settings first (the replay's hard requirement, ADR-38) — isolated.
    try {
        await mirrorSettingsHistory();
    } catch (err) {
        console.error("settings history mirror failed", err);
    }

    // The arenas lists carry every arena's fingerprint; their docs back the
    // camp/tournament arena replays and the offline arenas UI.
    const fingerprints = new Map<string, SettlementsFingerprint>();
    try {
        const lists = await Promise.all([
            getArenasPromise({ kind: "games" }),
            getArenasPromise({ kind: "camps" }),
            getArenasPromise({ kind: "tournaments" }),
        ]);
        const kinds = ["games", "camps", "tournaments"] as const;
        await Promise.all(
            lists.map((arenas, i) => {
                for (const a of arenas) {
                    const fp = fingerprintOf(a as unknown as Record<string, unknown>);
                    if (fp) fingerprints.set(a.id, fp);
                }
                return writeArenasList(kinds[i], arenas as unknown as Record<string, unknown>[]);
            }),
        );
    } catch (err) {
        console.error("arenas list mirror failed", err);
    }

    // The main arena's document mirrors unconditionally so its leaderboard
    // overlay can replay without opening the view; its fingerprint comes from
    // the detail response (pure tenant main arenas are not in the kind lists).
    let mainFingerprint: SettlementsFingerprint | null = null;
    try {
        const arena = (await getArenaPromise(tenant.main_arena_id)) as unknown as Record<string, unknown>;
        mainFingerprint = fingerprintOf(arena);
        await writeArenaDoc(arena, tenant.main_arena_id);
    } catch (err) {
        console.error("main arena doc mirror failed", err);
    }

    // Settlement ledgers of the followed set — skipped when the stored
    // fingerprint still matches the server's.
    const replica = await readRatingsReplica();
    const arenaIds = new Set<string>([tenant.main_arena_id]);
    for (const id of replica.arenaDocs.keys()) arenaIds.add(id);
    await Promise.all(
        [...arenaIds].map(async (id) => {
            try {
                const server = id === tenant.main_arena_id ? mainFingerprint : fingerprints.get(id) ?? null;
                const stored = await metaGet<SettlementsFingerprint>(settlementsFingerprintKey(id));
                if (sameFingerprint(server, stored)) return;
                await drainArenaSettlements(id as Base58ID);
                if (server) await metaSet(settlementsFingerprintKey(id), server);
            } catch (err) {
                console.error("settlements drain failed", id, err);
            }
        }),
    );

    // The tenant's matches since the stored stamp; the stamp advances only
    // after the whole drain succeeded (a failed page keeps the old cursor,
    // and the next run re-pulls — rows are upserts).
    try {
        const cursor = await metaGet<string>(matchesCursorKey(tenant.id));
        const { maxUpdatedAt } = await drainMatchReplica(tenant.id, cursor ?? undefined);
        if (maxUpdatedAt) await metaSet(matchesCursorKey(tenant.id), maxUpdatedAt);
    } catch (err) {
        console.error("match replica drain failed", err);
    }

    // Stints back the stint-based openness modes (ADR-36); the `all` mode
    // never consults them.
    if (tenant.arena_membership_mode && tenant.arena_membership_mode !== "all" && tenant.club_ids?.length) {
        await Promise.all(
            tenant.club_ids.map(async (clubId) => {
                try {
                    const stints = await listClubMemberHistoryPromise(clubId);
                    await writeClubStints(clubId, stints);
                } catch (err) {
                    console.error("club stints mirror failed", clubId, err);
                }
            }),
        );
    }

    // Tournaments are small; their list backs the offline tournaments UI and
    // tournament-arena context.
    try {
        const tournaments = await getTournamentsPromise();
        await writeTournaments(tournaments as unknown as Record<string, unknown>[]);
    } catch (err) {
        console.error("tournaments mirror failed", err);
    }

    await metaSet(hydratedAtKey(tenant.id), new Date().toISOString());
}
