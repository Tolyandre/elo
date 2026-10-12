import { Base58ID } from "../id";
import type { GameMode, MatchMode } from "../game-modes";
import {
    OfflineStore,
    PendingGame,
    PendingMatch,
    PendingPlayer,
} from "./types";

// API calls return a discriminated result for HTTP errors and THROW only on
// network failure, so the engine can tell "server rejected this item" (keep it
// with an error badge) from "no network" (abort, everything stays pending).
export type SyncCallResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

export type SyncApi = {
    createGame(body: {
        id: Base58ID;
        name: string;
        name_en?: string | null;
        name_ru?: string | null;
        bgg_ref?: number | null;
        tesera_ref?: number | null;
        game_mode?: GameMode;
    }): Promise<SyncCallResult<{ id: Base58ID }>>;
    addGameTag(body: { game_id: Base58ID; tag_id: Base58ID }): Promise<SyncCallResult<null>>;
    createPlayer(body: { id: Base58ID; name: string }): Promise<SyncCallResult<{ id: Base58ID }>>;
    addClubMember(body: { club_id: Base58ID; player_id: Base58ID }): Promise<SyncCallResult<null>>;
    addMatch(body: {
        /**
         * The owning tenant (ADR-36 phase 7), captured at submit time. Null
         * for legacy items from before the field existed — the impl resolves
         * its fallback or rejects the item.
         */
        tenant: Base58ID | null;
        id: Base58ID;
        game_id: Base58ID;
        score: Record<string, number>;
        date: string;
        camp_arena_ids: Base58ID[];
        skip_tournament_link?: boolean;
        // Coop match fields (ADR-33).
        mode?: MatchMode;
        player_ids?: Base58ID[];
        game_score?: number;
        game_won?: boolean;
        calculator_kind?: string | null;
        calculator_data?: Record<string, unknown> | null;
    }): Promise<SyncCallResult<{ id: Base58ID }>>;
};

export type SyncOutcome = {
    store: OfflineStore;
    /** 401 received — JWT expired, user must log in again; remaining items stay pending. */
    authRequired: boolean;
    /** Network failure interrupted the run; remaining items stay pending. */
    aborted: boolean;
    /** Number of items successfully written to the server. */
    syncedCount: number;
};

type PendingItem = PendingGame | PendingPlayer | PendingMatch;

function byCreatedAt<T extends { createdAt: string }>(a: T, b: T): number {
    return a.createdAt.localeCompare(b.createdAt);
}

/** Clamp a client timestamp to "now" so a fast device clock can't produce a future date. */
function clampToNow(iso: string, now: Date): string {
    const t = new Date(iso);
    return t.getTime() > now.getTime() ? now.toISOString() : iso;
}

/**
 * Reads the queue as persisted right now (localStorage in the app). The engine
 * re-reads it before every send and every persist, so changes that land while a
 * run is in flight — items queued in this or another tab, items the user
 * deleted — are respected instead of being overwritten by the run's snapshot.
 */
export type SyncLoad = () => OfflineStore;

/**
 * True when the live store holds queued items this run never saw (queued while
 * the run was in flight). The provider drains them with a follow-up sync: the
 * health probe's syncNow was a guarded no-op during the run, and nothing
 * re-triggers the probe after a healthy run.
 */
export function hasNewArrivals(live: OfflineStore, seenIds: ReadonlySet<Base58ID>): boolean {
    return (
        live.games.some((i) => !seenIds.has(i.clientId)) ||
        live.players.some((i) => !seenIds.has(i.clientId)) ||
        live.matches.some((i) => !seenIds.has(i.clientId))
    );
}

/** Client ids the engine has written to the server and removed from its copy. */
type RemovedIds = Record<keyof OfflineStore, Set<Base58ID>>;

/**
 * The queue guarantees an item survives until the server accepts it or the user
 * deletes it — including while a sync is running. The engine therefore never
 * persists its snapshot bare: every write is the engine's copy merged over the
 * live store, item by item:
 *
 * - managed by the engine and still in the live store → the engine's copy wins
 *   (its status transition is authoritative and its content is what gets sent);
 * - managed by the engine but gone from the live store → the user deleted it
 *   mid-run; the delete wins, the item is not resurrected;
 * - present only in the live store → queued while the run was in flight (this
 *   or another tab) — kept through every engine write, the lost-newest-match
 *   fix;
 * - already synced (in `removed`) but still seen in a live read → stays
 *   removed, a stale live read cannot resurrect it.
 */
function mergeKind<T extends PendingItem>(engine: T[], live: T[], removed: Set<Base58ID>): T[] {
    const liveIds = new Set(live.map((i) => i.clientId));
    const managed = engine.filter((i) => liveIds.has(i.clientId));
    const managedIds = new Set(managed.map((i) => i.clientId));
    const added = live.filter((i) => !managedIds.has(i.clientId) && !removed.has(i.clientId));
    return [...managed, ...added];
}

