// Durable storage of the offline queue (ADR-37): IndexedDB via Dexie replaces
// the localStorage JSON blob of ADR-16. The DB is a per-record store and a
// cross-tab change channel; the live truth for the sync engine stays the
// in-memory store mirror in OfflineContext (the engine's load/persist are
// synchronous by contract), so every write here is a full-snapshot replace —
// the same last-write-wins cross-tab semantics ADR-16 accepted, just durable.
//
// The tables are shaped for growth: players/games are the ADR-37 replica's
// future home (phase 6 moves them from fetch-land to this DB), matches follow
// with the feed replica. New tables and indexes join via a bumped version(),
// never by reshaping an existing store.
//
// The ratings replica (ADR-38) mirrors the raw material of the offline
// settlement replay: the arena's settlement ledger, its match history, the
// arena/settings documents and the elo-settings time series. The engine
// (lib/offline/ratings/) replays them through the wasm settlement core.

import Dexie, { type Table } from "dexie";
import type { OfflineStore, PendingGame, PendingMatch, PendingOp, PendingPlayer } from "./types";
import { emptyOfflineStore } from "./types";

/** One mirrored server entity: the minimum the name resolution layer needs. */
export type EntityRow = {
    id: string;
    name: string;
};

export type EntityKind = "player" | "game";

/** One mirrored arena_settlements ledger row (ADR-38) — the server wire shape
 * plus the arenaId the compound key indexes on (added by the mirror step). */
export type LedgerRow = {
    arenaId: string;
    id: string;
    player_id: string;
    date: string; // RFC3339
    rating_after: number;
    elo_after: number;
    discriminator: "match" | "market" | "market_guarantor";
    match_id?: string | null;
    market_id?: string | null;
    elo_staked: number;
    elo_earned: number;
    rating_staked: number;
    rating_earned: number;
    league?: string | null;
};

/** One mirrored match: the slim projection the replay and membership need. */
export type MatchReplicaRow = {
    id: string;
    date: string; // RFC3339
    gameId: string;
    mode: "competitive" | "coop";
    scores: Record<string, number>; // Base58 player id → score
    hasMarkets: boolean;
};

/** One mirrored arena document (the GET /arenas/{id} response, verbatim). */
export type ArenaDocRow = {
    arenaId: string;
    arena: Record<string, unknown>; // the wire Arena object as returned
    fetchedAt: string;
};

/** One mirrored arena players listing (the GET /arenas/{id}/players response). */
export type ArenaPlayersSnapshotRow = {
    arenaId: string;
    players: Record<string, unknown>[]; // the wire ArenaPlayer[] as returned
    fetchedAt: string;
};

/** One mirrored elo_settings time-series row (GET /settings/all). */
export type SettingsHistoryRow = {
    effective_date: string; // RFC3339 or "-infinity"
    elo_const_k: number;
    elo_const_d: number;
    starting_elo: number;
    win_reward: number;
    newbie_league_earned_min: number;
    newbie_league_earned_max: number;
    newbie_league_earned_tau: number;
    newbie_league_goal_gap: number;
    elite_league_matches_6months: number;
    elite_league_matches_2months: number;
};

/**
 * One mirrored match document (the tenant-scoped detail response, verbatim) —
 * the offline fallback behind the match view and the edit form. The slim
 * matchReplica rows (ADR-38) carry only what the settlement replay needs; the
 * form needs full fidelity (calculator_data, camps, tournament link), so the
 * detail read is written through per opened match, like arenaDocs. Editing a
 * match that was never mirrored stays online-only: a slim-replica prefill
 * would read camps as empty and a submit could wipe them server-side.
 */
export type MatchDocRow = {
    matchId: string;
    match: Record<string, unknown>; // the wire Match object as returned
    fetchedAt: string;
};

