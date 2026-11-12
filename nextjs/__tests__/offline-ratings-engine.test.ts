// Unit tests of the offline settlement engine's orchestration (ADR-38): the
// input assembly around the wasm call — membership evaluation, op overlay,
// settings/market conversion, output shaping — against a fake bridge. The
// wasm math itself is pinned by the golden parity suite
// (settlement-wasm.test.ts).
import { describe, expect, it, vi } from "vitest";
import {
    arenaMembership,
    overlayMatchOps,
    runEngine,
    type EngineArena,
    type EngineInput,
    type TenantMembershipContext,
} from "@/lib/offline/ratings/engine";
import type { WasmBridge, WasmReplayInput, WasmReplayOutput } from "@/lib/offline/ratings/wasm-client";
import type { LedgerRow, MatchReplicaRow, SettingsHistoryRow } from "@/lib/offline/db";
import type { PendingMatch, PendingOp } from "@/lib/offline/types";
import type { Base58ID } from "@/lib/id";

const SETTINGS_DOC = { starting_rating: 1000, catch_up: { earned_min: 2, earned_max: 64, tau: 100 }, leagues: [] };

const settingsRow = (overrides: Partial<SettingsHistoryRow> = {}): SettingsHistoryRow => ({
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
    ...overrides,
});

const replicaRow = (id: string, date: string, scores: Record<string, number>): MatchReplicaRow => ({
    id,
    date,
    gameId: "game-1",
    mode: "competitive",
    scores,
    hasMarkets: false,
});

const ledgerRow = (overrides: Partial<LedgerRow>): LedgerRow => ({
    arenaId: "arena-1",
    id: "s1",
    player_id: "p1",
    date: "2026-06-01T10:00:00Z",
    rating_after: 1010,
    elo_after: 1010,
    discriminator: "match",
    match_id: "m1",
    market_id: null,
    elo_staked: -10,
    elo_earned: 20,
    rating_staked: -10,
    rating_earned: 20,
    league: null,
    ...overrides,
});

const pendingMatch = (clientId: string, score: Record<string, number>, createdAt = "2026-06-10T10:00:00Z"): PendingMatch => ({
    clientId: clientId as Base58ID,
    createdAt,
    status: "pending",
    gameId: "game-1" as Base58ID,
    score,
    campArenaIds: [],
    calculatorKind: null,
    calculatorData: null,
});

const tenantArena = (overrides: Partial<EngineArena> = {}): EngineArena => ({
    id: "arena-1",
    tenantId: "tenant-1",
    membershipMode: "all",
    settings: SETTINGS_DOC,
    settingsVersion: 2,
    filter: null,
    ...overrides,
});

const fakeOutput = (matchIds: string[]): WasmReplayOutput => ({
    settlements: matchIds.map((id) => ({
        match_id: id,
        players: {
            p1: { elo_staked: -8, elo_earned: 16, new_elo: 1008, rating_staked: -8, rating_earned: 16, new_rating: 1008, league: null },
            p2: { elo_staked: -8, elo_earned: 0, new_elo: 992, rating_staked: -8, rating_earned: 0, new_rating: 992, league: null },
        },
    })),
    standings: [
        { time: "2026-06-08T00:00:00.000Z", players: [] },
        { time: "2026-06-09T12:00:00.000Z", players: [] },
        { time: "2026-06-10T10:00:00.000Z", players: [{ player_id: "p1", rating: 1008, league: null, rank: 1, matches_count: 2, first_count: 2, second_count: 0, third_count: 0, fourth_count: 0, matches_left_for_elite: 0, wins_needed_for_amateur_lower: 0, wins_needed_for_amateur_upper: 0 }] },
    ],
});

function capturingBridge(output?: WasmReplayOutput): { bridge: WasmBridge; captured: WasmReplayInput[] } {
    const captured: WasmReplayInput[] = [];
    const bridge: WasmBridge = {
        replayArena(input: WasmReplayInput): WasmReplayOutput {
            captured.push(input);
            return output ?? fakeOutput(input.matches.map((m) => m.id));
        },
    };
    return { bridge, captured };
}