function mergeWithLive(engine: OfflineStore, live: OfflineStore, removed: RemovedIds): OfflineStore {
    return {
        games: mergeKind(engine.games, live.games, removed.games),
        players: mergeKind(engine.players, live.players, removed.players),
        matches: mergeKind(engine.matches, live.matches, removed.matches),
    };
}

/**
 * Pushes pending games, then players, then matches (each in creation order) to the server.
 * Pending games/players already carry their final UUIDv7 id, which is sent as the `id`
 * field of each create request — no clientId rewriting is needed.
 *
 * The engine's snapshot is its send list, not the truth about the store: `load`
 * re-reads the live queue before every send and every persist, and each persist
 * writes the engine's copy merged over it (see mergeWithLive). `persist` still
 * fires after every state change so progress survives interruption.
 */
export async function syncOffline(
    initial: OfflineStore,
    api: SyncApi,
    persist: (store: OfflineStore) => void,
    load: SyncLoad = () => initial,
    now: () => Date = () => new Date(),
): Promise<SyncOutcome> {
    let store: OfflineStore = {
        games: [...initial.games].sort(byCreatedAt),
        players: [...initial.players].sort(byCreatedAt),
        matches: [...initial.matches].sort(byCreatedAt),
    };
    const removed: RemovedIds = { games: new Set(), players: new Set(), matches: new Set() };
    let syncedCount = 0;

    const update = (next: OfflineStore): OfflineStore => {
        store = next;
        const merged = mergeWithLive(store, load(), removed);
        persist(merged);
        return merged;
    };

    const finish = (authRequired: boolean, aborted: boolean): SyncOutcome => {
        // Nothing is in flight anymore — items interrupted by a network failure
        // or a 401 go back to pending.
        const merged = update({
            games: store.games.map(resetSyncing),
            players: store.players.map(resetSyncing),
            matches: store.matches.map(resetSyncing),
        });
        return { store: merged, authRequired, aborted, syncedCount };
    };

    // 1. Games — create, then apply tags. The game create is idempotent on id
    // and AddGameTag is ON CONFLICT DO NOTHING, so a network failure after
    // either step is safe to retry: re-running resends the same game id (a
    // no-op upsert) and re-adds the same tags (no-ops).
    for (const item of [...store.games]) {
        // Deleted from the queue while the run was in flight (this or another
        // tab) — the delete wins: drop it without sending. A delete landing
        // while the item's own request is already in flight can still land
        // server-side; that narrow window is inherent.
        if (!load().games.some((g) => g.clientId === item.clientId)) {
            update({ ...store, games: store.games.filter((g) => g.clientId !== item.clientId) });
            continue;
        }
        markSyncing(update, store, "games", item.clientId);
        let result: SyncCallResult<{ id: Base58ID }>;
        try {
            const meta = item.meta;
            // Queued items saved before the nameOriginal → nameEn rename still
            // carry the old key; read both so their English title survives.
            const legacy = meta as { nameOriginal?: string | null } | undefined;
            result = await api.createGame({
                id: item.clientId,
                name: item.name,
                name_en: meta?.nameEn ?? legacy?.nameOriginal ?? undefined,
                name_ru: meta?.nameRu ?? undefined,
                bgg_ref: meta?.bggRef ?? undefined,
                tesera_ref: meta?.teseraRef ?? undefined,
                game_mode: meta?.gameMode ?? undefined,
            });
        } catch {
            return finish(false, true);
        }
        if (!result.ok) {
            if (result.status === 401) return finish(true, false);
            markError(update, store, "games", item.clientId, result.message);
            continue;
        }
        syncedCount++;
        // Apply tags before removing the game so a failure here leaves the game
        // pending (retryable) rather than silently losing them.
        const tagIds = item.tagIds ?? [];
        let tagError: string | null = null;
        for (const tagId of tagIds) {
            let tagResult: SyncCallResult<null>;
            try {
                tagResult = await api.addGameTag({ game_id: item.clientId, tag_id: tagId });
            } catch {
                // Network died mid-tag — keep the game pending so the remaining
                // tags are retried on the next sync.
                return finish(false, true);
            }
            if (!tagResult.ok) {
                if (tagResult.status === 401) return finish(true, false);
                tagError = tagResult.message;
            }
        }
        if (tagError) {
            // A server-rejected tag (e.g. tag deleted elsewhere) — surface it
            // but keep the game pending so the error is visible.
            markError(update, store, "games", item.clientId, tagError);
        } else {
            removed.games.add(item.clientId);
            update({ ...store, games: store.games.filter((g) => g.clientId !== item.clientId) });
        }
    }

    // 2. Players — create, then apply club memberships. The player create is
    // idempotent on id and AddClubMember is ON CONFLICT DO NOTHING, so a network
    // failure after either step is safe to retry: re-running resends the same
    // player id (a no-op upsert) and re-adds the same memberships (no-ops).
    for (const item of [...store.players]) {
        if (!load().players.some((p) => p.clientId === item.clientId)) {
            update({ ...store, players: store.players.filter((p) => p.clientId !== item.clientId) });
            continue;
        }
        markSyncing(update, store, "players", item.clientId);
        let result: SyncCallResult<{ id: Base58ID }>;
        try {
            result = await api.createPlayer({ id: item.clientId, name: item.name });
        } catch {
            return finish(false, true);
        }
        if (!result.ok) {
            if (result.status === 401) return finish(true, false);
            markError(update, store, "players", item.clientId, result.message);
            continue;
        }
        syncedCount++;
        // Apply memberships before removing the player so a failure here leaves
        // the player pending (retryable) rather than silently losing clubs.
        const clubIds = item.clubIds ?? [];
        let membershipError: string | null = null;
        for (const clubId of clubIds) {
            let clubResult: SyncCallResult<null>;
            try {
                clubResult = await api.addClubMember({ club_id: clubId, player_id: item.clientId });
            } catch {
                // Network died mid-membership — keep the player pending so the
                // remaining clubs are retried on the next sync.
                return finish(false, true);
            }
            if (!clubResult.ok) {
                if (clubResult.status === 401) return finish(true, false);
                membershipError = clubResult.message;
            }
        }
        if (membershipError) {
            // A server-rejected membership (e.g. club deleted offline) — surface
            // it but still drop the player only if there were no other pending
            // memberships to retry. Keep the player so the error is visible.
            markError(update, store, "players", item.clientId, membershipError);
        } else {
            removed.players.add(item.clientId);
            update({ ...store, players: store.players.filter((p) => p.clientId !== item.clientId) });
        }
    }

    // 3. Matches.
    for (const match of [...store.matches]) {
        if (!load().matches.some((m) => m.clientId === match.clientId)) {
            update({ ...store, matches: store.matches.filter((m) => m.clientId !== match.clientId) });
            continue;
        }
        markSyncing(update, store, "matches", match.clientId);
        let result: SyncCallResult<{ id: Base58ID }>;
        try {
            result = await api.addMatch({
                // The owning tenant (ADR-36 phase 7), captured at submit time;
                // null only for legacy pre-tenancy items.
                tenant: match.tenantId ?? null,
                id: match.clientId,
                game_id: match.gameId,
                score: match.score,
                date: clampToNow(match.createdAt, now()),
                camp_arena_ids: match.campArenaIds ?? [],
                // The explicit opt-out only travels when asked for; without it
                // the server decides bracket acceptance at this write (ADR-26).
                ...(match.skipTournamentLink ? { skip_tournament_link: true } : {}),
                // Coop match fields (ADR-33): mode plus the shared result and
                // the participant list — only when present, so competitive
                // pending matches keep the exact legacy payload.
                ...(match.mode ? { mode: match.mode } : {}),
                ...(match.playerIds?.length ? { player_ids: match.playerIds } : {}),
                ...(match.gameScore !== undefined ? { game_score: match.gameScore } : {}),
                ...(match.gameWon !== undefined ? { game_won: match.gameWon } : {}),
                calculator_kind: match.calculatorKind ?? null,
                calculator_data: match.calculatorData ?? null,
            });
        } catch {
            return finish(false, true);
        }
        if (result.ok) {
            syncedCount++;
            removed.matches.add(match.clientId);
            update({ ...store, matches: store.matches.filter((m) => m.clientId !== match.clientId) });
        } else if (result.status === 401) {
            return finish(true, false);
        } else {
            markError(update, store, "matches", match.clientId, result.message);
        }
    }

    return finish(false, false);
}

function resetSyncing<T extends PendingItem>(item: T): T {
    return item.status === "syncing" ? { ...item, status: "pending" } : item;
}

function markSyncing(
    update: (s: OfflineStore) => void,
    store: OfflineStore,
    kind: keyof OfflineStore,
    clientId: string,
) {
    update({
        ...store,
        [kind]: store[kind].map((i) => (i.clientId === clientId ? { ...i, status: "syncing", error: undefined } : i)),
    });
}

function markError(
    update: (s: OfflineStore) => void,
    store: OfflineStore,
    kind: keyof OfflineStore,
    clientId: string,
    message: string,
) {
    update({
        ...store,
        [kind]: store[kind].map((i) => (i.clientId === clientId ? { ...i, status: "error", error: message } : i)),
    });
}
