// Scoring primitives for the Skull King calculator. Shared between the live
// calculator (app/calculators/skull-king-game/page.tsx) and the saved-match
// editor (app/matches/edit).
//
// The "live" GameState shape (SkullKingGameState) uses positional rounds and a
// `players[]` array, so player ids already live under `players[].id`. The
// storage form (storage.ts) renames that key to `player_id` to keep idcodec
// rewriting automatic — see ADR-09.

import type { SkullKingGameState, SkullKingRoundEntry } from "@/app/api";

export type RoundEntry = SkullKingRoundEntry;
export type GameState = SkullKingGameState;

export const TOTAL_ROUNDS = 10;

export function calcRoundScore(entry: RoundEntry, roundNumber: number, playerCount: number): number {
    if (entry.actual == null) return 0;
    const { bid, actual, bonus } = entry;
    const zeroBase = (playerCount >= 8 && roundNumber >= 9) ? 8 : roundNumber;
    if (actual === bid) {
        return (bid === 0 ? zeroBase * 10 : actual * 20) + bonus;
    }
    if (bid === 0) {
        return zeroBase * -10;
    }
    return Math.abs(bid - actual) * -10;
}

export function playerTotal(
    rounds: (RoundEntry | null)[][],
    playerIndex: number,
    playerCount: number
): number {
    return rounds.reduce((sum, round, ri) => {
        const entry = round[playerIndex];
        if (!entry) return sum;
        return sum + calcRoundScore(entry, ri + 1, playerCount);
    }, 0);
}

// Returns the next index (wrapping) where isFilled(index) is false, or null if all filled.
export function findNextUnfilled(from: number, count: number, isFilled: (i: number) => boolean): number | null {
    for (let i = 1; i < count; i++) {
        const idx = (from + i) % count;
        if (!isFilled(idx)) return idx;
    }
    return null;
}

export const initialState: GameState = {
    phase: "setup",
    players: [],
    currentRound: 1,
    currentPlayerIndex: 0,
    rounds: [],
};
