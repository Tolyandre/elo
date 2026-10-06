// Pending entities created while offline, stored in localStorage until synced.

import { uuidv7 } from "uuidv7";
import { Base58ID, encodeId } from "../id";
import type { GameMode, MatchMode } from "../game-modes";

export type SyncStatus = "pending" | "syncing" | "error";

type PendingBase = {
    /** Final UUIDv7 id; used both as the local id and the server `id` on sync. */
    clientId: Base58ID;
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
    clubIds: Base58ID[];
};
export type PendingGame = PendingBase & {
    name: string;
    /**
     * Server tag ids to attach once the game exists on the server. Applied
     * (POST /games/{id}/tags) right after the game is created during sync, the
     * same way club memberships follow a player create. Empty/omitted for games
     * created before this field existed. Tags themselves are never created
     * offline — they are picked from the server vocabulary.
     */
    tagIds?: Base58ID[];
    /**
     * Accepted catalogue suggestion at creation time: canonical names and
     * external refs forwarded with the create on sync (the typed `name`
     * becomes the alias server-side when it differs). Omitted when the game
     * was created without suggestions or before this field existed.
     */
    meta?: {
        nameEn?: string | null;
        nameRu?: string | null;
        bggRef?: number | null;
        teseraRef?: number | null;
        /** The game mode picked at creation (ADR-33); competitive when omitted. */
        gameMode?: GameMode;
    };
};

export type PendingMatch = PendingBase & {
    /** Server game id, or clientId of a pending game. */
    gameId: Base58ID;
    /**
     * Keys are server player ids or clientIds of pending players. Competitive
     * matches carry the per-player scores; coop matches list their participants
     * here (or in playerIds) with zero scores — the shared result lives in
     * gameScore/gameWon.
     */
    score: Record<string, number>;
    /** Coop match mode (ADR-33); competitive (per-player scores) when omitted. */
    mode?: MatchMode;
    /** Participant list of a coop match, instead of per-player scores. */
    playerIds?: Base58ID[];
    /** The shared game result of a coop match. */
    gameScore?: number;
    gameWon?: boolean;
    /** Server camp arena ids (ADR-27) this match belongs to (camps are never created offline). */
    campArenaIds: Base58ID[];
    /**
     * The queued tournament-checkbox state (ADR-26): true — the match asked to
     * stay out of the bracket. The association itself is decided server-side
     * at the sync write (fitting is verified there); only the explicit opt-out
     * travels with the queue.
     */
    skipTournamentLink?: boolean;
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

export function newOfflineId(): Base58ID {
    return encodeId(uuidv7());
}

export function emptyOfflineStore(): OfflineStore {
    return { games: [], players: [], matches: [] };
}
