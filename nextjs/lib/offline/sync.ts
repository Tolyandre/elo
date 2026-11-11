import { Base58ID } from "../id";
import type { GameMode, MatchMode } from "../game-modes";
import { mergeFields } from "./merge";
import { MATCH_FIELD_LABELS } from "./op-display";
import {
    OfflineStore,
    PendingGame,
    PendingConflictField,
    PendingMatch,
    PendingOp,
    PendingPlayer,
} from "./types";

// API calls return a discriminated result for HTTP errors and THROW only on
// network failure, so the engine can tell "server rejected this item" (keep it
// with an error badge) from "no network" (abort, everything stays pending).
//
// A 409 from a create can carry `existingId` (ADR-37): the entity already
// exists under the server's id, and the engine adopts it — rewrites queued
// references to the canonical id and drops the create item.
export type SyncCallResult<T> =
    | { ok: true; data: T }
    | { ok: false; status: number; message: string; existingId?: Base58ID };

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

/**
 * Server access for op replay (ADR-37 phase 7): reads give the merge its
 * "theirs" (a fresh GET — the run is online by definition), writes apply the
 * merged result. Match reads/writes carry the plain score map (numbers), not
 * the API's per-player settlement rows.
 */
// The metadata keys a game op merges and sends; the PATCH clears a field
// with null, so absent-from-merge keys are simply not sent.
function gameMetaFrom(merged: Record<string, unknown>): Record<string, unknown> {
    const keys = ["name", "alias", "name_en", "name_ru", "bgg_ref", "tesera_ref", "game_mode"];
    return Object.fromEntries(keys.filter((k) => k in merged).map((k) => [k, merged[k]]));
}

/** The server match as the merge sees it: the plain score map, not settlement rows. */
export type ServerMatchFields = {
    game_id: Base58ID;
    date: string;
    score: Record<string, number>;
    camp_arena_ids: Base58ID[];
    mode?: MatchMode;
    player_ids?: Base58ID[];
    game_score?: number;
    game_won?: boolean;
};

