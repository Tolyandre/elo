"use client";
import type { Base58ID } from "@/lib/id";

import type { ComponentType } from "react";
import type { CampSelection } from "@/hooks/useCampSelection";
import type { TableGameState, TableSubmitInput, TableSummary } from "@/app/api";
import { GAME_APPS, type GameApp } from "@/lib/game-apps";

import { SkullKingGameView } from "./skull-king/game-view";
import { WakeLockButton } from "./skull-king/wake-lock-button";
import { IawwGameView } from "./iaww/game-view";

/** The host hands to the save flow when saving the finished match. */
export type TableMatchPayload = {
    /** Player id → final score. */
    score: Record<string, number>;
    /** The game's calculator document (storage shape, ADR-09). */
    calculatorData: Record<string, never>;
};

/**
 * Everything a game's in-table UI gets from the shared tables page: the page
 * owns the session, the SSE wiring, the header chrome and the save flow
 * (ADR-16/ADR-18); a game only renders its phases and builds its inputs.
 * The state arrives as the union over all games — a view narrows it with its
 * game's guard (lib/game-apps) and returns null before the first snapshot.
 */
export type TableGameViewProps = {
    gameState: TableGameState | null;
    /** The adopted table snapshot (null before the first snapshot). */
    table: TableSummary | null;
    /** Role: the host drives the game; a connected player submits their own
        input; `myPlayerIndex === null` on top of `!isHost` is a viewer. */
    isHost: boolean;
    myPlayerIndex: number | null;
    connectedPlayerIds: Base58ID[];
    /** Live table-SSE connection (the offline banner is rendered by the page). */
    sseConnected: boolean;
    /** Host mutation flags for button spinners (see useTableSession). */
    isSyncing: boolean;
    isTransitioning: boolean;
    syncHostState(updater: (prev: TableGameState) => TableGameState): Promise<"ok" | "conflict" | "error">;
    /** Host phase change: the same patch, with its own in-flight flag. */
    doPhaseTransition(updater: (prev: TableGameState) => TableGameState): Promise<void>;
    /** Fire-and-forget host mutation (tab switches and similar UI state). */
    setGameState(updater: (prev: TableGameState) => TableGameState): void;
    /** Connected player's input (bid, result, score cell). */
    submitInput(input: TableSubmitInput): Promise<void>;
    /** Camp/arena checkboxes for the saved match (ADR-27). */
    campSelection: CampSelection;
    /** Current identity — gates the save button like the match form does. */
    me: { isAuthenticated: boolean; playerId?: Base58ID; id?: string; canEdit: boolean };
    saving: boolean;
    saveError: string;
    /** Host: queue the final match, then tear the table down on the page. */
    saveMatch(payload: TableMatchPayload): Promise<void>;
};

export type TableGameEntry = GameApp & {
    /** The in-table UI for this game. */
    view: ComponentType<TableGameViewProps>;
    /** Extra header controls (e.g. the wake-lock toggle). */
    headerExtras?: ComponentType;
};

/** Game apps with their UI bindings, for the unified /matches/table page. */
export const TABLE_GAMES: TableGameEntry[] = [
    { ...GAME_APPS[0], view: SkullKingGameView, headerExtras: WakeLockButton },
    { ...GAME_APPS[1], view: IawwGameView },
];

export function tableGameByGameId(gameId: Base58ID | null | undefined): TableGameEntry | undefined {
    if (!gameId) return undefined;
    return TABLE_GAMES.find((game) => game.id === gameId);
}

export function tableGameByTable(table: Pick<TableSummary, "game_id">): TableGameEntry | undefined {
    return tableGameByGameId(table.game_id);
}
