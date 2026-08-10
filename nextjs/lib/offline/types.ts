// Pending entities created while offline, stored in localStorage until synced.

import { uuidv7 } from "uuidv7";
import { encodeId } from "../id";

export type SyncStatus = "pending" | "syncing" | "error";

type PendingBase = {
    /** Final UUIDv7 id; used both as the local id and the server `id` on sync. */
    clientId: string;
    /** ISO time of offline creation; becomes the match `date` on sync. */
    createdAt: string;
    status: SyncStatus;
    error?: string;
};

export type PendingPlayer = PendingBase & {
    name: string;
    /**
     * Server club ids the player should be added to once they exist on the server.
     * Memberships are applied (POST /clubs/{id}/members) right after the player
     * is created during sync. Empty for players created before this field existed.
     */
    clubIds: string[];
};
export type PendingGame = PendingBase & { name: string };

export type PendingMatch = PendingBase & {
    /** Server game id, or clientId of a pending game. */
    gameId: string;
    /** Keys are server player ids or clientIds of pending players. */
    score: Record<string, number>;
    /** Server tournament ids this match belongs to (tournaments are never created offline). */
    tournamentIds: string[];
    /**
     * Calculator state captured when the match was created from a calculator
     * (e.g. Skull King). Forwarded on sync so the round-by-round breakdown
     * survives an offline save — see ADR-09.
     */
    calculatorKind?: string | null;
    calculatorData?: Record<string, unknown> | null;
};

export type OfflineStore = {
    games: PendingGame[];
    players: PendingPlayer[];
    matches: PendingMatch[];
};

export function newOfflineId(): string {
    return encodeId(uuidv7());
}

export function emptyOfflineStore(): OfflineStore {
    return { games: [], players: [], matches: [] };
}
