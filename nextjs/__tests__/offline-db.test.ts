// @vitest-environment jsdom
// Dexie layer of the offline queue (ADR-37): legacy localStorage migration,
// full-snapshot writes, and the cross-tab subscription.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    readEntities,
    readMatchDoc,
    readStore,
    subscribeEntities,
    subscribeStore,
    writeEntities,
    writeMatchDoc,
    writeMatchDocIfAbsent,
    writeStore,
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

// ─── Match document mirror ───────────────────────────────────────────────────

describe("match document mirror", () => {
    it("mirrors match documents per id — the offline view/edit fallback", async () => {
        const match = { id: "m1", game_id: "g1", score: { p1: { score: 10 } }, calculator_kind: null };
        await writeMatchDoc(match as Record<string, unknown>, "m1");
        // A re-fetch of the same match replaces its mirror.
        await writeMatchDoc({ ...match, score: { p1: { score: 20 } } } as Record<string, unknown>, "m1");

        expect(await readMatchDoc("m1")).toMatchObject({ score: { p1: { score: 20 } } });
        expect(await readMatchDoc("missing")).toBeNull();
    });

    it("never lets a list-row mirror overwrite a full detail mirror", async () => {
        // The detail mirror lands first (full fidelity), then a list row for the
        // same match (no calculator_data) must not degrade it.
        await writeMatchDoc({ id: "m1", calculator_kind: "skull-king", calculator_data: { round: 3 } }, "m1");
        await writeMatchDocIfAbsent({ id: "m1", calculator_kind: "skull-king" }, "m1");
        expect(await readMatchDoc("m1")).toMatchObject({ calculator_data: { round: 3 } });

        // An empty slot does take the list row (the offline view still renders).
        await writeMatchDocIfAbsent({ id: "m2", calculator_kind: null }, "m2");
        expect(await readMatchDoc("m2")).toMatchObject({ id: "m2" });
    });
});
