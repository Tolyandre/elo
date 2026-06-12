// Pending entities created while offline, stored in localStorage until synced.

export type SyncStatus = "pending" | "syncing" | "error";

type PendingBase = {
    /** Local id "offline:<uuid>"; the uuid part is sent as idempotency_key on sync. */
    clientId: string;
    /** ISO time of offline creation; becomes the match `date` on sync. */
    createdAt: string;
    status: SyncStatus;
    error?: string;
};

export type PendingPlayer = PendingBase & { name: string };
export type PendingGame = PendingBase & { name: string };

export type PendingMatch = PendingBase & {
    /** Server game id, or clientId of a pending game. */
    gameId: string;
    /** Keys are server player ids or clientIds of pending players. */
    score: Record<string, number>;
};

export type OfflineStore = {
    games: PendingGame[];
    players: PendingPlayer[];
    matches: PendingMatch[];
};

export const OFFLINE_ID_PREFIX = "offline:";

export function isOfflineId(id: string): boolean {
    return id.startsWith(OFFLINE_ID_PREFIX);
}

export function newOfflineId(): string {
    return OFFLINE_ID_PREFIX + crypto.randomUUID();
}

/** The server-side idempotency key is the uuid part of the local id. */
export function idempotencyKeyOf(clientId: string): string {
    return clientId.slice(OFFLINE_ID_PREFIX.length);
}

export function emptyOfflineStore(): OfflineStore {
    return { games: [], players: [], matches: [] };
}