const baseInput = (overrides: Partial<EngineInput>): EngineInput => ({
    arena: tenantArena(),
    matches: [],
    pendingMatches: [],
    matchOps: [],
    marketRows: [],
    settings: [settingsRow()],
    gameTags: undefined,
    now: new Date("2026-06-10T10:00:00Z"),
    bridge: capturingBridge().bridge,
    ...overrides,
});

describe("runEngine (ADR-38)", () => {
    it("returns null when the wasm bridge is unavailable", async () => {
        const result = runEngine(baseInput({ bridge: null, pendingMatches: [pendingMatch("pm1", { p1: 10 })] }));
        expect(result).toBeNull();
    });

    it("degrades to null when the replay throws (empty settings history on a cold replica)", async () => {
        const bridge: WasmBridge = {
            replayArena: () => {
                throw new Error("settlement replay failed: no elo settings history");
            },
        };
        const result = runEngine(baseInput({ bridge, pendingMatches: [pendingMatch("pm1", { p1: 10, p2: 5 })] }));
        expect(result).toBeNull();
    });

    it("returns null without local events (the replica fast path)", async () => {
        const { bridge, captured } = capturingBridge();
        const result = runEngine(baseInput({ bridge, matches: [replicaRow("m1", "2026-06-01T10:00:00Z", { p1: 10, p2: 5 })] }));
        expect(result).toBeNull();
        expect(captured).toHaveLength(0);
    });

    it("sends pending matches to the replay and shapes the output", async () => {
        const { bridge, captured } = capturingBridge();
        const result = runEngine(
            baseInput({ bridge, pendingMatches: [pendingMatch("pm1", { p1: 10, p2: 5 })] }),
        );
        expect(captured).toHaveLength(1);
        expect(captured[0].matches).toEqual([{ id: "pm1", date: "2026-06-10T10:00:00Z", scores: { p1: 10, p2: 5 } }]);
        expect(captured[0].settings).toEqual(SETTINGS_DOC);
        expect(captured[0].settings_version).toBe(2);
        // -infinity maps to a parseable epoch date for the Go side.
        expect(captured[0].elo_settings[0].effective_date).toBe("0001-01-01T00:00:00Z");
        expect(captured[0].snapshot_times).toHaveLength(3);
        expect(result?.settlementsByMatch.get("pm1")?.p1).toEqual({
            ratingStaked: -8,
            ratingEarned: 16,
            ratingAfter: 1008,
            league: null,
        });
        expect(result?.standingsNow?.[0].player_id).toBe("p1");
    });

    it("excludes coop pending matches from a mode-all tenant arena", async () => {
        const { bridge, captured } = capturingBridge();
        const coop: PendingMatch = { ...pendingMatch("coop1", {}), mode: "coop" };
        const result = runEngine(baseInput({ bridge, pendingMatches: [coop, pendingMatch("pm1", { p1: 3, p2: 1 })] }));
        expect(result).not.toBeNull();
        expect(captured[0].matches.map((m) => m.id)).toEqual(["pm1"]);
    });

    it("degrades to null for stint-based tenant openness modes", async () => {
        const { bridge } = capturingBridge();
        const result = runEngine(
            baseInput({ bridge, arena: tenantArena({ membershipMode: "any_member" }), pendingMatches: [pendingMatch("pm1", { p1: 3, p2: 1 })] }),
        );
        expect(result).toBeNull();
    });

    it("degrades to null for camp arenas without a filter or tenant", async () => {
        const { bridge } = capturingBridge();
        const result = runEngine(
            baseInput({ bridge, arena: tenantArena({ tenantId: null, membershipMode: null, filter: null }), pendingMatches: [pendingMatch("pm1", { p1: 3, p2: 1 })] }),
        );
        expect(result).toBeNull();
    });

    it("evaluates a filter arena's game_ids and date window", async () => {
        const { bridge, captured } = capturingBridge();
        const arena = tenantArena({
            tenantId: null,
            membershipMode: null,
            filter: { game_ids: ["game-1"], tag_ids: [], date_from: "2026-06-05T00:00:00Z", date_to: null },
        });
        const result = runEngine(
            baseInput({
                bridge,
                arena,
                matches: [replicaRow("m-old", "2026-06-01T10:00:00Z", { p1: 9, p2: 2 })],
                pendingMatches: [pendingMatch("pm1", { p1: 3, p2: 1 })],
            }),
        );
        expect(result).not.toBeNull();
        // The pre-window replica match is out; the pending one is in.
        expect(captured[0].matches.map((m) => m.id)).toEqual(["pm1"]);
    });

    it("degrades when a tag filter cannot be evaluated offline", async () => {
        const { bridge } = capturingBridge();
        const arena = tenantArena({
            tenantId: null,
            membershipMode: null,
            filter: { game_ids: [], tag_ids: ["tag-1"], date_from: null, date_to: null },
        });
        const result = runEngine(baseInput({ bridge, arena, pendingMatches: [pendingMatch("pm1", { p1: 3, p2: 1 })] }));
        expect(result).toBeNull();
    });

    it("admits a match through the tag filter when the mapping is known", async () => {
        const { bridge, captured } = capturingBridge();
        const arena = tenantArena({
            tenantId: null,
            membershipMode: null,
            filter: { game_ids: [], tag_ids: ["tag-1"], date_from: null, date_to: null },
        });
        const result = runEngine(
            baseInput({ bridge, arena, pendingMatches: [pendingMatch("pm1", { p1: 3, p2: 1 })], gameTags: () => ["tag-2", "tag-1"] }),
        );
        expect(result).not.toBeNull();
        expect(captured[0].matches).toHaveLength(1);
    });

    it("overlays pending match ops onto the replica rows", async () => {
        const { bridge, captured } = capturingBridge();
        const op: PendingOp = {
            entityId: "m1" as Base58ID,
            kind: "match",
            op: "update",
            status: "pending",
            createdAt: "2026-06-10T09:00:00Z",
            base: { game_id: "game-1", date: "2026-06-01T10:00:00Z", score: { p1: 10, p2: 5 } },
            patch: { game_id: "game-1", date: "2026-06-01T10:00:00Z", score: { p1: 2, p2: 9 } },
        };
        const result = runEngine(
            baseInput({
                bridge,
                matches: [replicaRow("m1", "2026-06-01T10:00:00Z", { p1: 10, p2: 5 })],
                matchOps: [op],
            }),
        );
        expect(result).not.toBeNull();
        expect(captured[0].matches).toEqual([{ id: "m1", date: "2026-06-01T10:00:00Z", scores: { p1: 2, p2: 9 } }]);
    });

    it("freezes market settlements and drops match rows from the ledger input", async () => {
        const { bridge, captured } = capturingBridge();
        runEngine(
            baseInput({
                bridge,
                pendingMatches: [pendingMatch("pm1", { p1: 3, p2: 1 })],
                marketRows: [
                    ledgerRow({ id: "match-row", discriminator: "match", match_id: "m9" }),
                    ledgerRow({ id: "mkt-row", discriminator: "market", market_id: "mk1", player_id: "p2", match_id: null }),
                ],
            }),
        );
        expect(captured[0].market_settlements).toHaveLength(1);
        expect(captured[0].market_settlements[0].id).toBe("mkt-row");
    });

    it("still replays matches the replica knows when only ops are pending", async () => {
        const { bridge, captured } = capturingBridge();
        const deleteLikeOp: PendingOp = {
            entityId: "m1" as Base58ID,
            kind: "match",
            op: "update",
            status: "pending",
            createdAt: "2026-06-10T09:00:00Z",
            base: { game_id: "game-1", date: "2026-06-01T10:00:00Z", score: { p1: 10, p2: 5 } },
            patch: { game_id: "game-1", date: "2026-06-02T10:00:00Z", score: { p1: 10, p2: 5 } },
        };
        const result = runEngine(
            baseInput({ bridge, matches: [replicaRow("m1", "2026-06-01T10:00:00Z", { p1: 10, p2: 5 })], matchOps: [deleteLikeOp] }),
        );
        expect(result).not.toBeNull();
        expect(captured[0].matches[0].date).toBe("2026-06-02T10:00:00Z");
    });
});