export type OpsApi = {
    getPlayer(id: Base58ID): Promise<SyncCallResult<{ name: string } | null>>;
    patchPlayer(id: Base58ID, body: { name: string }): Promise<SyncCallResult<null>>;
    deletePlayer(id: Base58ID): Promise<SyncCallResult<null>>;
    getGame(id: Base58ID): Promise<SyncCallResult<{ name: string } | null>>;
    patchGame(id: Base58ID, body: Record<string, unknown>): Promise<SyncCallResult<null>>;
    deleteGame(id: Base58ID): Promise<SyncCallResult<null>>;
    getMatch(id: Base58ID): Promise<SyncCallResult<{
        game_id: Base58ID;
        date: string;
        score: Record<string, number>;
        camp_arena_ids: Base58ID[];
        mode?: MatchMode;
        player_ids?: Base58ID[];
        game_score?: number;
        game_won?: boolean;
    } | null>>;
    putMatch(id: Base58ID, tenant: Base58ID | null, body: {
        game_id: Base58ID;
        date: string;
        score: Record<string, number>;
        camp_arena_ids: Base58ID[];
        mode?: MatchMode;
        player_ids?: Base58ID[];
        game_score?: number;
        game_won?: boolean;
    }): Promise<SyncCallResult<null>>;
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
type RemovedIds = { games: Set<Base58ID>; players: Set<Base58ID>; matches: Set<Base58ID>; ops: Set<string> };

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
function mergeKind<T>(engine: T[], live: T[], removed: Set<string>, idOf: (i: T) => string): T[] {
    const liveIds = new Set(live.map(idOf));
    const managed = engine.filter((i) => liveIds.has(idOf(i)));
    const managedIds = new Set(managed.map(idOf));
    const added = live.filter((i) => !managedIds.has(idOf(i)) && !removed.has(idOf(i)));
    return [...managed, ...added];
}

function mergeWithLive(engine: OfflineStore, live: OfflineStore, removed: RemovedIds): OfflineStore {
    return {
        games: mergeKind(engine.games, live.games, removed.games, (i) => i.clientId),
        players: mergeKind(engine.players, live.players, removed.players, (i) => i.clientId),
        matches: mergeKind(engine.matches, live.matches, removed.matches, (i) => i.clientId),
        // Ops ride through the same merge (ADR-37): engine-managed ops win,
        // ops queued mid-run survive, dropped ops stay dropped.
        ops: mergeKind(engine.ops ?? [], live.ops ?? [], removed.ops, (i) => i.entityId),
    };
}

// ─── Duplicate-name adoption (ADR-37) ────────────────────────────────────────

/**
 * Rewrites every reference to a losing duplicate id into the canonical one,
 * across the whole store. Match score keys and participant arrays are handled
 * explicitly; `calculator_data` gets a blind deep-walk — Base58 ids are
 * unique strings, and the calculator storage convention keeps id references
 * in values (never object keys, ADR-09), so exact string equality is safe.
 */
function rewriteIdInStore(store: OfflineStore, clientId: Base58ID, canonical: Base58ID): OfflineStore {
    const rewriteMatch = (m: PendingMatch): PendingMatch => {
        let next = m;
        if (next.gameId === clientId) next = { ...next, gameId: canonical };
        if (next.score[clientId] !== undefined) {
            // Key rewrite preserving the remaining entries.
            const score: Record<string, number> = {};
            for (const [key, value] of Object.entries(next.score)) {
                score[key === clientId ? canonical : key] = value;
            }
            next = { ...next, score };
        }
        if (next.playerIds?.includes(clientId)) {
            next = { ...next, playerIds: next.playerIds.map((id) => (id === clientId ? canonical : id)) };
        }
        if (next.calculatorData) {
            const rewritten = rewriteIdDeep(next.calculatorData, clientId, canonical) as PendingMatch["calculatorData"];
            if (rewritten !== next.calculatorData) next = { ...next, calculatorData: rewritten };
        }
        return next;
    };
    return { ...store, matches: store.matches.map(rewriteMatch) };
}

// Returns the original reference when nothing changed, so callers can detect
// a no-op without a deep compare.
function rewriteIdDeep(value: unknown, from: Base58ID, to: Base58ID): unknown {
    if (typeof value === "string") return value === from ? to : value;
    if (Array.isArray(value)) {
        let changed = false;
        const next = value.map((v) => {
            const r = rewriteIdDeep(v, from, to);
            if (r !== v) changed = true;
            return r;
        });
        return changed ? next : value;
    }
    if (value !== null && typeof value === "object") {
        let changed = false;
        const next: Record<string, unknown> = {};
        for (const [key, v] of Object.entries(value)) {
            const r = rewriteIdDeep(v, from, to);
            if (r !== v) changed = true;
            next[key] = r;
        }
        return changed ? next : value;
    }
    return value;
}

/**
 * Pushes pending games, then players, then matches (each in creation order) to the server.
 * Pending games/players carry their final UUIDv7 id, sent as the `id` field of each create
 * request; the one exception is the duplicate-name adoption (ADR-37): a 409 naming the
 * existing entity rewrites queued references to its canonical id and drops the create.
 *
 * Matches whose player/game references are still queued (an errored dependency from this
 * or an earlier run) are deferred — left pending without an error badge — instead of being
 * sent to a foreign-key failure; the next run retries them once the dependency resolves.
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
    opsApi?: OpsApi,
): Promise<SyncOutcome> {
    let store: OfflineStore = {
        games: [...initial.games].sort(byCreatedAt),
        players: [...initial.players].sort(byCreatedAt),
        matches: [...initial.matches].sort(byCreatedAt),
        ops: [...(initial.ops ?? [])].sort(byCreatedAt),
    };
    const removed: RemovedIds = { games: new Set(), players: new Set(), matches: new Set(), ops: new Set() };
    let syncedCount = 0;

    const update = (next: OfflineStore): OfflineStore => {
        store = next;
        const merged = mergeWithLive(store, load(), removed);
        persist(merged);
        return merged;
    };

    const finish = (authRequired: boolean, aborted: boolean): SyncOutcome => {
        // Nothing is in flight anymore — items interrupted by a network failure
        // or a 401 go back to pending. Ops pass through untouched: their
        // status transitions (conflict/error) are decided by the op replay.
        const merged = update({
            games: store.games.map(resetSyncing),
            players: store.players.map(resetSyncing),
            matches: store.matches.map(resetSyncing),
            ops: store.ops,
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
            // Duplicate name with the holder's id (ADR-37): adopt the canonical
            // game — rewrite every pending reference to it, then apply the
            // queued tags against the canonical id (both sides idempotent, so
            // a retry after a failure re-adopts harmlessly).
            if (result.status === 409 && result.existingId) {
                const canonical = result.existingId;
                update(rewriteIdInStore(store, item.clientId, canonical));
                const tagIds = item.tagIds ?? [];
                let tagError: string | null = null;
                for (const tagId of tagIds) {
                    let tagResult: SyncCallResult<null>;
                    try {
                        tagResult = await api.addGameTag({ game_id: canonical, tag_id: tagId });
                    } catch {
                        // Network died mid-tag — the item stays queued; the next
                        // run re-adopts (no-op) and retries the tags.
                        return finish(false, true);
                    }
                    if (!tagResult.ok) {
                        if (tagResult.status === 401) return finish(true, false);
                        tagError = tagResult.message;
                    }
                }
                if (tagError) {
                    markError(update, store, "games", item.clientId, tagError);
                } else {
                    removed.games.add(item.clientId);
                    syncedCount++;
                    update({ ...store, games: store.games.filter((g) => g.clientId !== item.clientId) });
                }
                continue;
            }
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
            // Duplicate name with the holder's id (ADR-37): adopt the canonical
            // player — rewrite every pending reference (match score keys,
            // coop participants, calculator_data), then apply the queued club
            // memberships against the canonical id (idempotent, so a retry
            // after a failure re-adopts harmlessly).
            if (result.status === 409 && result.existingId) {
                const canonical = result.existingId;
                update(rewriteIdInStore(store, item.clientId, canonical));
                const clubIds = item.clubIds ?? [];
                let membershipError: string | null = null;
                for (const clubId of clubIds) {
                    let clubResult: SyncCallResult<null>;
                    try {
                        clubResult = await api.addClubMember({ club_id: clubId, player_id: canonical });
                    } catch {
                        // Network died mid-membership — the item stays queued;
                        // the next run re-adopts (no-op) and retries.
                        return finish(false, true);
                    }
                    if (!clubResult.ok) {
                        if (clubResult.status === 401) return finish(true, false);
                        membershipError = clubResult.message;
                    }
                }
                if (membershipError) {
                    markError(update, store, "players", item.clientId, membershipError);
                } else {
                    removed.players.add(item.clientId);
                    syncedCount++;
                    update({ ...store, players: store.players.filter((p) => p.clientId !== item.clientId) });
                }
                continue;
            }
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

    // 3. Matches. A match referencing an entity that is still queued (an
    // errored game/player from this or an earlier run) is deferred — left
    // pending without an error badge — instead of being sent to a foreign-key
    // failure. Once the dependency resolves (the user repairs the item, the
    // next run syncs it), the match goes out in the same run after it.
    const queuedEntityIds = new Set<string>([...store.games, ...store.players].map((i) => i.clientId));
    const matchRefsResolved = (match: PendingMatch): boolean =>
        !queuedEntityIds.has(match.gameId) &&
        Object.keys(match.score).every((key) => !queuedEntityIds.has(key)) &&
        (match.playerIds ?? []).every((id) => !queuedEntityIds.has(id));

    for (const match of [...store.matches]) {
        if (!load().matches.some((m) => m.clientId === match.clientId)) {
            update({ ...store, matches: store.matches.filter((m) => m.clientId !== match.clientId) });
            continue;
        }
        if (!matchRefsResolved(match)) continue;
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

    // 4. Ops — edits and deletes of saved entities (ADR-37 phase 7). Updates
    // three-way-merge against a fresh server read (the run is online by
    // definition): user changes apply where the server still holds the base,
    // server changes win elsewhere, and a same-field race turns the op into
    // a conflict for the user to resolve on /offline. Conflicted ops are
    // skipped, not sent.
    for (const op of [...(store.ops ?? [])]) {
        if (!load().ops?.some((o) => o.entityId === op.entityId)) {
            // The user dropped the op mid-run — the delete wins.
            removed.ops.add(op.entityId);
            update({ ...store, ops: store.ops?.filter((o) => !(o.entityId === op.entityId)) });
            continue;
        }
        if (!opsApi) {
            markOpError(update, store, op, "Синхронизация изменений недоступна — обновите страницу");
            continue;
        }
        if (op.status === "conflict") continue; // waiting for /offline resolution
        markOpSyncing(update, store, op);
        if (op.op === "delete") {
            // Stale-delete guard (ADR-37): the delete proceeds only when the
            // server still holds the value the user saw. A changed entity
            // becomes a conflict — «удалить всё равно» on /offline re-arms it.
            let current: SyncCallResult<{ name: string } | null>;
            try {
                current = op.kind === "player"
                    ? await opsApi.getPlayer(op.entityId)
                    : await opsApi.getGame(op.entityId);
            } catch {
                return finish(false, true);
            }
            if (!current.ok) {
                if (current.status === 401) return finish(true, false);
                // Read failed otherwise → surface it on the op, keep queued.
                markOpError(update, store, op, current.message);
                continue;
            }
            if (current.data === null) {
                // Already gone server-side — the goal is achieved.
                syncedCount++;
                removed.ops.add(op.entityId);
                update({ ...store, ops: store.ops?.filter((o) => o.entityId !== op.entityId) });
                continue;
            }
            const observed = (op.base as { name?: string } | undefined)?.name;
            if (observed !== undefined && current.data.name !== observed) {
                update({
                    ...store,
                    ops: (store.ops ?? []).map((o) =>
                        o.entityId === op.entityId
                            ? {
                                  ...o,
                                  status: "conflict" as const,
                                  error: undefined,
                                  conflict: [{
                                      field: "name",
                                      label: op.kind === "player" ? "Имя" : "Название",
                                      ours: observed,
                                      theirs: current.data!.name,
                                  }],
                              }
                            : o,
                    ),
                });
                continue;
            }
            let result: SyncCallResult<null>;
            try {
                result = op.kind === "player"
                    ? await opsApi.deletePlayer(op.entityId)
                    : await opsApi.deleteGame(op.entityId);
            } catch {
                return finish(false, true);
            }
            if (!result.ok) {
                if (result.status === 401) return finish(true, false);
                // Already gone server-side — the goal is achieved.
                if (result.status === 404) {
                    syncedCount++;
                    removed.ops.add(op.entityId);
            update({ ...store, ops: store.ops?.filter((o) => o.entityId !== op.entityId) });
                    continue;
                }
                markOpError(update, store, op, result.message);
                continue;
            }
            syncedCount++;
            removed.ops.add(op.entityId);
            update({ ...store, ops: store.ops?.filter((o) => o.entityId !== op.entityId) });
            continue;
        }

        // Update: merge against the fresh server entity.
        const kind = op.kind;
        if (kind === "match") {
            let server: SyncCallResult<ServerMatchFields | null>;
            try {
                server = await opsApi.getMatch(op.entityId);
            } catch {
                return finish(false, true);
            }
            if (!server.ok) {
                if (server.status === 401) return finish(true, false);
                if (server.status === 404) {
                    // The match was deleted server-side (or never existed).
                    syncedCount++;
                    removed.ops.add(op.entityId);
            update({ ...store, ops: store.ops?.filter((o) => o.entityId !== op.entityId) });
                    continue;
                }
                markOpError(update, store, op, server.message);
                continue;
            }
            if (server.data === null) {
                syncedCount++;
                removed.ops.add(op.entityId);
            update({ ...store, ops: store.ops?.filter((o) => o.entityId !== op.entityId) });
                continue;
            }
            const { merged, conflicts } = mergeMatchOp(op, server.data);
            if (conflicts.length > 0) {
                update({
                    ...store,
                    ops: (store.ops ?? []).map((o) =>
                        o.entityId === op.entityId ? { ...o, status: "conflict" as const, conflict: conflicts, error: undefined } : o,
                    ),
                });
                continue;
            }
            let result: SyncCallResult<null>;
            try {
                result = await opsApi.putMatch(op.entityId, op.tenant ?? null, {
                    game_id: merged.game_id as Base58ID,
                    date: merged.date as string,
                    score: merged.score as Record<string, number>,
                    camp_arena_ids: (merged.camp_arena_ids as Base58ID[]) ?? [],
                    ...(merged.mode !== undefined ? { mode: merged.mode as MatchMode } : {}),
                    ...(merged.player_ids !== undefined ? { player_ids: merged.player_ids as Base58ID[] } : {}),
                    ...(merged.game_score !== undefined ? { game_score: merged.game_score as number } : {}),
                    ...(merged.game_won !== undefined ? { game_won: merged.game_won as boolean } : {}),
                });
            } catch {
                return finish(false, true);
            }
            if (!result.ok) {
                if (result.status === 401) return finish(true, false);
                markOpError(update, store, op, result.message);
                continue;
            }
            syncedCount++;
            removed.ops.add(op.entityId);
            update({ ...store, ops: store.ops?.filter((o) => o.entityId !== op.entityId) });
            continue;
        }

        // Players and games: single-field merges (name).
        const fieldLabel = kind === "player" ? "Имя" : "Название";
        const gameLabels: Record<string, string> = { name: "Название", alias: "Альтернативное название", name_en: "Название (EN)", name_ru: "Название (RU)", bgg_ref: "BGG id", tesera_ref: "Tesera id", game_mode: "Режим игры" };
        let server: SyncCallResult<{ name: string } | null>;
        try {
            server = kind === "player" ? await opsApi.getPlayer(op.entityId) : await opsApi.getGame(op.entityId);
        } catch {
            return finish(false, true);
        }
        if (!server.ok) {
            if (server.status === 401) return finish(true, false);
            if (server.status === 404) {
                // Deleted server-side while the op was queued — nothing to edit.
                syncedCount++;
                removed.ops.add(op.entityId);
            update({ ...store, ops: store.ops?.filter((o) => o.entityId !== op.entityId) });
                continue;
            }
            markOpError(update, store, op, server.message);
            continue;
        }
        if (server.data === null) {
            syncedCount++;
            removed.ops.add(op.entityId);
            update({ ...store, ops: store.ops?.filter((o) => o.entityId !== op.entityId) });
            continue;
        }
        const { merged, conflicts } = mergeFields(
            {
                base: op.base ?? {},
                patch: op.patch ?? {},
                server: { name: server.data.name },
            },
            (field) => (kind === "game" ? (gameLabels[field] ?? field) : fieldLabel),
        );
        if (conflicts.length > 0) {
            update({
                ...store,
                ops: (store.ops ?? []).map((o) =>
                    o.entityId === op.entityId ? { ...o, status: "conflict" as const, conflict: conflicts, error: undefined } : o,
                ),
            });
            continue;
        }
        let result: SyncCallResult<null>;
        try {
            result = kind === "player"
                ? await opsApi.patchPlayer(op.entityId, { name: merged.name as string })
                : await opsApi.patchGame(op.entityId, gameMetaFrom(merged));
        } catch {
            return finish(false, true);
        }
        if (!result.ok) {
            if (result.status === 401) return finish(true, false);
            // The rename raced another rename/collided with a unique name —
            // surface it; the user repairs on /offline.
            markOpError(update, store, op, result.message);
            continue;
        }
        syncedCount++;
        removed.ops.add(op.entityId);
            update({ ...store, ops: store.ops?.filter((o) => o.entityId !== op.entityId) });
    }

    return finish(false, false);
}

// Match ops merge at score-key granularity (ADR-37): the score map merges per
// player (each key gets its own conflict entry), the other fields merge whole.
function mergeMatchOp(op: PendingOp, server: {
    game_id: Base58ID;
    date: string;
    score: Record<string, number>;
    camp_arena_ids: Base58ID[];
    mode?: MatchMode;
    player_ids?: Base58ID[];
    game_score?: number;
    game_won?: boolean;
}): { merged: Record<string, unknown>; conflicts: PendingConflictField[] } {
    const base = op.base ?? {};
    const patch = op.patch ?? {};
    const scoreBase = (base.score ?? {}) as Record<string, number>;
    const scorePatch = (patch.score ?? {}) as Record<string, number>;
    const scoreResult = mergeFields(
        { base: scoreBase, patch: scorePatch, server: server.score },
        (key) => `Счёт (${key})`,
    );
    const restPatch = { ...patch };
    delete restPatch.score;
    const restResult = mergeFields(
        { base: { ...base, score: undefined }, patch: restPatch, server: { ...server, score: undefined } },
        (field) => MATCH_FIELD_LABELS[field] ?? field,
    );
    return {
        merged: { ...restResult.merged, score: scoreResult.merged },
        // Score keys get the "score:<playerId>" prefix the resolution path
        // maps back into the patch's score map.
        conflicts: [
            ...scoreResult.conflicts.map((f) => ({ ...f, field: `score:${f.field}` })),
            ...restResult.conflicts,
        ],
    };
}

function markOpSyncing(
    update: (s: OfflineStore) => void,
    store: OfflineStore,
    op: PendingOp,
) {
    update({
        ...store,
        ops: (store.ops ?? []).map((o) =>
            o.entityId === op.entityId ? { ...o, status: "syncing" as const, error: undefined } : o,
        ),
    });
}

function markOpError(
    update: (s: OfflineStore) => void,
    store: OfflineStore,
    op: PendingOp,
    message: string,
) {
    update({
        ...store,
        ops: (store.ops ?? []).map((o) =>
            o.entityId === op.entityId ? { ...o, status: "error" as const, error: message } : o,
        ),
    });
}

function resetSyncing<T extends PendingItem>(item: T): T {
    return item.status === "syncing" ? { ...item, status: "pending" } : item;
}

function markSyncing(
    update: (s: OfflineStore) => void,
    store: OfflineStore,
    kind: "games" | "players" | "matches",
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
    kind: "games" | "players" | "matches",
    clientId: string,
    message: string,
) {
    update({
        ...store,
        [kind]: store[kind].map((i) => (i.clientId === clientId ? { ...i, status: "error", error: message } : i)),
    });
}
