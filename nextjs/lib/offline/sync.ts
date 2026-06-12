import {
    OfflineStore,
    PendingGame,
    PendingMatch,
    PendingPlayer,
    idempotencyKeyOf,
    isOfflineId,
} from "./types";

// API calls return a discriminated result for HTTP errors and THROW only on
// network failure, so the engine can tell "server rejected this item" (keep it
// with an error badge) from "no network" (abort, everything stays pending).
export type SyncCallResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

export type SyncApi = {
    createGame(body: { name: string; idempotency_key: string }): Promise<SyncCallResult<{ id: string }>>;
    createPlayer(body: { name: string; idempotency_key: string }): Promise<SyncCallResult<{ id: string }>>;
    addMatch(body: {
        game_id: string;
        score: Record<string, number>;
        date: string;
        idempotency_key: string;
    }): Promise<SyncCallResult<{ id: number }>>;
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

/** Replaces a synced entity's clientId with its server id in all pending matches. */
function rewriteMatchRefs(matches: PendingMatch[], clientId: string, serverId: string): PendingMatch[] {
    return matches.map((m) => {
        let changed = false;
        let gameId = m.gameId;
        if (gameId === clientId) {
            gameId = serverId;
            changed = true;
        }
        const score: Record<string, number> = {};
        for (const [pid, points] of Object.entries(m.score)) {
            if (pid === clientId) {
                score[serverId] = points;
                changed = true;
            } else {
                score[pid] = points;
            }
        }
        return changed ? { ...m, gameId, score } : m;
    });
}

function byCreatedAt<T extends { createdAt: string }>(a: T, b: T): number {
    return a.createdAt.localeCompare(b.createdAt);
}

/** Clamp a client timestamp to "now" so a fast device clock can't produce a future date. */
function clampToNow(iso: string, now: Date): string {
    const t = new Date(iso);
    return t.getTime() > now.getTime() ? now.toISOString() : iso;
}

/**
 * Pushes pending games, then players, then matches (each in creation order) to the server.
 * Match payloads reference server ids: synced games/players rewrite their clientId in the
 * remaining matches immediately, so partial runs keep the store consistent.
 *
 * `persist` is called after every state change so progress survives interruption.
 */
export async function syncOffline(
    initial: OfflineStore,
    api: SyncApi,
    persist: (store: OfflineStore) => void,
    now: () => Date = () => new Date(),
): Promise<SyncOutcome> {
    let store: OfflineStore = {
        games: [...initial.games].sort(byCreatedAt),
        players: [...initial.players].sort(byCreatedAt),
        matches: [...initial.matches].sort(byCreatedAt),
    };
    let syncedCount = 0;

    const update = (next: OfflineStore) => {
        store = next;
        persist(store);
    };

    const finish = (authRequired: boolean, aborted: boolean): SyncOutcome => {
        // Nothing is in flight anymore — items interrupted by a network failure
        // or a 401 go back to pending.
        update({
            games: store.games.map(resetSyncing),
            players: store.players.map(resetSyncing),
            matches: store.matches.map(resetSyncing),
        });
        return { store, authRequired, aborted, syncedCount };
    };

    // 1. Games, 2. Players — identical handling.
    for (const kind of ["games", "players"] as const) {
        for (const item of [...store[kind]]) {
            markSyncing(update, store, kind, item.clientId);
            let result: SyncCallResult<{ id: string }>;
            try {
                const body = { name: item.name, idempotency_key: idempotencyKeyOf(item.clientId) };
                result = kind === "games" ? await api.createGame(body) : await api.createPlayer(body);
            } catch {
                return finish(false, true);
            }
            if (result.ok) {
                syncedCount++;
                update({
                    ...store,
                    [kind]: store[kind].filter((g) => g.clientId !== item.clientId),
                    matches: rewriteMatchRefs(store.matches, item.clientId, result.data.id),
                });
            } else if (result.status === 401) {
                return finish(true, false);
            } else {
                markError(update, store, kind, item.clientId, result.message);
            }
        }
    }

    // 3. Matches.
    for (const match of [...store.matches]) {
        const unresolved = [match.gameId, ...Object.keys(match.score)].filter(isOfflineId);
        if (unresolved.length > 0) {
            markError(update, store, "matches", match.clientId, "зависит от несинхронизированной записи");
            continue;
        }

        markSyncing(update, store, "matches", match.clientId);
        let result: SyncCallResult<{ id: number }>;
        try {
            result = await api.addMatch({
                game_id: match.gameId,
                score: match.score,
                date: clampToNow(match.createdAt, now()),
                idempotency_key: idempotencyKeyOf(match.clientId),
            });
        } catch {
            return finish(false, true);
        }
        if (result.ok) {
            syncedCount++;
            update({ ...store, matches: store.matches.filter((m) => m.clientId !== match.clientId) });
        } else if (result.status === 401) {
            return finish(true, false);
        } else {
            markError(update, store, "matches", match.clientId, result.message);
        }
    }

    return finish(false, false);
}

type PendingItem = PendingGame | PendingPlayer | PendingMatch;

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
