// @vitest-environment jsdom
// The incremental hydration of the ratings replica (ADR-39): fingerprint-gated
// settlement drains, the per-tenant match cursor, per-step failure isolation
// and the cold-replica settings ensure — against mocked API promises and the
// real Dexie layer (fake-indexeddb).
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Base58ID } from "@/lib/id";
import type { Match } from "@/app/api/types";
import type { ArenaSettlement } from "@/app/api/types";

const api = {
    getArenas: vi.fn(),
    getArena: vi.fn(),
    settlementsPages: vi.fn(),
    matchesPages: vi.fn(),
    settingsAll: vi.fn(),
    clubHistory: vi.fn(),
    tournaments: vi.fn(),
};

vi.mock("@/app/api/arenas", () => ({
    getArenasPromise: (...args: unknown[]) => api.getArenas(...args),
    getArenaPromise: (...args: unknown[]) => api.getArena(...args),
    listArenaSettlementsPagePromise: (...args: unknown[]) => api.settlementsPages(...args),
}));
vi.mock("@/app/api/matches", () => ({
    getMatchesPagePromise: (...args: unknown[]) => api.matchesPages(...args),
}));
vi.mock("@/app/api/settings", () => ({
    listAllSettingsPromise: (...args: unknown[]) => api.settingsAll(...args),
}));
vi.mock("@/app/api/clubs", () => ({
    listClubMemberHistoryPromise: (...args: unknown[]) => api.clubHistory(...args),
}));
vi.mock("@/app/api/tournaments", () => ({
    getTournamentsPromise: (...args: unknown[]) => api.tournaments(...args),
}));

import {
    drainMatchReplica,
    ensureSettingsHistory,
    hydratedAtKey,
    hydrateRatingsReplica,
    matchesCursorKey,
    settlementsFingerprintKey,
} from "@/lib/offline/ratings/hydrate";
import {
    metaGet,
    readArenasList,
    readClubStints,
    readRatingsReplica,
    writeArenaDoc,
    writeMatchReplica,
    writeSettingsHistory,
    type MatchReplicaRow,
} from "@/lib/offline/db";

const TENANT = { id: "tenant-1" as Base58ID, main_arena_id: "arena-main" as Base58ID };

const arenaWire = (id: string, fp: { count: number; last_date?: string; last_id?: string }) => ({
    id,
    name: `Arena ${id}`,
    camp: false,
    filter: null,
    settings: { starting_rating: 1000 },
    settings_schema_version: 2,
    settlements_count: fp.count,
    settlements_last_date: fp.last_date ?? null,
    settlements_last_id: fp.last_id ?? null,
});

/** The mapped Match shape getMatchesPagePromise returns (mapMatch's output). */
const mappedMatch = (id: string, updatedAt: string, extra: Partial<Match> = {}): Match => ({
    id: id as Base58ID,
    game_id: "g1" as Base58ID,
    game_name: "Game",
    date: new Date("2026-06-01T10:00:00Z"),
    dateISO: "2026-06-01T10:00:00Z",
    updated_at: updatedAt,
    score: { p1: { ratingStaked: null, ratingEarned: null, score: 10, ratingAfter: null } },
    has_markets: false,
    mode: "competitive",
    game_score: null,
    game_won: null,
    camps: [{ id: "camp-1" as Base58ID, name: "Camp" }],
    tournament: null,
    ...extra,
});

const settlementRow = (id: string): ArenaSettlement => ({
    id: id as ArenaSettlement["id"],
    player_id: "p1" as ArenaSettlement["player_id"],
    date: "2026-06-01T10:00:00Z",
    rating_after: 1000,
    elo_after: 1000,
    discriminator: "match",
    match_id: "m1" as ArenaSettlement["match_id"],
    market_id: null,
    elo_staked: 0,
    elo_earned: 0,
    rating_staked: 0,
    rating_earned: 0,
    league: null,
});

function blankSettings() {
    return {
        effective_date: "-infinity",
        elo_const_k: 32,
        elo_const_d: 400,
        starting_elo: 1000,
        win_reward: 1,
        newbie_league_earned_min: 2,
        newbie_league_earned_max: 64,
        newbie_league_earned_tau: 100,
        newbie_league_goal_gap: 16,
        elite_league_matches_6months: 20,
        elite_league_matches_2months: 3,
    };
}

