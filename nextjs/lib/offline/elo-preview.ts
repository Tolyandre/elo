// Client-side settlement preview (ADR-37): what the server is expected to
// compute for a match whose current state has not settled — an offline-created
// match, or a saved match with a queued edit (whose server settlement columns
// describe the pre-edit state). Advisory only: the sync always replaces it
// with the server's settlement, and the preview is never persisted anywhere.
//
// Both tracks mirror elo-web-service. The Elo math reuses the existing mirror
// in app/eloCalculation.ts (calculateEloChanges, normaliseScores,
// expectedScoreForRating, scaleRating*); the rating track repeats
// pkg/elo/arena_calc.go:buildArenaResults — the expectation is computed at the
// player's own rating against opponents' true elos, then earned/staked are
// scaled by the elo↔rating gap when the arena's catch_up parameters are known.
//
// Best effort by design: a player without a known prior state settles from the
// starting values — the server's own rule — and missing arena parameters skip
// the catch-up scaling. The server's replay stays the single source of truth.

import {
    calculateEloChanges,
    expectedScoreForRating,
    normaliseScores,
    scaleRatingEarned,
    scaleRatingStaked,
} from "@/app/eloCalculation";

/** Per-player preview row — the same quantities the server settlement
 * columns carry, plus the elo track the wire does not expose. */
export type SettlementPreviewRow = {
    eloBefore: number;
    eloAfter: number;
    eloStaked: number; // −K·E
    eloEarned: number; // +K·S
    ratingBefore: number;
    ratingAfter: number;
    ratingStaked: number;
    ratingEarned: number;
};

export type SettlementPreview = Record<string, SettlementPreviewRow>;

export type PreviewSettings = {
    k: number;
    d: number;
    startingElo: number;
    winReward: number;
    startingRatingDefault: number;
};

/** The settling arena's catch_up parameters (parseArenaSettings). */
export type PreviewCatchUp = { earnedMin: number; earnedMax: number; tau: number };

export type PreviewHistoryPoint = { elo: number; rating: number };

export type PreviewInput = {
    /** The effective (post-edit) competitive score map. */
    scores: Record<string, number>;
    matchDate: Date;
    /** Latest known settlement per player strictly before the match date; null = none known. */
    history: Map<string, PreviewHistoryPoint | null>;
    settings: PreviewSettings;
    catchUp?: PreviewCatchUp | null;
};

/**
 * The preview settlement per player, or null when it cannot be meaningfully
 * computed (fewer than two players — coop matches never settle and pass an
 * empty score map in the first place).
 */
export function previewSettlement(input: PreviewInput): SettlementPreview | null {
    const participants = Object.entries(input.scores).map(([id, points]) => ({ id, points }));
    if (participants.length < 2) return null;

    const { k, d, startingElo, winReward, startingRatingDefault } = input.settings;

    const elos: number[] = [];
    const ratings: number[] = [];
    for (const p of participants) {
        const prior = input.history.get(p.id) ?? null;
        elos.push(prior ? prior.elo : startingElo);
        ratings.push(prior ? prior.rating : startingRatingDefault);
    }

    // Elo track — the shared mirror of pkg/elo/elo.go.
    const eloChanges = calculateEloChanges(
        participants,
        new Map(participants.map((p, i) => [p.id, elos[i]])),
        k,
        d,
        startingElo,
        winReward,
    );
    // The normalized share is identical on both tracks (server: one
    // NormalizedScore call reused), so compute it once.
    const normalized = normaliseScores(participants.map((p) => p.points), winReward);

    const preview: SettlementPreview = {};
    for (let i = 0; i < participants.length; i++) {
        const p = participants[i];
        const eloChange = eloChanges[i];
        // Rating track (buildArenaResults): own rating vs opponents' true
        // elos in the expectation; earned/staked scaled by the gap.
        const ratingStakedRaw = -k * expectedScoreForRating(elos, ratings, i, d);
        const ratingEarnedRaw = k * normalized[i];
        const catchUp = input.catchUp;
        const ratingStaked = catchUp
            ? scaleRatingStaked(ratingStakedRaw, elos[i], ratings[i], k, catchUp.earnedMax, catchUp.tau)
            : ratingStakedRaw;
        const ratingEarned = catchUp
            ? scaleRatingEarned(ratingEarnedRaw, elos[i], ratings[i], k, catchUp.earnedMin, catchUp.earnedMax, catchUp.tau)
            : ratingEarnedRaw;

        preview[p.id] = {
            eloBefore: elos[i],
            eloAfter: elos[i] + eloChange.delta,
            eloStaked: eloChange.minus,
            eloEarned: eloChange.plus,
            ratingBefore: ratings[i],
            ratingAfter: ratings[i] + ratingStaked + ratingEarned,
            ratingStaked,
            ratingEarned,
        };
    }
    return preview;
}

/**
 * The latest rating-history point strictly before the match date — the prior
 * state the server would settle this match from. Scans without assuming an
 * order; null when every point sits at or after the match (or history is
 * empty) — the caller falls back to the starting values.
 */
export function priorHistoryPoint(
    history: { date: string; rating: number; elo: number }[],
    matchDate: Date,
): PreviewHistoryPoint | null {
    let best: PreviewHistoryPoint | null = null;
    let bestTime = -Infinity;
    const at = matchDate.getTime();
    for (const point of history) {
        const time = new Date(point.date).getTime();
        if (time < at && time > bestTime) {
            bestTime = time;
            best = { elo: point.elo, rating: point.rating };
        }
    }
    return best;
}