class OfflineDB extends Dexie {
    games!: Table<PendingGame, string>;
    players!: Table<PendingPlayer, string>;
    matches!: Table<PendingMatch, string>;
    // The server mirror of players/games (ADR-37 phase 6): the name
    // resolution layer that stays coherent across syncs and offline cold
    // starts. Matches join here with the future feed replica.
    entityPlayers!: Table<EntityRow, string>;
    entityGames!: Table<EntityRow, string>;
    // Edit/delete ops of saved entities (ADR-37 phase 7), keyed by the
    // entity id — one op per entity.
    ops!: Table<PendingOp, string>;
    // The ratings replica (ADR-38). Settlements key on [arenaId+id] (unique
    // per arena row) with a [arenaId+date+id] index for the (date, id)
    // replay order; matches are a global union (rows are shared across
    // tenants' views); the rest are one row per arena / one row per
    // effective date.
    arenaSettlements!: Table<LedgerRow, string>;
    matchReplica!: Table<MatchReplicaRow, string>;
    arenaDocs!: Table<ArenaDocRow, string>;
    arenaPlayers!: Table<ArenaPlayersSnapshotRow, string>;
    settingsHistory!: Table<SettingsHistoryRow, string>;
    matchDocs!: Table<MatchDocRow, string>;

    constructor() {
        super("elo-offline-v1");
        this.version(1).stores({
            games: "clientId",
            players: "clientId",
            matches: "clientId",
        });
        this.version(2).stores({
            games: "clientId",
            players: "clientId",
            matches: "clientId",
            entityPlayers: "id",
            entityGames: "id",
        });
        this.version(3).stores({
            games: "clientId",
            players: "clientId",
            matches: "clientId",
            entityPlayers: "id",
            entityGames: "id",
            ops: "entityId",
        });
        this.version(4).stores({
            games: "clientId",
            players: "clientId",
            matches: "clientId",
            entityPlayers: "id",
            entityGames: "id",
            ops: "entityId",
            arenaSettlements: "[arenaId+id], [arenaId+date+id]",
            matchReplica: "id, date",
            arenaDocs: "arenaId",
            arenaPlayers: "arenaId",
            settingsHistory: "effective_date",
        });
        this.version(5).stores({
            games: "clientId",
            players: "clientId",
            matches: "clientId",
            entityPlayers: "id",
            entityGames: "id",
            ops: "entityId",
            arenaSettlements: "[arenaId+id], [arenaId+date+id]",
            matchReplica: "id, date",
            arenaDocs: "arenaId",
            arenaPlayers: "arenaId",
            settingsHistory: "effective_date",
            matchDocs: "matchId",
        });
    }
}

// Lazy singleton: importing this module during the static-export prerender
// must not touch IndexedDB (it does not exist there), and tests open their own
// instance per run.
let instance: OfflineDB | null = null;
function db(): OfflineDB {
    if (!instance) instance = new OfflineDB();
    return instance;
}

