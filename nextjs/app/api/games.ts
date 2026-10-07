// Games, their catalogue metadata, tags, and the Tesera suggestion matching.
import { client, unwrap, newId } from "./client";
import type { Game, GameAutoMatchResult, GameEnrichResult, GameList, GameSuggestion, FavoriteGames, Tag } from "./types";
import type { Base58ID } from "@/lib/id";
import type { GameMode } from "@/lib/game-modes";

export async function getGamesPromise(): Promise<GameList> {
    return (await unwrap(client.GET("/games"))).data;
}

/** The game picker's «Избранные» sections for the signed-in user. */
export async function getFavoriteGamesPromise(): Promise<FavoriteGames> {
    return (await unwrap(client.GET("/games/favorites"))).data;
}

export async function getGamePromise(id: Base58ID): Promise<Game> {
    return (await unwrap(client.GET("/games/{id}", { params: { path: { id } } }))).data;
}

export type GameMetadata = {
    alias?: string | null;
    name_en?: string | null;
    name_ru?: string | null;
    bgg_ref?: number | null;
    tesera_ref?: number | null;
    /** Full-state mode (ADR-33): null resets to competitive. */
    game_mode?: GameMode | null;
};

/** Full-state metadata update: every field is set to the given value, null clears it. */
export async function patchGamePromise(id: Base58ID, payload: GameMetadata) {
    return (await unwrap(client.PATCH("/games/{id}", { params: { path: { id } }, body: payload }))).data;
}

/**
 * Catalogue matches for a name being typed. Best-effort by design: any
 * failure (network error, 5xx, offline) resolves to an empty list —
 * suggestions must never block game creation.
 */
export async function suggestGamesPromise(query: string): Promise<GameSuggestion[]> {
    try {
        return (await unwrap(client.GET("/games/suggestions", { params: { query: { query } } }))).data.games;
    } catch {
        return [];
    }
}

/** Bulk exact-name matching against Tesera for games lacking a Tesera link. */
export async function autoMatchGamesPromise(): Promise<GameAutoMatchResult[]> {
    return (await unwrap(client.POST("/games/auto-match"))).data.games;
}

/**
 * BGG box-art backfill for games with a bgg_ref but no image yet. Requires a
 * configured BGG API token server-side; per-game failures are reported in
 * the results, request-level errors throw (toast via the API helper).
 */
export async function enrichGameImagesPromise(): Promise<GameEnrichResult[]> {
    return (await unwrap(client.POST("/games/bgg-enrich"))).data.games;
}

export async function deleteGamePromise(id: Base58ID) {
    return unwrap(client.DELETE("/games/{id}", { params: { path: { id } } }));
}

export async function listTagsPromise(): Promise<Tag[]> {
    return (await unwrap(client.GET("/tags"))).data;
}

export async function createTagPromise(payload: { name: string }): Promise<Tag> {
    return (await unwrap(client.POST("/tags", { body: { id: newId(), ...payload } }))).data;
}

export async function patchTagPromise(id: Base58ID, payload: { name: string }): Promise<Tag> {
    return (await unwrap(client.PATCH("/tags/{id}", {
        params: { path: { id } },
        body: payload,
    }))).data;
}

export async function deleteTagPromise(id: Base58ID) {
    return unwrap(client.DELETE("/tags/{id}", { params: { path: { id } } }));
}

export async function addGameTagPromise(gameId: Base58ID, tagId: Base58ID) {
    return unwrap(client.POST("/games/{id}/tags", {
        params: { path: { id: gameId } },
        body: { tag_id: tagId },
    }));
}

export async function removeGameTagPromise(gameId: Base58ID, tagId: Base58ID) {
    return unwrap(client.DELETE("/games/{id}/tags/{tagId}", {
        params: { path: { id: gameId, tagId } },
    }));
}
