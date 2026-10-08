// Tenants (ADR-36): communities owning a main arena, openness settings and
// one or many clubs. Clubs stay pure grouping (see ./clubs).
import { client, unwrap, newId } from "./client";
import { mapFeedPage } from "./arenas";
import type { FeedPage } from "./types";
import type { Tenant } from "./types";
import type { ArenaSettings } from "./types";
import type { Base58ID } from "@/lib/id";

export async function listTenantsPromise(): Promise<Tenant[]> {
    return (await unwrap(client.GET("/tenants"))).data;
}

export async function getTenantPromise(id: Base58ID): Promise<Tenant> {
    return (await unwrap(client.GET("/tenants/{id}", { params: { path: { id } } }))).data;
}

export async function createTenantPromise(payload: {
    name: string;
    arena_membership_mode: "any_member" | "members_only";
    tournaments_openness: "members_only" | "open";
    club_ids?: Base58ID[];
}): Promise<Tenant> {
    return (await unwrap(client.POST("/tenants", { body: { id: newId(), ...payload } }))).data;
}

export async function patchTenantPromise(
    id: Base58ID,
    payload: {
        name?: string;
        icon?: string;
        arena_membership_mode?: "any_member" | "members_only";
        tournaments_openness?: "members_only" | "open";
        settings?: ArenaSettings;
    },
): Promise<Tenant> {
    return (await unwrap(client.PATCH("/tenants/{id}", {
        params: { path: { id } },
        body: payload,
    }))).data;
}

export async function setTenantClubsPromise(id: Base58ID, clubIds: Base58ID[]): Promise<Tenant> {
    return (await unwrap(client.PUT("/tenants/{id}/clubs", {
        params: { path: { id } },
        body: { club_ids: clubIds },
    }))).data;
}

export async function listTenantFeedPromise(id: Base58ID, query: {
    player_id?: Base58ID;
    club_id?: Base58ID;
    game_id?: Base58ID;
    next?: string;
    limit?: number;
}) {
    return unwrap(client.GET("/tenants/{id}/feed", { params: { path: { id }, query } }));
}

/**
 * The tenant's community feed (ADR-36), mapped like the arena feeds: match
 * events with settlement columns from the tenant's main arena, the tenant's
 * own markets. The club filter narrows matches and markets to one club's
 * members.
 */
export async function getTenantFeedPagePromise(id: Base58ID, query: {
    player_id?: Base58ID;
    club_id?: Base58ID;
    game_id?: Base58ID;
    next?: string;
    limit?: number;
}): Promise<FeedPage> {
    const q: Record<string, string | number> = {};
    if (query.next) {
        // Continuation mode: the filters travel inside the cursor token.
        q.next = query.next;
    } else {
        if (query.player_id) q.player_id = query.player_id;
        if (query.club_id) q.club_id = query.club_id;
        if (query.game_id) q.game_id = query.game_id;
    }
    if (query.limit) q.limit = query.limit;
    const data = await unwrap(client.GET("/tenants/{id}/feed", {
        params: { path: { id }, query: q },
    }));
    return mapFeedPage(data.data, data.next);
}
