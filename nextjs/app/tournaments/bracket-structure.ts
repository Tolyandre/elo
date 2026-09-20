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

/**
 * Horizontal column offset of every round, in round-column units (0-based),
 * implementing the classic double-elimination interleave: winners rounds pack
 * from the left; a losers round renders one column right of the deepest
 * winners round it draws seats from — its dependency depth, since every seat
 * waits on that round. It therefore shares a column exactly with the rounds
 * that become playable at the same time: LB round 1 (fed by WB round 1) sits
 * under WB round 2, keeping drop lines in the column gaps. When the winners
 * track ends at that depth (e.g. both WB tables feed LB round 1) no winners
 * round remains to sit under, and the losers round opens its own column —
 * it can only start after that round completes. Offsets grow monotonically,
 * and the final rounds continue after the last track column.
 *
 * `winnersSource(round)` reports the highest winners-track round index the
 * round draws seats from (0 when it draws from none).
 */
export function roundColumnOffsets<T extends TrackRoundLike>(
    rounds: T[],
    winnersSource: (round: T) => number,
): number[] {
    const offsets: number[] = [];
    let prev = -1;
    // Only losers rounds of the same track share the column grid, so
    // monotonicity is tracked among them; winners and losers rounds may
    // occupy the same column in their stacked bands.
    let prevLosers = 0;
    for (const round of rounds) {
        let offset: number;
        if (round.track === "winners") {
            offset = round.index - 1;
        } else if (round.track === "losers") {
            offset = Math.max(winnersSource(round), prevLosers, 1);
            prevLosers = offset + 1;
        } else {
            offset = prev + 1;
        }
        offsets.push(offset);
        prev = offset;
    }
    return offsets;
}

/**
 * Spacer columns to insert before each round of ONE band so it lands on its
 * offset from `roundColumnOffsets`. Every band's flex row starts at column
 * 0, so pass just that band's offsets (the cursor advances past every
 * rendered column, spacers included).
 */
export function offsetSpacers(offsets: number[]): number[] {
    const spacers: number[] = [];
    let cursor = 0;
    for (const offset of offsets) {
        spacers.push(Math.max(0, offset - cursor));
        cursor = offset + 1;
    }
    return spacers;
}
