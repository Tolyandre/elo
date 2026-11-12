// @vitest-environment jsdom
// Dexie layer of the offline queue (ADR-37): legacy localStorage migration,
// full-snapshot writes, and the cross-tab subscription.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    readArenaDoc,
    readArenaPlayersSnapshot,
    readEntities,
    readRatingsReplica,
    readStore,
    subscribeEntities,
    subscribeRatingsReplica,
    subscribeStore,
    writeArenaDoc,
    writeArenaPlayersSnapshot,
    writeArenaSettlements,
    writeEntities,
    writeMatchReplica,
    writeSettingsHistory,
    writeStore,
    type LedgerRow,
    type MatchReplicaRow,
    type RatingsReplicaSnapshot,
} from "@/lib/offline/db";
import { emptyOfflineStore } from "@/lib/offline/types";
import type { OfflineStore, PendingMatch, PendingPlayer } from "@/lib/offline/types";

const LEGACY_KEY = "offline-pending-v1";

const legacyPlayer: PendingPlayer = {
    clientId: "pl1" as PendingPlayer["clientId"],
    createdAt: "2026-01-01T09:00:00Z",
    status: "pending",
    name: "Вася",
    clubIds: [],
};

const legacyMatch: PendingMatch = {
    clientId: "m1" as PendingMatch["clientId"],
    createdAt: "2026-01-01T10:00:00Z",
    status: "pending",
    gameId: "g1" as PendingMatch["gameId"],
    score: { pl1: 10 },
    campArenaIds: [],
};

beforeEach(async () => {
    localStorage.clear();
    // Reset the shared Dexie DB between tests.
    await writeStore(emptyOfflineStore());
});

describe("offline db (ADR-37)", () => {
    it("migrates the legacy localStorage store into IndexedDB once", async () => {
        localStorage.setItem(
            LEGACY_KEY,
            JSON.stringify({ players: [legacyPlayer], matches: [legacyMatch], games: [] }),
        );

        const store = await readStore();
        expect(store.players).toHaveLength(1);
        expect(store.players[0].name).toBe("Вася");
        // ADR-16's loader backfill carried over: clubIds defaulted.
        expect(store.players[0].clubIds).toEqual([]);
        expect(store.matches).toHaveLength(1);
        expect(localStorage.getItem(LEGACY_KEY)).toBeNull();

        // The second read is stable (no re-migration, no duplication).
        const again = await readStore();
        expect(again.players.map((p) => p.clientId)).toEqual(store.players.map((p) => p.clientId));
    });

    it("keeps already-migrated records over legacy copies of the same id", async () => {
        // The DB already holds the player (a previous tab migrated it first).
        await writeStore({ games: [], matches: [], players: [{ ...legacyPlayer, name: "Новое имя" }] });
        localStorage.setItem(
            LEGACY_KEY,
            JSON.stringify({ players: [legacyPlayer], matches: [], games: [] }),
        );

        const store = await readStore();
        expect(store.players).toHaveLength(1);
        expect(store.players[0].name).toBe("Новое имя");
        expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    });

    it("replaces the whole queue on write: removed records are deleted", async () => {
        await writeStore({ games: [], matches: [legacyMatch], players: [legacyPlayer] });
        let store = await readStore();
        expect(store.matches).toHaveLength(1);
        expect(store.players).toHaveLength(1);

        const next: OfflineStore = { games: [], matches: [], players: [] };
        await writeStore(next);
        store = await readStore();
        expect(store).toEqual(emptyOfflineStore());
    });

    it("drops a corrupted legacy blob instead of failing the read", async () => {
        localStorage.setItem(LEGACY_KEY, "not-json{");
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const store = await readStore();
        expect(store).toEqual(emptyOfflineStore());
        expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
        errSpy.mockRestore();
    });

    it("notifies subscribers of committed writes (the cross-tab channel)", async () => {
        const seen: OfflineStore[] = [];
        const stop = subscribeStore((store) => seen.push(store));

        await writeStore({ games: [], matches: [legacyMatch], players: [] });
        await new Promise((r) => setTimeout(r, 50));

        stop();
        expect(seen.length).toBeGreaterThan(0);
        expect(seen[seen.length - 1].matches.map((m) => m.clientId)).toEqual(["m1"]);
    });
});

