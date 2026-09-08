// Well-known game ids and the game-app registry for live tables (ADR-16).
//
// The ids are the games-table row ids every environment carries (mirrored in
// elo-web-service/pkg/elo/game_ids.go and testdata/seed.sql); tables pin the
// game they run via game_id, and the frontend routes a table to its game app
// and picks the game when saving the final match by looking the id up here.

import { Skull, Globe, type LucideIcon } from "lucide-react";

import type { CalculatorKind } from "@/components/calculators/registry";
import type { TableGameState, TableSummary } from "@/app/api";
import { toBase58ID, type Base58ID } from "@/lib/id";

// The constants are hardcoded literals; a failed parse is a programming error.
function mustGameID(s: string): Base58ID {
    const id = toBase58ID(s);
    if (!id) throw new Error(`invalid game id constant: ${s}`);
    return id;
}

export const GAME_ID_SKULL_KING = mustGameID("111111111111117m");
export const GAME_ID_IAWW = mustGameID("111111111111111A");

export type GameApp = {
    /** games-table row id (wire form). */
    id: Base58ID;
    calculatorKind: CalculatorKind;
    title: string;
    /** Live table page (host setup / join / play). */
    href: string;
    icon: LucideIcon;
};

export const GAME_APPS: GameApp[] = [
    {
        id: GAME_ID_SKULL_KING,
        calculatorKind: "skull-king",
        title: "Skull King",
        href: "/matches/table/skull-king",
        icon: Skull,
    },
    {
        id: GAME_ID_IAWW,
        calculatorKind: "iaww",
        title: "Этот Безумный Мир",
        href: "/matches/table/iaww",
        icon: Globe,
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
// game id (the ids are unique, so no structural checks are needed).

export function isSkullKingState(state: TableGameState, gameId?: Base58ID): boolean {
    return gameId === undefined ? "rounds" in state : gameId === GAME_ID_SKULL_KING;
}

export function isIawwState(state: TableGameState, gameId?: Base58ID): boolean {
    return gameId === undefined ? "entries" in state : gameId === GAME_ID_IAWW;
}
