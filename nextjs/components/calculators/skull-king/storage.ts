// Normalized storage shape for the Skull King calculator state, plus
// conversions to/from the live `GameState` used by the UI.
//
// player ids live under the key "player_id" (in the players[] entries) so
// pkg/api/idcodec_middleware.go rewrites short ↔ canonical ids at the HTTP
// boundary automatically — see ADR-09. rounds[][] are positional (the index
// identifies the player) and therefore contain no player ids.

import type { GameState, RoundEntry } from "./scoring";

export const STORAGE_VERSION = 1 as const;

type StoragePlayer = { player_id: string; name: string };

type StorageEntry = { bid: number; actual: number | null; bonus: number };

export type SkullKingStorage = {
    schema_version: typeof STORAGE_VERSION;
    players: StoragePlayer[];
    current_round: number;
    current_player_index: number;
    rounds: (StorageEntry | null)[][];
    fallback_game_id?: string | null;
};

/** Convert the live UI state into the normalized form persisted on the match. */
export function toStorage(state: GameState): SkullKingStorage {
    return {
        schema_version: STORAGE_VERSION,
        players: state.players.map(p => ({ player_id: p.id, name: p.name })),
        current_round: state.currentRound,
        current_player_index: state.currentPlayerIndex,
        rounds: state.rounds.map(round =>
            (round ?? []).map(entry => entry
                ? { bid: entry.bid, actual: entry.actual ?? null, bonus: entry.bonus }
                : null
            )
        ),
        fallback_game_id: state.fallbackGameId ?? null,
    };
}

/** Reverse of toStorage. Used when opening a saved match in history mode. */
export function fromStorage(s: SkullKingStorage): GameState {
    const rounds: (RoundEntry | null)[][] = (s.rounds ?? []).map(round =>
        (round ?? []).map((entry): RoundEntry | null => entry
            ? { bid: entry.bid, actual: entry.actual ?? null, bonus: entry.bonus }
            : null
        )
    );
    return {
        // History mode lands directly in scoring — players are fixed by the match.
        phase: "result-entry",
        players: (s.players ?? []).map(p => ({ id: p.player_id, name: p.name })),
        currentRound: s.current_round ?? 1,
        currentPlayerIndex: s.current_player_index ?? 0,
        rounds,
        fallbackGameId: s.fallback_game_id ?? undefined,
    };
}
