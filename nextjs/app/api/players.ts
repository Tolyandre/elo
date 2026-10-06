// Players, their stats, and the rating corrections (admin).
import { client, unwrap, newId } from "./client";
import type { PlayerStats } from "./types";
import type { Base58ID } from "@/lib/id";

export async function getPlayersPromise() {
    return (await unwrap(client.GET("/players"))).data;
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

export async function getPlayerStatsPromise(id: Base58ID): Promise<PlayerStats> {
    return (await unwrap(client.GET("/players/{id}/stats", { params: { path: { id } } }))).data;
}

export async function createPlayerCorrectionPromise(playerId: Base58ID, diff: number) {
    return unwrap(client.POST("/admin/players/{id}/corrections", {
        params: { path: { id: playerId } },
        body: { id: newId(), discriminator: "correction", diff },
    }));
}
