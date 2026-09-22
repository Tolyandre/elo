// Well-known game ids and the game-app registry for live tables (ADR-16).
//
// The ids are the games-table row ids every environment carries (mirrored in
// elo-web-service/pkg/elo/game_ids.go and testdata/seed.sql); tables pin the
// game they run via game_id, and the frontend routes a table to its game app
// and picks the game when saving the final match by looking the id up here.
//
// The per-game UI bindings (the in-table view components) live separately in
// components/tables/registry.tsx, so this module stays importable from
// non-component code and import cycles stay impossible.

import { Skull, Globe, type LucideIcon } from "lucide-react";

import type { CalculatorKind } from "@/components/calculators/registry";
import {
    type IawwGameState,
    type SkullKingGameState,
    type TableGameState,
    type TablePlayer,
    type TableSummary,
} from "@/app/api";
import { mergeSkullKingStates } from "@/components/calculators/skull-king/merge";
import { mergeIawwStates } from "@/components/calculators/iaww/merge";
import { toBase58ID, type Base58ID } from "@/lib/id";

// The constants are hardcoded literals; a failed parse is a programming error.
function mustGameID(s: string): Base58ID {
    const id = toBase58ID(s);
    if (!id) throw new Error(`invalid game id constant: ${s}`);
    return id;
}

export const GAME_ID_SKULL_KING = mustGameID("111111111111117m");
export const GAME_ID_IAWW = mustGameID("111111111111111A");

/** The unified live-table page; the game is resolved from the table's game_id. */
export const TABLE_PAGE_PATH = "/matches/table";

export type GameApp = {
    /** games-table row id (wire form). */
    id: Base58ID;
    calculatorKind: CalculatorKind;
    title: string;
    /** The live-table page the app opens into (shared by all games). */
    href: string;
    icon: LucideIcon;
    /** Fewest participants a new table can be created with. */
    minPlayers: number;
    /**
     * The server state a new table starts with. Players are picked at table
     * creation (in seating order) — there is no setup phase on the table
     * itself, so the state lands directly in the game's first active phase.
     */
    createInitialState(players: TablePlayer[]): TableGameState;
    /** One-line status of a running table for the lobby ("Раунд 3", …). */
    statusText(state: TableGameState): string;
};

export const GAME_APPS: GameApp[] = [
    {
        id: GAME_ID_SKULL_KING,
        calculatorKind: "skull-king",
        title: "Skull King",
        href: TABLE_PAGE_PATH,
        icon: Skull,
        minPlayers: 2,
        createInitialState: (players) => ({
            phase: "waiting-for-bids",
            players,
            currentRound: 1,
            currentPlayerIndex: 0,
            // Pre-initialize round 1 slots so connected players can submit
            // bids immediately: an empty rounds array makes the backend
            // reject bids with ErrWrongPhase.
            rounds: [players.map(() => null)],
        }),
        statusText: (state) => {
            const s = state as SkullKingGameState; // only called with this game's state
            return s.phase === "setup" ? "Ожидание игроков" : `Раунд ${s.currentRound}`;
        },
    },
    {
        id: GAME_ID_IAWW,
        calculatorKind: "iaww",
        title: "Этот Безумный Мир",
        href: TABLE_PAGE_PATH,
        icon: Globe,
        minPlayers: 2,
        createInitialState: (players) => ({
            phase: "scoring",
            players,
            entries: players.map((p) => ({
                playerId: p.id,
                directVp: null,
                cells: [],
                done: false,
            })),
        }),
        statusText: (state) => {
            const s = state as IawwGameState; // only called with this game's state
            const done = s.entries.filter((e) => e.done).length;
            return `Готовы ${done}/${s.entries.length}`;
        },
    },
];

export function gameAppByGameId(gameId: Base58ID | null | undefined): GameApp | undefined {
    if (!gameId) return undefined;
    return GAME_APPS.find((app) => app.id === gameId);
}

export function gameAppByTable(table: Pick<TableSummary, "game_id">): GameApp | undefined {
    return gameAppByGameId(table.game_id);
}

// ─── Table state narrowing ───────────────────────────────────────────────────
// TableSummary.game_state is a union over all games; narrow by the table's
// game id (the ids are unique, so no structural checks are needed). The
// gameId argument trusts the caller: only the structural form narrows.

export function isSkullKingState(state: TableGameState, gameId?: Base58ID): state is SkullKingGameState {
    return gameId === undefined ? "rounds" in state : gameId === GAME_ID_SKULL_KING;
}

export function isIawwState(state: TableGameState, gameId?: Base58ID): state is IawwGameState {
    return gameId === undefined ? "entries" in state : gameId === GAME_ID_IAWW;
}

/**
 * Three-way merge of a host patch with the fresh server state, dispatched by
 * the table's game (the per-game merges are described in useTableSession).
 * Falls back to the fresh state when the game or the state shapes do not
 * match — the tables page renders only known games, so this is a safety net,
 * not a normal path.
 */
export function mergeTableStates(
    gameId: Base58ID,
    before: TableGameState,
    local: TableGameState,
    fresh: TableGameState,
): TableGameState {
    if (
        gameId === GAME_ID_SKULL_KING &&
        isSkullKingState(before) && isSkullKingState(local) && isSkullKingState(fresh)
    ) {
        return mergeSkullKingStates(before, local, fresh);
    }
    if (
        gameId === GAME_ID_IAWW &&
        isIawwState(before) && isIawwState(local) && isIawwState(fresh)
    ) {
        return mergeIawwStates(before, local, fresh);
    }
    return fresh;
}