describe("arenaMembership", () => {
    it("admits every competitive match for a mode-all tenant arena", () => {
        expect(arenaMembership(tenantArena(), { date: "2026-06-01T10:00:00Z", gameId: "g", mode: "competitive" })).toBe(true);
    });

    it("excludes coop matches everywhere", () => {
        expect(arenaMembership(tenantArena(), { date: "2026-06-01T10:00:00Z", gameId: "g", mode: "coop" })).toBe(false);
        expect(
            arenaMembership(
                tenantArena({ tenantId: null, membershipMode: null, filter: { game_ids: [], tag_ids: [], date_from: null, date_to: null } }),
                { date: "2026-06-01T10:00:00Z", gameId: "g", mode: "coop" },
            ),
        ).toBe(false);
    });

    it("reports stint-based modes as unsupported (null)", () => {
        expect(arenaMembership(tenantArena({ membershipMode: "members_only" }), { date: "2026-06-01T10:00:00Z", gameId: "g", mode: "competitive" })).toBeNull();
    });

    // ── ADR-39: stint-based membership from the mirrored club stints ─────────

    type Stint = { player_id: string; joined_at: string | null; left_at: string | null };
    const stintContext = (stints: Stint[]): TenantMembershipContext => ({
        clubIds: ["club-1"],
        isMemberAt: (playerId, date) => {
            const at = Date.parse(date);
            for (const s of stints) {
                if (s.player_id !== playerId) continue;
                const joined = s.joined_at ? Date.parse(s.joined_at) : Number.NEGATIVE_INFINITY;
                const left = s.left_at ? Date.parse(s.left_at) : Number.POSITIVE_INFINITY;
                if (joined <= at && at < left) return true;
            }
            return false;
        },
    });
    const STINTS: Stint[] = [
        { player_id: "p1", joined_at: "2020-01-01T00:00:00Z", left_at: null },
        { player_id: "p2", joined_at: "2026-06-01T00:00:00Z", left_at: "2026-06-05T00:00:00Z" },
    ];

    it("any_member: admits when at least one participant was a member at the match date", () => {
        const arena = tenantArena({ membershipMode: "any_member" });
        const ctx = stintContext(STINTS);
        // p2's stint covers June 1st (joined) but not June 6th (left); p1 always.
        expect(arenaMembership(arena, { date: "2026-06-01T10:00:00Z", gameId: "g", mode: "competitive", playerIds: ["p2", "p9"] }, undefined, ctx)).toBe(true);
        expect(arenaMembership(arena, { date: "2026-06-06T10:00:00Z", gameId: "g", mode: "competitive", playerIds: ["p2", "p9"] }, undefined, ctx)).toBe(false);
        expect(arenaMembership(arena, { date: "2026-06-06T10:00:00Z", gameId: "g", mode: "competitive", playerIds: ["p1", "p9"] }, undefined, ctx)).toBe(true);
    });

    it("members_only: demands every participant be a member at the match date", () => {
        const arena = tenantArena({ membershipMode: "members_only" });
        const ctx = stintContext(STINTS);
        expect(arenaMembership(arena, { date: "2026-06-01T10:00:00Z", gameId: "g", mode: "competitive", playerIds: ["p1", "p2"] }, undefined, ctx)).toBe(true);
        expect(arenaMembership(arena, { date: "2026-06-01T10:00:00Z", gameId: "g", mode: "competitive", playerIds: ["p1", "p9"] }, undefined, ctx)).toBe(false);
    });

    it("honors the -infinity backfill (joined_at null) and the left_at boundary", () => {
        const arena = tenantArena({ membershipMode: "any_member" });
        const ctx = stintContext([{ player_id: "p1", joined_at: null, left_at: null }]);
        expect(arenaMembership(arena, { date: "2001-01-01T00:00:00Z", gameId: "g", mode: "competitive", playerIds: ["p1"] }, undefined, ctx)).toBe(true);
        // left_at is exclusive: a match at exactly left_at is already outside.
        const closing = stintContext([{ player_id: "p1", joined_at: "2020-01-01T00:00:00Z", left_at: "2026-06-05T00:00:00Z" }]);
        expect(arenaMembership(arena, { date: "2026-06-05T00:00:00Z", gameId: "g", mode: "competitive", playerIds: ["p1"] }, undefined, closing)).toBe(false);
        expect(arenaMembership(arena, { date: "2026-06-04T23:59:59Z", gameId: "g", mode: "competitive", playerIds: ["p1"] }, undefined, closing)).toBe(true);
    });

    it("degrades stint-based arenas while the stint mirror is cold", () => {
        const arena = tenantArena({ membershipMode: "any_member" });
        expect(arenaMembership(arena, { date: "2026-06-01T10:00:00Z", gameId: "g", mode: "competitive", playerIds: ["p1"] })).toBeNull();
        // An empty club list is equally unevaluable.
        expect(arenaMembership(arena, { date: "2026-06-01T10:00:00Z", gameId: "g", mode: "competitive", playerIds: ["p1"] }, undefined, { clubIds: [], isMemberAt: () => false })).toBeNull();
    });

    it("replays a stint-based tenant arena when the mirror is warm", () => {
        const { bridge, captured } = capturingBridge();
        const result = runEngine(
            baseInput({
                bridge,
                arena: tenantArena({ membershipMode: "any_member" }),
                pendingMatches: [pendingMatch("pm1", { p1: 3, p2: 1 })],
                tenantContext: stintContext(STINTS),
            }),
        );
        expect(result).not.toBeNull();
        expect(captured[0].matches.map((m) => m.id)).toEqual(["pm1"]);
    });

    it("skips the replay quietly while the settings history is not mirrored", () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
        const { bridge, captured } = capturingBridge();
        const result = runEngine(baseInput({ bridge, settings: [], pendingMatches: [pendingMatch("pm1", { p1: 3, p2: 1 })] }));
        expect(result).toBeNull();
        expect(captured).toHaveLength(0);
        expect(errorSpy).not.toHaveBeenCalled();
        expect(infoSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
        infoSpy.mockRestore();
    });

    // ── ADR-39: link-only flavors via the match replica's links ──────────────

    it("camp arenas admit exactly their linked matches", () => {
        const arena = tenantArena({ tenantId: null, membershipMode: null, filter: null, camp: true, id: "camp-1" });
        expect(arenaMembership(arena, { date: "2026-06-01T10:00:00Z", gameId: "g", mode: "competitive", campArenaIds: ["camp-1"] })).toBe(true);
        expect(arenaMembership(arena, { date: "2026-06-01T10:00:00Z", gameId: "g", mode: "competitive", campArenaIds: ["camp-2"] })).toBe(false);
        // Old pre-v6 rows carry no links; a refresh rewrites them (unlinked).
        expect(arenaMembership(arena, { date: "2026-06-01T10:00:00Z", gameId: "g", mode: "competitive" })).toBe(false);
    });

    it("tournament arenas admit exactly their bracket-linked matches", () => {
        const arena = tenantArena({ tenantId: null, membershipMode: null, filter: null, tournamentId: "t-1" });
        expect(arenaMembership(arena, { date: "2026-06-01T10:00:00Z", gameId: "g", mode: "competitive", tournamentId: "t-1" })).toBe(true);
        expect(arenaMembership(arena, { date: "2026-06-01T10:00:00Z", gameId: "g", mode: "competitive", tournamentId: "t-2" })).toBe(false);
        expect(arenaMembership(arena, { date: "2026-06-01T10:00:00Z", gameId: "g", mode: "competitive", tournamentId: null })).toBe(false);
    });

    it("replays a viewed camp arena from the replica links", () => {
        const { bridge, captured } = capturingBridge();
        const result = runEngine(
            baseInput({
                bridge,
                arena: { ...tenantArena({ tenantId: null, membershipMode: null, filter: null, camp: true }), id: "camp-1" },
                matches: [{ ...replicaRow("m1", "2026-06-01T10:00:00Z", { p1: 10, p2: 5 }), campArenaIds: ["camp-1"] }],
                // A pending offline match carries its camp links from the form.
                pendingMatches: [{ ...pendingMatch("pm1", { p1: 3, p2: 1 }), campArenaIds: ["camp-1" as Base58ID] }],
            }),
        );
        expect(result).not.toBeNull();
        expect(captured[0].matches.map((m) => m.id)).toEqual(["m1", "pm1"]);
    });

    it("applies an empty filter to every game", () => {
        const arena = tenantArena({ tenantId: null, membershipMode: null, filter: { game_ids: [], tag_ids: [], date_from: null, date_to: null } });
        expect(arenaMembership(arena, { date: "2026-06-01T10:00:00Z", gameId: "any", mode: "competitive" })).toBe(true);
    });

    it("applies the date window", () => {
        const arena = tenantArena({ tenantId: null, membershipMode: null, filter: { game_ids: [], tag_ids: [], date_from: "2026-06-05T00:00:00Z", date_to: "2026-06-20T00:00:00Z" } });
        expect(arenaMembership(arena, { date: "2026-06-10T10:00:00Z", gameId: "g", mode: "competitive" })).toBe(true);
        expect(arenaMembership(arena, { date: "2026-06-01T10:00:00Z", gameId: "g", mode: "competitive" })).toBe(false);
    });
});

