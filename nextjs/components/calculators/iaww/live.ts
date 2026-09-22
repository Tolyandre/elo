// Live-table helpers for the IAWW game app (ADR-16). The table's wire state
// (IawwGameState: per-player entries) is the source of truth; these helpers
// bridge it to the calculator-side shapes used by the shared scoring UI
// (components/calculators/iaww) and build the player's one-shot submission.

import type { IawwGameState } from "@/app/api";
import type { CellValue, GameState } from "./scoring";

/** Wire entries → the calculator's map-based GameState for rendering/saving. */
export function liveToCalc(state: IawwGameState): GameState {
    const directVP: Record<string, number> = {};
    const multipliers: Record<string, Record<string, CellValue>> = {};
    for (const entry of state.entries) {
        directVP[entry.playerId] = entry.directVp ?? 0;
        for (const cell of entry.cells) {
            (multipliers[cell.row] ??= {})[entry.playerId] = { coeff: cell.coeff, count: cell.count };
        }
    }
    return {
        phase: "scoring",
        players: state.players,
        directVP,
        multipliers,
        fallbackGameId: state.fallbackGameId ?? undefined,
    };
}
