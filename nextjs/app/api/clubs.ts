// Clubs and their player memberships.
import { client, unwrap, newId } from "./client";
import type { Club } from "./types";
import type { Base58ID } from "@/lib/id";

export async function listClubsPromise(): Promise<Club[]> {
    return (await unwrap(client.GET("/clubs"))).data;
}

export async function getClubPromise(id: Base58ID): Promise<Club> {
    return (await unwrap(client.GET("/clubs/{id}", { params: { path: { id } } }))).data;
}

export async function createClubPromise(payload: { name: string }): Promise<Club> {
    return (await unwrap(client.POST("/clubs", { body: { id: newId(), ...payload } }))).data;
}

export async function patchClubPromise(
    id: Base58ID,
    payload: { name?: string; icon?: string },
): Promise<Club> {
    return (await unwrap(client.PATCH("/clubs/{id}", {
        params: { path: { id } },
        body: payload,
    }))).data;
}

export async function deleteClubPromise(id: Base58ID) {
    return unwrap(client.DELETE("/clubs/{id}", { params: { path: { id } } }));
}

export async function addClubMemberPromise(clubId: Base58ID, playerId: Base58ID) {
    return unwrap(client.POST("/clubs/{id}/members", {
        params: { path: { id: clubId } },
        body: { player_id: playerId },
    }));
}

export async function removeClubMemberPromise(clubId: Base58ID, playerId: Base58ID) {
    return unwrap(client.DELETE("/clubs/{id}/members/{playerId}", {
        params: { path: { id: clubId, playerId } },
    }));
}
