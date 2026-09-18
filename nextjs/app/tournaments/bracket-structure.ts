import type { BracketRound } from "@/app/api";

// Bracket structure helpers shared by the live bracket view and the plan
// preview (ADR-26): the DTO/plan lists rounds grouped winners → losers →
// final, and both renderers turn that into stacked track bands of
// column-per-round sections.

export interface TrackRoundLike {
    track: BracketRound["track"];
    index: number;
}

/** Rounds grouped into consecutive track sections; canonical track order. */
export function groupByTrack<T extends TrackRoundLike>(rounds: T[]): { track: T["track"]; rounds: T[] }[] {
    const tracks: { track: T["track"]; rounds: T[] }[] = [];
    for (const round of rounds) {
        const last = tracks[tracks.length - 1];
        if (last && last.track === round.track) {
            last.rounds.push(round);
        } else {
            tracks.push({ track: round.track, rounds: [round] });
        }
    }
    return tracks;
}
