// Normalized storage shape for the IAWW calculator state, plus conversions
// to/from the live `GameState` used by the UI.
//
// IMPORTANT: every player id lives under a key named "player_id" (never as an
// object key). This is what lets pkg/api/idcodec_middleware.go rewrite short
// ↔ canonical ids at the HTTP boundary automatically — see ADR-09.
//
// NOTE on the "row" key: the multiplier row identifier is stored under `row`,
// NOT `row_id`. Several IAWW row ids ("structure", "research", "project", …)
// happen to be valid Base58 strings, which the idcodec middleware would decode
// to canonical UUIDs and corrupt. Keys that do NOT end in "_id" are left alone
// by the middleware, so `row` is the safe choice. The shape is validated
// server-side against iaww.v2.json (pkg/calculator).

import type { CellValue, GameState } from "./scoring";

export const STORAGE_VERSION = 2 as const;

export type IAWWStorage = {
    schema_version: typeof STORAGE_VERSION;
    players: { player_id: string; name: string }[];
    direct_vp: { player_id: string; value: number }[];
    multipliers: { row: string; player_id: string; coeff: number; count: number }[];
    fallback_game_id?: string | null;
};

/** Convert the live UI state into the normalized form persisted on the match. */
export function toStorage(state: GameState): IAWWStorage {
    const direct_vp = Object.entries(state.directVP)
        .filter(([, v]) => v != null)
        .map(([player_id, value]) => ({ player_id, value }));
    const multipliers: IAWWStorage["multipliers"] = [];
    for (const [row, byPlayer] of Object.entries(state.multipliers)) {
        for (const [playerId, cell] of Object.entries(byPlayer ?? {})) {
            if (!cell) continue;
            multipliers.push({
                row,
                player_id: playerId,
                coeff: cell.coeff,
                count: cell.count,
            });
        }
    }
    return {
        schema_version: STORAGE_VERSION,
        players: state.players.map(p => ({ player_id: p.id, name: p.name })),
        direct_vp,
        multipliers,
        fallback_game_id: state.fallbackGameId ?? null,
    };
}

/** Reverse of toStorage. Used when opening a saved match in history mode. */
export function fromStorage(s: IAWWStorage): GameState {
    const directVP: Record<string, number> = {};
    for (const { player_id, value } of s.direct_vp ?? []) {
        directVP[player_id] = value;
    }
    const multipliers: Record<string, Record<string, CellValue>> = {};
    for (const m of s.multipliers ?? []) {
        // Accept either the v2 "row" key or a legacy v1 "row_id" key so that a
        // not-yet-migrated document still opens readably.
        const row = (m as { row?: string; row_id?: string }).row ?? (m as { row_id?: string }).row_id ?? "";
        (multipliers[row] ??= {})[m.player_id] = { coeff: m.coeff, count: m.count };
    }
    return {
        // History mode always lands directly in scoring — players are fixed by the match.
        phase: "scoring",
        players: (s.players ?? []).map(p => ({ id: p.player_id, name: p.name })),
        directVP,
        multipliers,
        fallbackGameId: s.fallback_game_id ?? undefined,
    };
}
