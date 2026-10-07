// Tournaments and brackets (ADR-26): registration-time configuration, the
// plan picker, the start/cancel lifecycle, and organizer slot adjustments.
import { client, unwrap, newId } from "./client";
import type {
    Bracket,
    BracketPlanFacets,
    Tournament,
    TournamentGame,
    TournamentInput,
    TournamentPlan,
} from "./types";
import type { Base58ID } from "@/lib/id";

export async function getTournamentsPromise(): Promise<Tournament[]> {
    return (await unwrap(client.GET("/tournaments"))).data;
}

export async function getTournamentPromise(id: Base58ID): Promise<Tournament> {
    return (await unwrap(client.GET("/tournaments/{id}", { params: { path: { id } } }))).data;
}

// Tournaments are created under their owning tenant club (ADR-36): the club
// is part of the URL and immutable afterwards.
export async function createTournamentPromise(
    clubId: Base58ID,
    payload: {
        name: string;
        grand_final_deadline?: string | null;
        games?: TournamentGame[];
        participant_ids?: Base58ID[];
    },
): Promise<Tournament> {
    return (await unwrap(client.POST("/clubs/{id}/tournaments", {
        params: { path: { id: clubId } },
        body: { id: newId(), ...payload },
    }))).data;
}

export async function updateTournamentPromise(id: Base58ID, payload: TournamentInput): Promise<Tournament> {
    return (await unwrap(client.PUT("/tournaments/{id}", { params: { path: { id } }, body: payload }))).data;
}

export async function registerInTournamentPromise(id: Base58ID) {
    await unwrap(client.POST("/tournaments/{id}/registration", { params: { path: { id } } }));
}

export async function unregisterFromTournamentPromise(id: Base58ID) {
    await unwrap(client.DELETE("/tournaments/{id}/registration", { params: { path: { id } } }));
}

export interface BracketPlanFilters {
    elimination?: ("single" | "double")[];
    rounds?: number[];
    byes?: "with" | "without";
    first_shapes?: string[];
    /** Per-round advance counts; every non-final round must be listed. */
    advances?: number[];
    /** Whether a next-round slot may seat players of one previous-round slot together. */
    rematches?: "with" | "without";
}

export async function getTournamentBracketPlansPromise(id: Base58ID, filters: BracketPlanFilters = {}): Promise<{
    plans: TournamentPlan[];
    truncated: boolean;
    cap: number;
    facets: BracketPlanFacets;
}> {
    return (await unwrap(client.GET("/tournaments/{id}/bracket-plans", {
        params: { path: { id }, query: filters },
    }))).data;
}

export async function startTournamentPromise(id: Base58ID, plan: TournamentPlan) {
    await unwrap(client.POST("/tournaments/{id}/start", { params: { path: { id } }, body: { plan } }));
}

export async function cancelTournamentPromise(id: Base58ID) {
    await unwrap(client.POST("/tournaments/{id}/cancel", { params: { path: { id } } }));
}

export async function getTournamentBracketPromise(id: Base58ID): Promise<Bracket> {
    return (await unwrap(client.GET("/tournaments/{id}/bracket", { params: { path: { id } } }))).data;
}

export async function adjustTournamentSlotPromise(
    id: Base58ID,
    sid: Base58ID,
    payload: { game_id?: Base58ID; min_score?: number },
) {
    await unwrap(client.PATCH("/tournaments/{id}/slots/{sid}", {
        params: { path: { id, sid } },
        body: payload,
    }));
}

export async function attachTournamentSlotMatchPromise(id: Base58ID, sid: Base58ID, match_id: Base58ID) {
    await unwrap(client.POST("/tournaments/{id}/slots/{sid}/matches", {
        params: { path: { id, sid } },
        body: { match_id },
    }));
}

export async function detachTournamentSlotMatchPromise(id: Base58ID, sid: Base58ID, mid: Base58ID) {
    await unwrap(client.DELETE("/tournaments/{id}/slots/{sid}/matches/{mid}", {
        params: { path: { id, sid, mid } },
    }));
}

export async function setTournamentSlotRulingPromise(id: Base58ID, sid: Base58ID, player_ids: Base58ID[]) {
    await unwrap(client.POST("/tournaments/{id}/slots/{sid}/ruling", {
        params: { path: { id, sid } },
        body: { player_ids },
    }));
}