describe("overlayMatchOps", () => {
    it("patches scores and dates of known rows", () => {
        const op: PendingOp = {
            entityId: "m1" as Base58ID,
            kind: "match",
            op: "update",
            status: "pending",
            createdAt: "2026-06-10T09:00:00Z",
            base: { score: { p1: 10, p2: 5 } },
            patch: { score: { p1: 4, p2: 6 } },
        };
        const rows = overlayMatchOps([replicaRow("m1", "2026-06-01T10:00:00Z", { p1: 10, p2: 5 })], [op]);
        expect(rows).toHaveLength(1);
        expect(rows[0].scores).toEqual({ p1: 4, p2: 6 });
    });

    it("materializes ops for matches the replica does not know", () => {
        const op: PendingOp = {
            entityId: "m-remote" as Base58ID,
            kind: "match",
            op: "update",
            status: "pending",
            createdAt: "2026-06-10T09:00:00Z",
            base: { game_id: "game-1", date: "2026-06-01T10:00:00Z", score: { p1: 10, p2: 5 } },
            patch: { score: { p1: 7, p2: 7 } },
        };
        const rows = overlayMatchOps([], [op]);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: "m-remote", gameId: "game-1", scores: { p1: 7, p2: 7 } });
    });

    it("leaves non-match ops alone", () => {
        const op: PendingOp = { entityId: "p1" as Base58ID, kind: "player", op: "update", createdAt: "2026-06-10T09:00:00Z", status: "pending", patch: { name: "x" } };
        const rows = overlayMatchOps([replicaRow("m1", "2026-06-01T10:00:00Z", { p1: 10, p2: 5 })], [op]);
        expect(rows[0].scores).toEqual({ p1: 10, p2: 5 });
    });
});
