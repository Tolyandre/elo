// Arenas (ADR-24) and their feeds (ADR-32): the rating surfaces (global,
// per-game, camps), the debug full-recalculation trigger, and the cursor-
// paginated event feeds.
import { client, EloWebServiceBaseUrl, unwrap } from "./client";
import type { components } from "../api-types.gen";
import type {
    Arena,
    ArenaPlayer,
    ArenaSettings,
    FeedEvent,
    FeedPage,
    MatchFilter,
    UpdateArenasResult,
} from "./types";
import { mapMatch } from "./types";
import type { Base58ID } from "@/lib/id";

export async function getArenasPromise(params?: {
    game_id?: Base58ID;
    tournament_id?: Base58ID;
    kind?: "games" | "camps" | "tournaments";
}): Promise<Arena[]> {
    const query: Record<string, string> = {};
    if (params?.game_id) query.game_id = params.game_id;
    if (params?.tournament_id) query.tournament_id = params.tournament_id;
    if (params?.kind) query.kind = params.kind;
    return (await unwrap(client.GET("/arenas", { params: { query } }))).data;
}

export async function getArenaPromise(id: Base58ID): Promise<Arena> {
    return (await unwrap(client.GET("/arenas/{id}", { params: { path: { id } } }))).data;
}

/**
 * 404-safe arena probe: returns null instead of throwing (and without the
 * error toast) when the arena does not exist. Used by the arena view
 * (/, /arenas/view) to detect
 * a missing arena — e.g. a stale id in the URL or the global arena missing
 * from a not-yet-migrated database — and self-heal.
 */
export async function getArenaSafePromise(id: Base58ID): Promise<Arena | null> {
    const res = await fetch(`${EloWebServiceBaseUrl}/arenas/${id}`, { credentials: "include" });
    if (res.status === 404) return null;
    const body = await res.json();
    if (body.status === "fail") throw new Error(body.message);
    return body.data as Arena;
}

export async function getArenaPlayersPromise(id: Base58ID): Promise<ArenaPlayer[]> {
    return (await unwrap(client.GET("/arenas/{id}/players", { params: { path: { id } } }))).data;
}

type FeedQuery = {
    player_id?: Base58ID;
    club_id?: Base58ID;
    game_id?: Base58ID;
    next?: string;
    limit?: number;
};

function feedQueryString(params: FeedQuery): Record<string, string | number> {
    const query: Record<string, string | number> = {};
    if (params.next) {
        // Continuation mode: search params are encoded in the cursor.
        query.next = params.next;
    } else {
        if (params.player_id) query.player_id = params.player_id;
        if (params.club_id) query.club_id = params.club_id;
        if (params.game_id) query.game_id = params.game_id;
    }
    if (params.limit) query.limit = params.limit;
    return query;
}

function mapFeedEvent(e: components["schemas"]["FeedEvent"]): FeedEvent | null {
    switch (e.type) {
        case "match":
            return { type: "match", data: mapMatch(e.data) };
        case "correction": {
            const c = e.data;
            return {
                type: "correction",
                data: {
                    id: c.id,
                    player_id: c.player_id,
                    player_name: c.player_name,
                    diff: c.diff,
                    date: c.date ? new Date(c.date) : null,
                },
            };
        }
        case "market":
            return { type: "market", data: e.data };
        default:
            // A newer server added an event kind this build does not know —
            // skip it instead of failing the whole feed.
            return null;
    }
}

/**
 * Maps one page of wire feed events to the client FeedPage (Dates revived,
 * unknown event kinds skipped). Shared with the tenant feed (ADR-36) — same
 * event union, same envelope.
 */
export function mapFeedPage(data: components["schemas"]["FeedEvent"][], next?: string | null): FeedPage {
    return {
        items: data.map(mapFeedEvent).filter((e): e is FeedEvent => e !== null),
        next: next ?? null,
    };
}

/**
 * The arena's feed (ADR-32): merged match/correction/market-resolution events,
 * newest first. Corrections and market resolutions appear only in the global
 * arena's feed (they settle only there); filters apply to match and market
 * events (corrections stay unfiltered).
 */
export async function getArenaFeedPagePromise(params: FeedQuery & { id: Base58ID }): Promise<FeedPage> {
    const data = await unwrap(client.GET("/arenas/{id}/feed", {
        params: { path: { id: params.id }, query: feedQueryString(params) },
    }));
    return mapFeedPage(data.data, data.next);
}

/**
 * The main page's home feed (ADR-32): today the global arena's event set, and
 * the surface where content that affects no rating (cooperative matches,
 * posts) will appear — unlike the global arena's own feed.
 */
export async function getHomeFeedPagePromise(params: FeedQuery = {}): Promise<FeedPage> {
    const data = await unwrap(client.GET("/feed", { params: { query: feedQueryString(params) } }));
    return mapFeedPage(data.data, data.next);
}

export async function createArenaPromise(payload: {
    name: string;
    camp?: boolean;
    filter?: MatchFilter;
    starts_at?: string | null;
    ends_at?: string | null;
    settings: ArenaSettings;
}): Promise<Arena> {
    // camp is required in the generated body type (it carries a spec default);
    // always send it so the server's camp/non-camp discrimination is explicit.
    return (await unwrap(client.POST("/arenas", {
        body: { ...payload, camp: payload.camp ?? false },
    }))).data;
}

export async function updateArenaPromise(
    id: Base58ID,
    payload: {
        name: string;
        camp?: boolean;
        filter?: MatchFilter;
        starts_at?: string | null;
        ends_at?: string | null;
        settings: ArenaSettings;
    },
): Promise<Arena> {
    return (await unwrap(client.PATCH("/arenas/{id}", {
        params: { path: { id } },
        body: { ...payload, camp: payload.camp ?? false },
    }))).data;
}

export async function deleteArenaPromise(id: Base58ID) {
    return unwrap(client.DELETE("/arenas/{id}", { params: { path: { id } } }));
}

/**
 * Debug/monitoring: recalculate every arena to the actual state (ADR-24). The
 * global arena is replayed from the beginning (the same computation an
 * edit+save of the chronologically first match triggers); every other arena
 * gets a full replay of its filtered matches. A stable recalculation reports
 * no changed players.
 */
export async function updateArenasPromise(): Promise<UpdateArenasResult["data"]> {
    return (await unwrap(client.POST("/admin/update-arenas"))).data;
}

/**
 * Typed view of the arena settings document (ADR-24). The wire type is an
 * opaque object — the server validates it against the versioned JSON Schema
 * in pkg/arenasettings; v1 shape reproduced here for rendering.
 */
export type ArenaSettingsDoc = {
    starting_rating: number;
    leagues: {
        kind: "newbie" | "amateur" | "elite";
        goal_gap?: number;
        earned_min?: number;
        earned_max?: number;
        tau?: number;
        matches_6m?: number;
        matches_2m?: number;
    }[];
};

export function parseArenaSettings(settings: ArenaSettings): ArenaSettingsDoc {
    return settings as unknown as ArenaSettingsDoc;
}