function mockDefaults() {
    api.getArenas.mockImplementation((params?: { kind?: string }) => {
        if (params?.kind === "games") return Promise.resolve([arenaWire("arena-viewed", { count: 2, last_date: "2026-06-02T10:00:00Z", last_id: "s2" })]);
        return Promise.resolve([]);
    });
    api.getArena.mockResolvedValue(arenaWire(TENANT.main_arena_id, { count: 1, last_date: "2026-06-01T10:00:00Z", last_id: "s1" }));
    api.settlementsPages.mockResolvedValue({ rows: [settlementRow("s1")], next: null });
    api.matchesPages.mockResolvedValue({ items: [mappedMatch("m1", "2026-06-01T12:00:00Z")], next: null });
    api.settingsAll.mockResolvedValue([blankSettings()]);
    api.tournaments.mockResolvedValue([]);
}

beforeEach(async () => {
    vi.clearAllMocks();
    // Reset every mirror the hydration touches (the Dexie singleton persists
    // across tests in this file).
    await writeSettingsHistory([blankSettings()]);
    await writeArenaDoc({ id: "arena-viewed", settings: {}, settings_schema_version: 2 }, "arena-viewed");
    await writeMatchReplica([]);
});

describe("hydrateRatingsReplica (ADR-39 incremental refresh)", () => {
    it("drains everything on a cold replica and stores the sync state", async () => {
        mockDefaults();
        await hydrateRatingsReplica(TENANT);

        // Ledgers drained for the main arena and the viewed one.
        expect(api.settlementsPages).toHaveBeenCalledTimes(2);
        const drained = api.settlementsPages.mock.calls.map((c) => c[0]);
        expect(drained).toContain(TENANT.main_arena_id);
        expect(drained).toContain("arena-viewed");
        expect(await metaGet<unknown>(settlementsFingerprintKey(TENANT.main_arena_id))).toEqual({
            count: 1,
            last_date: "2026-06-01T10:00:00Z",
            last_id: "s1",
        });
        // Match drain: one call (no cursor), stamp stored.
        expect(api.matchesPages).toHaveBeenCalledTimes(1);
        expect(api.matchesPages.mock.calls[0][0]).toMatchObject({ tenant: TENANT.id });
        expect(api.matchesPages.mock.calls[0][0].updated_since).toBeUndefined();
        expect(await metaGet<string>(matchesCursorKey(TENANT.id))).toBe("2026-06-01T12:00:00Z");
        // Arenas list + settings + tournaments mirrored; the hydration stamp set.
        expect((await readArenasList("games")).map((a) => a.id)).toContain("arena-viewed");
        expect((await readRatingsReplica()).settings).toHaveLength(1);
        expect(await metaGet<string>(hydratedAtKey(TENANT.id))).toBeTruthy();
    });

    it("skips unchanged settlement ledgers and pulls matches incrementally", async () => {
        mockDefaults();
        await hydrateRatingsReplica(TENANT);
        api.settlementsPages.mockClear();
        api.matchesPages.mockClear();

        await hydrateRatingsReplica(TENANT);

        expect(api.settlementsPages).not.toHaveBeenCalled();
        expect(api.matchesPages).toHaveBeenCalledTimes(1);
        expect(api.matchesPages.mock.calls[0][0]).toMatchObject({ tenant: TENANT.id, updated_since: "2026-06-01T12:00:00Z" });
    });

    it("re-drains only arenas whose fingerprint changed", async () => {
        mockDefaults();
        await hydrateRatingsReplica(TENANT);
        api.settlementsPages.mockClear();

        // The viewed arena gained a settlement; the main one did not.
        api.getArenas.mockImplementation((params?: { kind?: string }) => {
            if (params?.kind === "games") return Promise.resolve([arenaWire("arena-viewed", { count: 3, last_date: "2026-06-03T10:00:00Z", last_id: "s3" })]);
            return Promise.resolve([]);
        });

        await hydrateRatingsReplica(TENANT);

        expect(api.settlementsPages).toHaveBeenCalledTimes(1);
        expect(api.settlementsPages.mock.calls[0][0]).toBe("arena-viewed");
        expect(await metaGet<unknown>(settlementsFingerprintKey("arena-viewed"))).toMatchObject({ count: 3, last_id: "s3" });
    });

    it("keeps the old match cursor when a page fails, and still skips unchanged ledgers", async () => {
        mockDefaults();
        await hydrateRatingsReplica(TENANT);
        expect(await metaGet<string>(matchesCursorKey(TENANT.id))).toBe("2026-06-01T12:00:00Z");

        api.settlementsPages.mockClear();
        api.matchesPages.mockRejectedValue(new Error("network gone"));
        api.settingsAll.mockRejectedValue(new Error("settings gone"));

        await hydrateRatingsReplica(TENANT);

        // The failed steps kept their state; the fingerprint-skip still ran
        // (no settlement calls — the stored triple still matches).
        expect(api.settlementsPages).not.toHaveBeenCalled();
        expect(await metaGet<string>(matchesCursorKey(TENANT.id))).toBe("2026-06-01T12:00:00Z");
        // The hydration stamp still advanced — the refresh itself completed.
        expect(await metaGet<string>(hydratedAtKey(TENANT.id))).toBeTruthy();
    });

    it("mirrors stint history for stint-based tenants only", async () => {
        mockDefaults();
        api.clubHistory.mockResolvedValue([
            { club_id: "club-1", player_id: "p1", player_name: "P1", joined_at: "2020-01-01T00:00:00Z", left_at: null },
        ]);

        await hydrateRatingsReplica({ ...TENANT, arena_membership_mode: "all", club_ids: ["club-1" as Base58ID] });
        expect(api.clubHistory).not.toHaveBeenCalled();

        await hydrateRatingsReplica({ ...TENANT, arena_membership_mode: "any_member", club_ids: ["club-1" as Base58ID] });
        expect(api.clubHistory).toHaveBeenCalledWith("club-1");
        expect((await readClubStints(["club-1"])).get("club-1")).toHaveLength(1);
    });

    it("carries camps and the tournament link into the replica rows", async () => {
        mockDefaults();
        api.matchesPages.mockResolvedValue({
            items: [
                mappedMatch("m1", "2026-06-01T12:00:00Z"),
                mappedMatch("m2", "2026-06-02T12:00:00Z", {
                    camps: [],
                    tournament: { id: "t1" as Base58ID, name: "T", slot_id: "slot-1" as Base58ID },
                }),
            ],
            next: null,
        });
        const { rows } = await drainMatchReplica(TENANT.id);
        const byId = new Map(rows.map((r) => [r.id, r]));
        expect(byId.get("m1")?.campArenaIds).toEqual(["camp-1"]);
        expect(byId.get("m2")?.tournamentId).toBe("t1");
    });

    it("advances the cursor to the newest stamp across pages, counting unmapped rows too", async () => {
        mockDefaults();
        // Two pages: a dateless row (skipped from the mirror) on page one with
        // the newest stamp, an older mapped row on page two.
        api.matchesPages.mockImplementation((params: { next?: string }) =>
            params.next
                ? Promise.resolve({ items: [mappedMatch("m1", "2026-06-01T12:00:00Z")], next: null })
                : Promise.resolve({ items: [mappedMatch("m-skipped", "2026-06-09T12:00:00Z", { dateISO: null, date: null })], next: "cursor-1" }),
        );
        const { rows, maxUpdatedAt } = await drainMatchReplica(TENANT.id);
        expect(maxUpdatedAt).toBe("2026-06-09T12:00:00Z");
        expect(rows.map((r) => r.id)).toEqual(["m1"]);
    });
});

describe("ensureSettingsHistory", () => {
    it("mirrors only when the replica holds no settings", async () => {
        mockDefaults();
        await writeSettingsHistory([]);
        await ensureSettingsHistory();
        expect(api.settingsAll).toHaveBeenCalledTimes(1);

        await ensureSettingsHistory();
        expect(api.settingsAll).toHaveBeenCalledTimes(1);
    });
});

// The replica rows of older mirrors stay valid: the link fields are optional
// and treat as "unlinked" until the first v6 drain rewrites the rows.
describe("replica rows", () => {
    it("keep old rows valid without the link fields", async () => {
        const row: MatchReplicaRow = {
            id: "m-old",
            date: "2026-01-01T00:00:00Z",
            gameId: "g1",
            mode: "competitive",
            scores: { p1: 1 },
            hasMarkets: false,
        };
        expect(row.campArenaIds).toBeUndefined();
    });
});
