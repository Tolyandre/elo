// Players, their stats, and the rating corrections (admin).
import { client, unwrap, newId } from "./client";
import type { Correction, CorrectionsPage, PlayerStats } from "./types";
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

export async function getCorrectionsPagePromise(params?: {
    player_id?: string;
    club_id?: string;
    next?: string;
}): Promise<CorrectionsPage> {
    const query: Record<string, string> = {};
    if (params?.next) {
        query.next = params.next;
    } else {
        if (params?.player_id) query.player_id = params.player_id;
        if (params?.club_id) query.club_id = params.club_id;
    }
    const data = await unwrap(client.GET("/corrections", { params: { query } }));
    return {
        items: data.data.map((c): Correction => ({
            id: c.id,
            player_id: c.player_id,
            player_name: c.player_name,
            diff: c.diff,
            date: c.date ? new Date(c.date) : null,
        })),
        next: data.next ?? null,
    };
}

export async function createPlayerCorrectionPromise(playerId: Base58ID, diff: number) {
    return unwrap(client.POST("/admin/players/{id}/corrections", {
        params: { path: { id: playerId } },
        body: { id: newId(), discriminator: "correction", diff },
    }));
}
