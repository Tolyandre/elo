// Pending entities created while offline, stored in localStorage until synced.

import { uuidv7 } from "uuidv7";

export type SyncStatus = "pending" | "syncing" | "error";

type PendingBase = {
    /** Final UUIDv7 id; used both as the local id and the server `id` on sync. */
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
    /** Server tournament ids this match belongs to (tournaments are never created offline). */
    tournamentIds: string[];
};

export type OfflineStore = {
    games: PendingGame[];
    players: PendingPlayer[];
    matches: PendingMatch[];
};

export function newOfflineId(): string {
    return uuidv7();
}

export function emptyOfflineStore(): OfflineStore {
    return { games: [], players: [], matches: [] };
}
