// Pending entities created while offline, stored in localStorage until synced.

import { uuidv7 } from "uuidv7";
import { Base58ID, encodeId } from "../id";
import type { GameMode, MatchMode } from "../game-modes";

/**
 * Lifecycle of a queued item. `conflict` (ADR-37) marks an item the sync
 * engine could not merge: at least one field the user changed was also
 * changed server-side. The item waits on the /offline queue page, where the
 * user resolves each field (keep mine / take the server's) at their leisure —
 * sync never opens merge dialogs mid-UX.
 */
export type SyncStatus = "pending" | "syncing" | "error" | "conflict";

/**
 * One unresolved field of a conflicted item (ADR-37). `ours`/`theirs` carry
 * raw values in a lossless string encoding (names as-is, numbers as decimal
 * strings, dates as ISO) so a resolution can be written back verbatim; the
 * queue page formats them for display.
 */
export type PendingConflictField = {
    /** Machine key: "name" for players/games; "date", "score:<playerId>", … for matches. */
    field: string;
    /** Human-readable field label shown on the queue page. */
    label: string;
    /** The value this device queued. */
    ours: string;
    /** The value the server currently holds. */
    theirs: string;
};

type PendingBase = {
    /** Final UUIDv7 id; used both as the local id and the server `id` on sync. */
    clientId: Base58ID;
    /** ISO time of offline creation; becomes the match `date` on sync. */
    createdAt: string;
    status: SyncStatus;
    error?: string;
    /**
     * Unresolved merge fields — present only while `status` is "conflict"
     * (ADR-37). Shrinks as the user resolves fields on the queue page; the
     * item returns to "pending" (and re-syncs) once the list is empty.
     */
    conflict?: PendingConflictField[];
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
    /**
     * The community the match was recorded under (ADR-36 phase 7) — captured
     * at submit time and sent as the create path tenant on sync. Legacy items
     * from before the field existed lack it; sync falls back to the current
     * tenant for them.
     */
    tenantId?: Base58ID;
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
    /**
     * Edits and deletes of SAVED entities, queued while offline (ADR-37).
     * One op per entity id — a later op replaces an earlier one (last write
     * wins within a device). Ops carry `base` (the entity as the form
     * observed it) so the sync can three-way-merge against the server.
     */
    ops?: PendingOp[];
};

/** The entity kind an op targets. Matches merge at score-key granularity. */
export type OpEntityKind = "player" | "game" | "match";

export type PendingOp = {
    /** The saved entity's id — final, never rewritten. */
    entityId: Base58ID;
    kind: OpEntityKind;
    op: "update" | "delete";
    /** ISO time of queueing; orders ops deterministically. */
    createdAt: string;
    status: SyncStatus;
    error?: string;
    /** Match updates only: the community the PUT is scoped to (ADR-36). */
    tenant?: Base58ID;
    /** update only: the entity fields as the form observed them (the merge base). */
    base?: Record<string, unknown>;
    /** update only: the fields the user changed. */
    patch?: Record<string, unknown>;
    /** Unresolved merge fields — present only while status is "conflict". */
    conflict?: PendingConflictField[];
};

export function newOfflineId(): Base58ID {
    return encodeId(uuidv7());
}

export function emptyOfflineStore(): OfflineStore {
    return { games: [], players: [], matches: [], ops: [] };
}
