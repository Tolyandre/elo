// Players and their stats.
import { client, unwrap } from "./client";
import type { PlayerStats } from "./types";
import type { Base58ID } from "@/lib/id";

export async function getPlayersPromise(tenant: Base58ID) {
    return (await unwrap(client.GET("/players", {
        params: { query: { tenant } },
    }))).data;
}

// "Недавние" picker candidates for the signed-in user: club co-players,
// players created by them or their club's users (audit log), their player
// pinned first. 401s for anonymous callers — callers fall back to the
// client-side computation on any error.
export async function getRecentPlayersPromise() {
    return (await unwrap(client.GET("/players/recent"))).data;
}

export async function patchPlayerPromise(playerId: Base58ID, payload: { name: string }) {
    return (await unwrap(client.PATCH("/players/{id}", {
        params: { path: { id: playerId } },
        body: payload,
    }))).data;
}

export async function deletePlayerPromise(playerId: Base58ID) {
    return unwrap(client.DELETE("/players/{id}", { params: { path: { id: playerId } } }));
}

export async function getPlayerStatsPromise(id: Base58ID, opts: { tenant: Base58ID }): Promise<PlayerStats> {
    return (await unwrap(client.GET("/players/{id}/stats", {
        params: { path: { id }, query: { tenant: opts.tenant } },
    }))).data;
}
