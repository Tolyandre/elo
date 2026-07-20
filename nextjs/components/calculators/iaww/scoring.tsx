// Scoring primitives and shared types for the It's a Wonderful World
// ("Этот Безумный Мир") calculator. Shared between the live calculator page
// (app/its-a-wonderful-world/page.tsx) and the saved-match editor
// (app/matches/edit).
//
// The "live" `GameState` shape mirrors what the in-browser scoring UI holds:
//   - directVP[playerId]       — direct victory-point entry
//   - multipliers[rowId][playerId] = { coeff, count }
//
// This shape is convenient for the UI but stores player ids as OBJECT KEYS,
// which the idcodec middleware would NOT rewrite at the HTTP boundary. So the
// persisted form is normalized (see storage.ts): player ids move under
// "player_id" keys inside arrays, so idcodec rewrites them automatically.

import type { ReactNode } from "react";
import {
    ResearchIcon, DiscoveryIcon, StructureIcon, ProjectIcon, VehicleIcon,
    GeneralToken, FinancierToken, CultureToken,
} from "./iaww-icons";

export type RowDef =
    | { id: string; kind: "direct" }
    | { id: string; kind: "single"; icon: ReactNode }
    | { id: string; kind: "pair"; coeff: number; icon: ReactNode; icon2: ReactNode };

export const S = "1.8em";

export const ROWS: RowDef[] = [
    { id: "direct", kind: "direct" },
    { id: "structure",  kind: "single", icon: <StructureIcon size={S} /> },
    { id: "vehicle",    kind: "single", icon: <VehicleIcon size={S} /> },
    { id: "research",   kind: "single", icon: <ResearchIcon size={S} /> },
    { id: "project",    kind: "single", icon: <ProjectIcon size={S} /> },
    { id: "discovery",  kind: "single", icon: <DiscoveryIcon size={S} /> },
    { id: "financier",  kind: "single", icon: <FinancierToken size={S} /> },
    { id: "general",    kind: "single", icon: <GeneralToken size={S} /> },
    { id: "culture",    kind: "single", icon: <CultureToken size={S} /> },
    // Pairs with fixed score-per-set multipliers
    { id: "str-res",  coeff:  6, kind: "pair", icon: <StructureIcon size={S} />,  icon2: <ResearchIcon size={S} /> },
    { id: "res-dis",  coeff: 10, kind: "pair", icon: <ResearchIcon size={S} />,   icon2: <DiscoveryIcon size={S} /> },
    { id: "str-pro",  coeff:  7, kind: "pair", icon: <StructureIcon size={S} />,  icon2: <ProjectIcon size={S} /> },
    { id: "veh-pro",  coeff:  8, kind: "pair", icon: <VehicleIcon size={S} />,    icon2: <ProjectIcon size={S} /> },
    { id: "res-pro",  coeff:  9, kind: "pair", icon: <ResearchIcon size={S} />,   icon2: <ProjectIcon size={S} /> },
    { id: "pro-dis",  coeff: 12, kind: "pair", icon: <ProjectIcon size={S} />,    icon2: <DiscoveryIcon size={S} /> },
    { id: "veh-res",  coeff:  6, kind: "pair", icon: <VehicleIcon size={S} />,    icon2: <ResearchIcon size={S} /> },
    { id: "str-veh",  coeff:  6, kind: "pair", icon: <StructureIcon size={S} />,  icon2: <VehicleIcon size={S} /> },
    { id: "fin-gen",  coeff:  6, kind: "pair", icon: <FinancierToken size={S} />, icon2: <GeneralToken size={S} /> },
    { id: "dis-fin",  coeff:  6, kind: "pair", icon: <DiscoveryIcon size={S} />,  icon2: <FinancierToken size={S} /> },
    { id: "veh-fin",  coeff:  6, kind: "pair", icon: <VehicleIcon size={S} />,    icon2: <FinancierToken size={S} /> },
    { id: "pro-gen",  coeff:  6, kind: "pair", icon: <ProjectIcon size={S} />,    icon2: <GeneralToken size={S} /> },
    { id: "str-gen",  coeff:  5, kind: "pair", icon: <StructureIcon size={S} />,  icon2: <GeneralToken size={S} /> },
];

export type CellValue = { coeff: number; count: number };

/** Live in-browser state. Shared by the calculator page and the history editor. */
export type GameState = {
    phase: "setup" | "scoring";
    players: { id: string; name: string }[];
    directVP: Record<string, number>;
    multipliers: Record<string, Record<string, CellValue>>;
    fallbackGameId?: string;
};

export const INITIAL: GameState = {
    phase: "setup",
    players: [],
    directVP: {},
    multipliers: {},
};

export function cellVP(cell?: CellValue): number {
    if (!cell) return 0;
    return (cell.coeff || 0) * (cell.count || 0);
}

export function playerTotal(state: GameState, playerId: string): number {
    const direct = state.directVP[playerId] || 0;
    return ROWS
        .filter((r): r is RowDef & { kind: "single" | "pair" } => r.kind !== "direct")
        .reduce((sum, row) => sum + cellVP(state.multipliers[row.id]?.[playerId]), direct);
}

export type EditTarget =
    | { kind: "direct"; playerId: string }
    | { kind: "multiplier"; rowId: string; playerId: string };
