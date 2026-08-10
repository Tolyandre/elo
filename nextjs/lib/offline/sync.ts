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
    createGame(body: { id: string; name: string }): Promise<SyncCallResult<{ id: string }>>;
    createPlayer(body: { id: string; name: string }): Promise<SyncCallResult<{ id: string }>>;
    addClubMember(body: { club_id: string; player_id: string }): Promise<SyncCallResult<null>>;
    addMatch(body: {
        id: string;
        game_id: string;
        score: Record<string, number>;
        date: string;
        tournament_ids: string[];
        calculator_kind?: string | null;
        calculator_data?: Record<string, unknown> | null;
    }): Promise<SyncCallResult<{ id: string }>>;
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
 * Pending games/players already carry their final UUIDv7 id, which is sent as the `id`
 * field of each create request — no clientId rewriting is needed.
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

    // 1. Games.
    for (const item of [...store.games]) {
        markSyncing(update, store, "games", item.clientId);
        let result: SyncCallResult<{ id: string }>;
        try {
            result = await api.createGame({ id: item.clientId, name: item.name });
        } catch {
            return finish(false, true);
        }
        if (result.ok) {
            syncedCount++;
            update({ ...store, games: store.games.filter((g) => g.clientId !== item.clientId) });
        } else if (result.status === 401) {
            return finish(true, false);
        } else {
            markError(update, store, "games", item.clientId, result.message);
        }
    }

    // 2. Players — create, then apply club memberships. The player create is
    // idempotent on id and AddClubMember is ON CONFLICT DO NOTHING, so a network
    // failure after either step is safe to retry: re-running resends the same
    // player id (a no-op upsert) and re-adds the same memberships (no-ops).
    for (const item of [...store.players]) {
        markSyncing(update, store, "players", item.clientId);
        let result: SyncCallResult<{ id: string }>;
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
            update({ ...store, players: store.players.filter((p) => p.clientId !== item.clientId) });
        }
    }

    // 3. Matches.
    for (const match of [...store.matches]) {
        markSyncing(update, store, "matches", match.clientId);
        let result: SyncCallResult<{ id: string }>;
        try {
            result = await api.addMatch({
                id: match.clientId,
                game_id: match.gameId,
                score: match.score,
                date: clampToNow(match.createdAt, now()),
                tournament_ids: match.tournamentIds ?? [],
                calculator_kind: match.calculatorKind ?? null,
                calculator_data: match.calculatorData ?? null,
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
