// Match endpoints: the paginated list, the detail fetch (calculator_data only
// rides on the detail response), and the offline-first writes (ADR-16).
import { client, unwrap } from "./client";
import { mapMatch, type Match, type MatchesPage } from "./types";
import type { Base58ID } from "@/lib/id";
import type { MatchMode } from "@/lib/game-modes";

export async function getMatchesPagePromise(params: {
    player_id?: string;
    game_id?: string;
    club_id?: string;
    tournament_id?: string;
    /** The display arena's tenant (ADR-36): required — settlement columns from its main arena. */
    tenant: Base58ID;
    next?: string;
    limit?: number;
}): Promise<MatchesPage> {
    const { tenant } = params;
    // Typed to the generated query shape — `tenant` is required there (ADR-36
    // phase 5), so a hand-built Record<string, string | number> won't typecheck.
    const query: {
        player_id?: string;
        game_id?: string;
        club_id?: string;
        tournament_id?: string;
        tenant: string;
        next?: string;
        limit?: number;
    } = { tenant };
    if (params.next) {
        // Continuation mode: search params are encoded in the cursor — except
        // the tenant, which the cursor does not carry and every page must
        // repeat (ADR-36).
        query.next = params.next;
    } else {
        // Initial mode: pass search params explicitly.
        if (params.player_id) query.player_id = params.player_id;
        if (params.game_id) query.game_id = params.game_id;
        if (params.club_id) query.club_id = params.club_id;
        if (params.tournament_id) query.tournament_id = params.tournament_id;
    }
    if (params.limit) query.limit = params.limit;

    const data = await unwrap(client.GET("/matches", { params: { query } }));
    return { items: data.data.map(mapMatch), next: data.next ?? null };
}

export async function getMatchByIdPromise(id: Base58ID, tenant: Base58ID): Promise<Match> {
    return mapMatch((await unwrap(client.GET("/matches/{id}", {
        params: { path: { id }, query: { tenant } },
    }))).data);
}

export async function addMatchPromise(payload: {
    id: Base58ID;
    game_id: Base58ID;
    score: Record<string, number>;
    date?: string;
    camp_arena_ids?: Base58ID[];
    skip_tournament_link?: boolean;
    /** Coop match fields (ADR-33): mode plus the shared result and participants. */
    mode?: MatchMode;
    player_ids?: Base58ID[];
    game_score?: number;
    game_won?: boolean;
    calculator_kind?: string | null;
    calculator_data?: Record<string, never> | null;
}) {
    return (await unwrap(client.POST("/matches", { body: payload }))).data;
}

export async function updateMatchPromise(matchId: Base58ID, tenant: Base58ID, payload: {
    game_id: Base58ID;
    /** Per-player scores — competitive matches only; coop matches send game_score/game_won + player_ids instead. */
    score?: Record<string, number>;
    date: string;
    camp_arena_ids?: Base58ID[];
    /** The desired tournament-link state (ADR-26): true — out of the bracket, false — counted. Omitted — unchanged. */
    skip_tournament_link?: boolean;
    /** Coop match fields (ADR-33): the desired mode, shared result and participants. */
    mode?: MatchMode;
    player_ids?: Base58ID[];
    game_score?: number;
    game_won?: boolean;
    calculator_kind?: string | null;
    calculator_data?: Record<string, never> | null;
}) {
    const data = await unwrap(client.PUT("/matches/{id}", {
        params: { path: { id: matchId }, query: { tenant } },
        body: payload,
    }));
    return data;
}
