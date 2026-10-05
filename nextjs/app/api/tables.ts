// Live game tables (generic; per-game payloads, ADR-16/18).
import { client, unwrap, newId, throwApiError } from "./client";
import { getTableClientToken } from "@/lib/table-client";
import type { TableGameState, TableSubmitInput, TableSummary } from "./types";
import type { Base58ID } from "@/lib/id";

export async function listTablesPromise(): Promise<TableSummary[]> {
    return (await unwrap(client.GET("/tables"))).data;
}

export async function createTablePromise(gameId: Base58ID, gameState: TableGameState): Promise<TableSummary> {
    return (await unwrap(client.POST("/tables", {
        body: { id: newId(), game_id: gameId, host_client_token: getTableClientToken(), game_state: gameState },
    }))).data;
}

export async function getTablePromise(tableId: Base58ID): Promise<TableSummary> {
    return (await unwrap(client.GET("/tables/{id}", { params: { path: { id: tableId } } }))).data;
}

/** Result of a host state patch: ok, or a version conflict carrying the current table. */
export type TableStateUpdate =
    | { status: "ok"; table: TableSummary }
    | { status: "conflict"; table: TableSummary };

export async function updateTableState(tableId: Base58ID, version: number, gameState: TableGameState): Promise<TableStateUpdate> {
    const { data, error, response } = await client.PATCH("/tables/{id}/state", {
        params: { path: { id: tableId } },
        body: { version, game_state: gameState },
    });
    if (error) {
        // 409 carries the current table so the caller can merge its edit and
        // retry instead of erasing another writer's input.
        if (response.status === 409) {
            return { status: "conflict", table: (error as { data: TableSummary }).data };
        }
        throwApiError(error);
    }
    return { status: "ok", table: (data as { data: TableSummary }).data };
}

export async function joinTablePromise(tableId: Base58ID): Promise<TableSummary> {
    return (await unwrap(client.POST("/tables/{id}/join", {
        params: { path: { id: tableId } },
    }))).data;
}

/**
 * Claim hosting of the table for this device (the current host may always
 * re-claim — this is also host resume on another device; everyone else needs
 * edit permission). Broadcasts the new claim so the previous host device
 * steps down.
 */
export async function takeoverTablePromise(tableId: Base58ID): Promise<TableSummary> {
    return (await unwrap(client.POST("/tables/{id}/takeover", {
        params: { path: { id: tableId } },
        body: { host_client_token: getTableClientToken() },
    }))).data;
}

export async function submitTablePromise(tableId: Base58ID, input: TableSubmitInput): Promise<TableSummary> {
    return (await unwrap(client.POST("/tables/{id}/submit", {
        params: { path: { id: tableId } },
        body: input,
    }))).data;
}

export async function deleteTablePromise(tableId: Base58ID, matchId?: string): Promise<void> {
    await unwrap(client.DELETE("/tables/{id}", {
        params: {
            path: { id: tableId },
            ...(matchId ? { query: { match_id: matchId } } : {}),
        },
    }));
}