describe("entity replica (ADR-37 phase 6)", () => {
    it("replaces rows per kind: removed-elsewhere entities disappear", async () => {
        await writeEntities("player", [{ id: "p1", name: "Вася" }, { id: "p2", name: "Петя" }]);
        await writeEntities("game", [{ id: "g1", name: "Шахматы" }]);
        expect(await readEntities("player")).toEqual([{ id: "p1", name: "Вася" }, { id: "p2", name: "Петя" }]);
        expect(await readEntities("game")).toEqual([{ id: "g1", name: "Шахматы" }]);

        await writeEntities("player", [{ id: "p1", name: "Вася (новый)" }]);
        expect(await readEntities("player")).toEqual([{ id: "p1", name: "Вася (новый)" }]);
        // The other kind is untouched.
        expect(await readEntities("game")).toEqual([{ id: "g1", name: "Шахматы" }]);
    });

    it("notifies subscribers of replica writes", async () => {
        const seen: Array<{ players: Map<string, string> }> = [];
        const stop = subscribeEntities((players) => seen.push({ players }));

        await writeEntities("player", [{ id: "p1", name: "Вася" }]);
        await new Promise((r) => setTimeout(r, 50));

        stop();
        expect(seen.length).toBeGreaterThan(0);
        expect(seen[seen.length - 1].players.get("p1")).toBe("Вася");
    });
});

// ─── Ratings replica (ADR-38) ─────────────────────────────────────────────────

describe("ratings replica (ADR-38)", () => {
    const ledgerRow = (arenaId: string, id: string, date: string, discriminator: LedgerRow["discriminator"] = "match") => ({
        arenaId,
        id,
        player_id: "p1",
        date,
        rating_after: 1000,
        elo_after: 1000,
        discriminator,
        match_id: discriminator === "match" ? "m1" : null,
        market_id: discriminator === "match" ? null : "mk1",
        elo_staked: -10,
        elo_earned: 20,
        rating_staked: -10,
        rating_earned: 20,
        league: null,
    });

    it("replaces one arena's settlements wholesale and orders the read by (date, id)", async () => {
        await writeArenaSettlements("a1", [
            ledgerRow("a1", "s2", "2026-06-02T00:00:00Z"),
            ledgerRow("a1", "s1", "2026-06-01T00:00:00Z"),
        ]);
        // A second write with a new page set replaces the arena's rows.
        await writeArenaSettlements("a1", [ledgerRow("a1", "s3", "2026-06-03T00:00:00Z")]);
        // Another arena's rows coexist.
        await writeArenaSettlements("a2", [ledgerRow("a2", "s1", "2026-06-01T00:00:00Z")]);

        const snapshot = await readRatingsReplica();
        expect(snapshot.ready).toBe(true);
        expect(snapshot.settlements.get("a1")?.map((r) => r.id)).toEqual(["s3"]);
        expect(snapshot.settlements.get("a2")?.map((r) => r.id)).toEqual(["s1"]);
    });

    it("unions match rows across writes (matches are shared between tenants)", async () => {
        const row = (id: string, date: string): MatchReplicaRow => ({
            id,
            date,
            gameId: "g1",
            mode: "competitive",
            scores: { p1: 10, p2: 5 },
            hasMarkets: false,
        });
        await writeMatchReplica([row("m1", "2026-06-01T00:00:00Z")]);
        await writeMatchReplica([row("m1", "2026-06-01T00:00:00Z"), row("m2", "2026-06-02T00:00:00Z")]);

        const snapshot = await readRatingsReplica();
        expect(snapshot.matches.map((m) => m.id)).toEqual(["m1", "m2"]);
    });

    it("replaces the settings history and mirrors arena docs + player snapshots", async () => {
        await writeSettingsHistory([{
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
        }]);
        await writeSettingsHistory([{
            effective_date: "2026-01-01T00:00:00Z",
            elo_const_k: 24,
            elo_const_d: 400,
            starting_elo: 1000,
            win_reward: 1,
            newbie_league_earned_min: 2,
            newbie_league_earned_max: 64,
            newbie_league_earned_tau: 100,
            newbie_league_goal_gap: 16,
            elite_league_matches_6months: 20,
            elite_league_matches_2months: 3,
        }]);
        await writeArenaDoc({ id: "a1", name: "Арена" }, "a1");
        await writeArenaPlayersSnapshot("a1", [{ player_id: "p1", rating: 1000 }]);

        const snapshot = await readRatingsReplica();
        expect(snapshot.settings.map((s) => s.elo_const_k)).toEqual([24]);
        expect(snapshot.arenaDocs.get("a1")).toMatchObject({ id: "a1", name: "Арена" });
        expect(snapshot.arenaPlayers.get("a1")).toHaveLength(1);
        expect(await readArenaDoc("a1")).toMatchObject({ name: "Арена" });
        expect(await readArenaDoc("missing")).toBeNull();
        expect(await readArenaPlayersSnapshot("a1")).toHaveLength(1);
    });

    it("notifies subscribers of replica writes", async () => {
        const seen: RatingsReplicaSnapshot[] = [];
        const unsubscribe = subscribeRatingsReplica((snapshot) => seen.push(snapshot));
        await writeArenaDoc({ id: "a1" }, "a1");
        // liveQuery fires asynchronously.
        await new Promise((resolve) => setTimeout(resolve, 50));
        unsubscribe();

        expect(seen.length).toBeGreaterThan(0);
        expect(seen[seen.length - 1].arenaDocs.get("a1")).toMatchObject({ id: "a1" });
    });
});