function isBrowser() {
    return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

// ─── Legacy localStorage migration (ADR-16 → ADR-37) ─────────────────────────

const LEGACY_STORAGE_KEY = "offline-pending-v1";

// Backfills fields added after the initial offline store version, so older
// localStorage entries don't break the engine or the UI (ADR-16's additive
// rule — carried over verbatim, including the deliberate drops).
function normalizeLegacyPlayer(p: Partial<PendingPlayer>): PendingPlayer {
    const status = p.status ?? "pending";
    return {
        clientId: p.clientId!,
        createdAt: p.createdAt!,
        status,
        ...(status === "error" && typeof p.error === "string" ? { error: p.error } : {}),
        ...(status === "conflict" && Array.isArray(p.conflict) ? { conflict: p.conflict } : {}),
        name: p.name!,
        clubIds: p.clubIds ?? [],
    };
}

function normalizeLegacyMatch(m: Partial<PendingMatch>): PendingMatch {
    const status = m.status ?? "pending";
    return {
        clientId: m.clientId!,
        createdAt: m.createdAt!,
        status,
        ...(status === "error" && typeof m.error === "string" ? { error: m.error } : {}),
        ...(status === "conflict" && Array.isArray(m.conflict) ? { conflict: m.conflict } : {}),
        gameId: m.gameId!,
        score: m.score!,
        // Deliberately not mapped from the old `tournamentIds` field: camp
        // arena ids are a different keyspace than the removed tournament
        // ids (ADR-27), so queued tournaments are dropped.
        campArenaIds: m.campArenaIds ?? [],
        calculatorKind: m.calculatorKind ?? null,
        calculatorData: m.calculatorData ?? null,
    };
}

function normalizeLegacyGame(g: Partial<PendingGame>): PendingGame {
    const status = g.status ?? "pending";
    return {
        clientId: g.clientId!,
        createdAt: g.createdAt!,
        status,
        ...(status === "error" && typeof g.error === "string" ? { error: g.error } : {}),
        ...(status === "conflict" && Array.isArray(g.conflict) ? { conflict: g.conflict } : {}),
        name: g.name!,
        tagIds: g.tagIds ?? [],
        meta: g.meta,
    };
}

// Moves the localStorage queue of ADR-16 into Dexie once: items absent from
// the DB (or superseded there) land in it, then the legacy key is cleared.
// A corrupted legacy blob is dropped and the queue starts from whatever the
// DB already holds — same no-manual-repair stance as ADR-16.
async function migrateLegacyStore(): Promise<void> {
    if (!isBrowser()) return;
    let raw: string | null = null;
    try {
        raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    } catch {
        return;
    }
    if (!raw) return;
    let legacy: Partial<OfflineStore>;
    try {
        legacy = JSON.parse(raw) as Partial<OfflineStore>;
    } catch {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        return;
    }
    const legacyStore: OfflineStore = {
        players: (legacy.players ?? []).map(normalizeLegacyPlayer),
        matches: (legacy.matches ?? []).map(normalizeLegacyMatch),
        games: (legacy.games ?? []).map(normalizeLegacyGame),
    };
    await writeStore(legacyStore, { mergeIntoExisting: true });
    localStorage.removeItem(LEGACY_STORAGE_KEY);
}

// ─── Read / write ─────────────────────────────────────────────────────────────

// Per-kind helpers keep the Table types concrete — a union of tables breaks
// bulkPut's overload resolution. Unconstrained: ops are keyed by entityId.
async function replaceAll<T>(table: Table<T, string>, items: T[]) {
    await table.clear();
    await table.bulkPut(items);
}

async function mergeMissing<T extends { clientId: string }>(table: Table<T, string>, items: T[]) {
    const known = new Set(await table.toCollection().primaryKeys());
    await table.bulkPut(items.filter((i) => !known.has(i.clientId)));
}

/**
 * Reads the whole queue from IndexedDB, running the one-time localStorage
 * migration first. A DB that fails to open resolves empty (the queue starts
 * fresh) — IndexedDB failures are as rare as localStorage corruption was.
 * Exported as `loadOfflineStore` from OfflineContext for non-React observers
 * (the table-session's sync wait).
 */
export async function readStore(): Promise<OfflineStore> {
    if (!isBrowser()) return emptyOfflineStore();
    try {
        await migrateLegacyStore();
        const d = db();
        const [games, players, matches, ops] = await Promise.all([
            d.games.toArray(),
            d.players.toArray(),
            d.matches.toArray(),
            d.ops.toArray(),
        ]);
        return { games, players, matches, ops };
    } catch (err) {
        console.error("offline store read failed", err);
        return emptyOfflineStore();
    }
}

// Persist calls are serialized so concurrent writers (the sync engine
// persisting per item, user mutations, cross-tab adoption) land in call
// order — a full-snapshot replace from a stale snapshot must never finish
// after a newer one.
let writeChain: Promise<void> = Promise.resolve();
let pendingWrites = 0;

/**
 * Replaces the queue content with `store` in one transaction. Serialized
 * through the write chain; non-throwing — a failed write logs and leaves the
 * queue as-is (the in-memory mirror remains the live truth; IndexedDB write
 * failures are quota-level and rare).
 */
export function writeStore(
    store: OfflineStore,
    opts: { mergeIntoExisting?: boolean } = {},
): Promise<void> {
    if (!isBrowser()) return Promise.resolve();
    const run = async () => {
        const d = db();
        try {
            await d.transaction("rw", [d.games, d.players, d.matches, d.ops], async () => {
                if (opts.mergeIntoExisting) {
                    // Legacy migration: copy items the DB does not hold
                    // yet; existing records (already migrated) win.
                    await mergeMissing(d.games, store.games);
                    await mergeMissing(d.players, store.players);
                    await mergeMissing(d.matches, store.matches);
                } else {
                    await replaceAll(d.games, store.games);
                    await replaceAll(d.players, store.players);
                    await replaceAll(d.matches, store.matches);
                    await replaceAll(d.ops, store.ops ?? []);
                }
            });
        } catch (err) {
            console.error("offline store write failed", err);
        }
    };
    pendingWrites++;
    writeChain = writeChain.then(run).finally(() => {
        pendingWrites--;
    });
    return writeChain;
}

/**
 * Subscribes to queue changes from any tab (Dexie's liveQuery over the three
 * tables). The callback receives a fresh snapshot after every committed DB
 * change; the caller dedupes its own echoes by comparing against the live
 * mirror. Adoption is suppressed while this tab has writes in flight — the
 * flush will converge the DB to the mirror and re-fire.
 */
export function subscribeStore(cb: (store: OfflineStore) => void): () => void {
    if (!isBrowser()) return () => {};
    let stopped = false;
    const d = db();
    // liveQuery re-runs the querier on every committed change to these tables
    // and emits the fresh snapshot.
    const subscription = Dexie.liveQuery(async () => {
        const [games, players, matches, ops] = await Promise.all([
            d.games.toArray(),
            d.players.toArray(),
            d.matches.toArray(),
            d.ops.toArray(),
        ]);
        return { games, players, matches, ops };
    }).subscribe({
        next: (store) => {
            if (!stopped && store) cb(store);
        },
        // DB-level failures surface on the next read/write; the queue keeps
        // working from the mirror.
        error: () => {},
    });
    return () => {
        stopped = true;
        subscription.unsubscribe();
    };
}

/** True while a write of this tab is queued or running (adoption gate). */
export function hasPendingWrites(): boolean {
    return pendingWrites > 0;
}

// ─── Entity replica (ADR-37 phase 6) ─────────────────────────────────────────

// The replica replaces wholesale per kind: it mirrors the server's full list,
// so removed-elsewhere entities disappear on the next pull.
function entityTable(d: OfflineDB, kind: EntityKind): Table<EntityRow, string> {
    return kind === "player" ? d.entityPlayers : d.entityGames;
}

/**
 * Replaces the mirrored rows of one kind (the provider's successful fetch or
 * the post-sync pull). Serialized through the same chain as the queue writes.
 */
export function writeEntities(kind: EntityKind, items: EntityRow[]): Promise<void> {
    if (!isBrowser()) return Promise.resolve();
    const run = async () => {
        const d = db();
        try {
            const table = entityTable(d, kind);
            await d.transaction("rw", table, async () => {
                await table.clear();
                await table.bulkPut(items);
            });
        } catch (err) {
            console.error(`entity replica write failed (${kind})`, err);
        }
    };
    pendingWrites++;
    writeChain = writeChain.then(run).finally(() => {
        pendingWrites--;
    });
    return writeChain;
}

/**
 * Reads one kind of the replica. Never throws — a failed read resolves empty
 * (name resolution degrades to the live lists).
 */
export async function readEntities(kind: EntityKind): Promise<EntityRow[]> {
    if (!isBrowser()) return [];
    try {
        return await entityTable(db(), kind).toArray();
    } catch {
        return [];
    }
}

/**
 * Subscribes to replica changes of both kinds (Dexie liveQuery). The callback
 * receives fresh maps after every committed write — the resolution layer
 * reacts to pulls and provider fetches without any manual invalidation.
 */
export function subscribeEntities(
    cb: (players: Map<string, string>, games: Map<string, string>) => void,
): () => void {
    if (!isBrowser()) return () => {};
    let stopped = false;
    const d = db();
    const subscription = Dexie.liveQuery(async () => {
        const [players, games] = await Promise.all([d.entityPlayers.toArray(), d.entityGames.toArray()]);
        return {
            players: new Map(players.map((p) => [p.id, p.name])),
            games: new Map(games.map((g) => [g.id, g.name])),
        };
    }).subscribe({
        next: (maps) => {
            if (!stopped && maps) cb(maps.players, maps.games);
        },
        error: () => {},
    });
    return () => {
        stopped = true;
        subscription.unsubscribe();
    };
}

// ─── Ratings replica (ADR-38) ─────────────────────────────────────────────────
//
// Mirrors the raw material of the offline settlement replay: the arena's
// settlement ledger, its match history, arena/settings documents and the
// elo-settings time series. Writes go through the same serialized chain as
// the queue; reads never throw (the engine degrades to "no offline values").

/**
 * Replaces one arena's mirrored ledger rows (the settlement endpoint's page
 * drain). Serialized through the write chain; non-throwing.
 */
export function writeArenaSettlements(arenaId: string, rows: LedgerRow[]): Promise<void> {
    if (!isBrowser()) return Promise.resolve();
    const run = async () => {
        const d = db();
        try {
            await d.transaction("rw", d.arenaSettlements, async () => {
                await d.arenaSettlements
                    .where("[arenaId+id]")
                    .between([arenaId, Dexie.minKey], [arenaId, Dexie.maxKey])
                    .delete();
                await d.arenaSettlements.bulkPut(rows.map((r) => ({ ...r, arenaId })));
            });
        } catch (err) {
            console.error("arena settlements replica write failed", err);
        }
    };
    pendingWrites++;
    writeChain = writeChain.then(run).finally(() => {
        pendingWrites--;
    });
    return writeChain;
}

/**
 * Merges match rows into the replica (bulkPut union — matches are shared
 * across tenants' views and never deleted server-side). Non-throwing.
 */
export function writeMatchReplica(rows: MatchReplicaRow[]): Promise<void> {
    if (!isBrowser() || rows.length === 0) return Promise.resolve();
    const run = async () => {
        const d = db();
        try {
            await d.matchReplica.bulkPut(rows);
        } catch (err) {
            console.error("match replica write failed", err);
        }
    };
    pendingWrites++;
    writeChain = writeChain.then(run).finally(() => {
        pendingWrites--;
    });
    return writeChain;
}

/** Stores one arena document (the arena view's write-through). Non-throwing. */
export function writeArenaDoc(arena: Record<string, unknown>, arenaId: string): Promise<void> {
    if (!isBrowser()) return Promise.resolve();
    const row: ArenaDocRow = { arenaId, arena, fetchedAt: new Date().toISOString() };
    const run = async () => {
        const d = db();
        try {
            await d.arenaDocs.put(row);
        } catch (err) {
            console.error("arena doc replica write failed", err);
        }
    };
    pendingWrites++;
    writeChain = writeChain.then(run).finally(() => {
        pendingWrites--;
    });
    return writeChain;
}

/** Stores one arena players snapshot (the arena view's write-through). */
export function writeArenaPlayersSnapshot(arenaId: string, players: Record<string, unknown>[]): Promise<void> {
    if (!isBrowser()) return Promise.resolve();
    const row: ArenaPlayersSnapshotRow = { arenaId, players, fetchedAt: new Date().toISOString() };
    const run = async () => {
        const d = db();
        try {
            await d.arenaPlayers.put(row);
        } catch (err) {
            console.error("arena players snapshot write failed", err);
        }
    };
    pendingWrites++;
    writeChain = writeChain.then(run).finally(() => {
        pendingWrites--;
    });
    return writeChain;
}

/** Stores one match document (the detail read's write-through). Non-throwing. */
export function writeMatchDoc(match: Record<string, unknown>, matchId: string): Promise<void> {
    if (!isBrowser()) return Promise.resolve();
    const row: MatchDocRow = { matchId, match, fetchedAt: new Date().toISOString() };
    const run = async () => {
        const d = db();
        try {
            await d.matchDocs.put(row);
        } catch (err) {
            console.error("match doc replica write failed", err);
        }
    };
    pendingWrites++;
    writeChain = writeChain.then(run).finally(() => {
        pendingWrites--;
    });
    return writeChain;
}

/**
 * Stores one match document only when the mirror holds nothing for it yet —
 * the list-row write-through. List rows omit calculator_data, so they must
 * never overwrite a full detail mirror (a downgraded mirror would offline-edit
 * a calculator match from empty state); a detail fetch always puts verbatim.
 */
export function writeMatchDocIfAbsent(match: Record<string, unknown>, matchId: string): Promise<void> {
    if (!isBrowser()) return Promise.resolve();
    const run = async () => {
        const d = db();
        try {
            const known = await d.matchDocs.get(matchId);
            if (known) return;
            await d.matchDocs.put({ matchId, match, fetchedAt: new Date().toISOString() });
        } catch (err) {
            console.error("match doc replica write failed", err);
        }
    };
    pendingWrites++;
    writeChain = writeChain.then(run).finally(() => {
        pendingWrites--;
    });
    return writeChain;
}

/** Reads one mirrored match document; null when absent. Never throws. */
export async function readMatchDoc(matchId: string): Promise<Record<string, unknown> | null> {
    if (!isBrowser()) return null;
    try {
        const row = await db().matchDocs.get(matchId);
        return row?.match ?? null;
    } catch (err) {
        console.error("match doc replica read failed", err);
        return null;
    }
}

/** Replaces the mirrored elo-settings history (GET /settings/all). */
export function writeSettingsHistory(rows: SettingsHistoryRow[]): Promise<void> {
    if (!isBrowser()) return Promise.resolve();
    const run = async () => {
        const d = db();
        try {
            await d.transaction("rw", d.settingsHistory, async () => {
                await replaceAll(d.settingsHistory, rows);
            });
        } catch (err) {
            console.error("settings history replica write failed", err);
        }
    };
    pendingWrites++;
    writeChain = writeChain.then(run).finally(() => {
        pendingWrites--;
    });
    return writeChain;
}

/** The ratings replica snapshot the engine and providers consume. */
export type RatingsReplicaSnapshot = {
    settlements: Map<string, LedgerRow[]>; // per arena, (date, id) ascending
    matches: MatchReplicaRow[];
    arenaDocs: Map<string, Record<string, unknown>>;
    arenaPlayers: Map<string, Record<string, unknown>[]>;
    settings: SettingsHistoryRow[];
    ready: boolean;
};

function emptyRatingsSnapshot(): RatingsReplicaSnapshot {
    return {
        settlements: new Map(),
        matches: [],
        arenaDocs: new Map(),
        arenaPlayers: new Map(),
        settings: [],
        ready: false,
    };
}

async function readRatingsSnapshot(): Promise<RatingsReplicaSnapshot> {
    const d = db();
    const [settlements, matches, docs, players, settings] = await Promise.all([
        d.arenaSettlements.toArray(),
        d.matchReplica.toArray(),
        d.arenaDocs.toArray(),
        d.arenaPlayers.toArray(),
        d.settingsHistory.toArray(),
    ]);
    const byArena = new Map<string, LedgerRow[]>();
    for (const row of settlements) {
        const list = byArena.get(row.arenaId);
        if (list) list.push(row);
        else byArena.set(row.arenaId, [row]);
    }
    // The [arenaId+date+id] index order is what the replay wants; the plain
    // toArray reads back by primary key, so order per arena here.
    for (const list of byArena.values()) {
        list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }
    matches.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return {
        settlements: byArena,
        matches,
        arenaDocs: new Map(docs.map((d) => [d.arenaId, d.arena])),
        arenaPlayers: new Map(players.map((p) => [p.arenaId, p.players])),
        settings,
        ready: true,
    };
}

/**
 * Reads the whole ratings replica once (the provider's initial state).
 * Never throws — a failed read resolves an empty, ready snapshot.
 */
export async function readRatingsReplica(): Promise<RatingsReplicaSnapshot> {
    if (!isBrowser()) return emptyRatingsSnapshot();
    try {
        return await readRatingsSnapshot();
    } catch (err) {
        console.error("ratings replica read failed", err);
        return emptyRatingsSnapshot();
    }
}

/**
 * Subscribes to ratings-replica changes (Dexie liveQuery across the five
 * tables). The callback receives a fresh snapshot after every committed
 * write — hydration drains, write-throughs, cross-tab echoes.
 */
export function subscribeRatingsReplica(cb: (snapshot: RatingsReplicaSnapshot) => void): () => void {
    if (!isBrowser()) return () => {};
    let stopped = false;
    const subscription = Dexie.liveQuery(readRatingsSnapshot).subscribe({
        next: (snapshot) => {
            if (!stopped && snapshot) cb(snapshot);
        },
        error: () => {},
    });
    return () => {
        stopped = true;
        subscription.unsubscribe();
    };
}

/** Reads one arena's mirrored players snapshot, or null when none. */
export async function readArenaPlayersSnapshot(arenaId: string): Promise<Record<string, unknown>[] | null> {
    if (!isBrowser()) return null;
    try {
        const row = await db().arenaPlayers.get(arenaId);
        return row?.players ?? null;
    } catch {
        return null;
    }
}

/** Reads one arena's mirrored document, or null when none. */
export async function readArenaDoc(arenaId: string): Promise<Record<string, unknown> | null> {
    if (!isBrowser()) return null;
    try {
        return (await db().arenaDocs.get(arenaId))?.arena ?? null;
    } catch {
        return null;
    }
}
