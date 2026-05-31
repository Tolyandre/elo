export type EloChange = {
    id: string;
    minus: number;
    plus: number;
    delta: number;
};

// Pairwise win probability p(self beats opponent).
// Used as a building block for expectedScore and expectedScoreForRating.
// Mirror of the p_ij term inside elo-web-service/pkg/elo/elo.go:WinExpectation
export function pairwiseExpected(selfElo: number, opponentElo: number, D: number): number {
    return 1 / (1 + Math.pow(10, (opponentElo - selfElo) / D))
}

export function calculateEloChanges(
    participants: { id: string; points: number }[],
    playerElos: Map<string, number>,
    k: number,
    d: number,
    startingElo: number,
    winReward: number
): EloChange[] {
    const getPlayerElo = (id: string) => playerElos.get(id) ?? startingElo;
    const playersCount = participants.length;

    const absoluteLoserScore = participants
        .map(p => p.points)
        .reduce((prev, cur) => Math.min(prev, cur), Number.MAX_VALUE);

    return participants.map((p) => {
        const winExpectation =
            (participants
                .map(inner_p => pairwiseExpected(getPlayerElo(p.id), getPlayerElo(inner_p.id), d))
                .reduce((prev, curr) => prev + curr) - 0.5) /
            (playersCount * (playersCount - 1) / 2);

        const normalizedScore =
            Math.pow(p.points - absoluteLoserScore, winReward) /
            participants
                .map(inner_p => Math.pow(inner_p.points - absoluteLoserScore, winReward))
                .reduce((prev, cur) => prev + cur, 0);

        const minus = -k * (isNaN(winExpectation) ? 1 : winExpectation);
        const plus = k * (isNaN(normalizedScore) ? 1 / playersCount : normalizedScore);

        return {
            id: p.id,
            minus,
            plus,
            delta: plus + minus,
        };
    });
}

// Mirror of elo-web-service/pkg/elo/matches.go:scaleRatingEarned
// Amplifies earned only when elo > rating (rating still catching up).
// When rating >= elo, returns ratingEarnedRaw unchanged (standard Elo).
export function scaleRatingEarned(
    ratingEarnedRaw: number, prevElo: number, prevRating: number,
    K: number, earnedMin: number, earnedMax: number, tau: number
): number {
    if (prevRating >= prevElo) return ratingEarnedRaw
    const gap = prevElo - prevRating
    const t = 1 - Math.exp(-gap / tau)
    const effMin = earnedMin * t
    const effMax = K + (earnedMax - K) * t
    if (K === 0) return effMin
    return effMin + (ratingEarnedRaw / K) * (effMax - effMin)
}

// Mirror of elo-web-service/pkg/elo/matches.go:scaleRatingStaked
// Amplifies staked only when rating > elo (rating has overshot, needs to come back).
// When rating <= elo, returns ratingStakedRaw unchanged (standard Elo).
export function scaleRatingStaked(
    ratingStakedRaw: number, prevElo: number, prevRating: number,
    K: number, earnedMax: number, tau: number
): number {
    if (prevRating <= prevElo || K === 0) return ratingStakedRaw
    const gap = prevRating - prevElo
    const t = 1 - Math.exp(-gap / tau)
    const stakedScale = K + (earnedMax - K) * t
    return ratingStakedRaw * (stakedScale / K)
}

// Numerical estimate of wins needed to close the directed gap (elo − rating) to goalGap.
// Returns [lower, upper] bounds:
//   lower: elo treated as fixed (only rating grows per win)
//   upper: elo also grows ≈ K/2 per win (conservative 2-player equal-elo approximation)
// Δ_win(g) = earnedMax(g) − K·E(g), E(g) = 1/(1+10^(g/D))
export function winsNeededForAmateur(
    gap: number, goalGap: number, K: number, earnedMax: number, tau: number, D: number
): [number, number] {
    if (gap <= goalGap || D === 0) return [0, 0]
    const STEP = 1
    const deltaEloPerWin = K / 2
    let totalLower = 0, totalUpper = 0
    for (let g = goalGap; g < gap; g += STEP) {
        const delta = Math.min(STEP, gap - g)
        const mid = g + delta / 2
        const eMax = K + (earnedMax - K) * (1 - Math.exp(-mid / tau))
        const eWin = 1 / (1 + Math.pow(10, mid / D))
        const netRating = eMax - K * eWin
        if (netRating > 0) totalLower += delta / netRating
        const netGap = netRating - deltaEloPerWin
        if (netGap > 0) totalUpper += delta / netGap
    }
    return [Math.ceil(totalLower), Math.ceil(totalUpper)]
}

// Mirror of elo-web-service/pkg/elo/elo.go:NormalizedScore
export function normaliseScores(rawScores: number[], W: number): number[] {
    const min = Math.min(...rawScores)
    const shifted = rawScores.map(s => Math.pow(Math.max(s - min, 0), W))
    const total = shifted.reduce((a, b) => a + b, 0)
    if (total === 0) return rawScores.map(() => 1 / rawScores.length)
    return shifted.map(v => v / total)
}

// Mirror of elo-web-service/pkg/elo/elo.go:WinExpectation
export function expectedScore(elos: number[], i: number, D: number): number {
    let sum = 0
    for (let j = 0; j < elos.length; j++) {
        if (j !== i) sum += pairwiseExpected(elos[i], elos[j], D)
    }
    return sum / (elos.length * (elos.length - 1) / 2)
}

// Mirror of elo-web-service/pkg/elo/matches.go:buildEloResults (rating track).
// Player i is seen at ratings[i]; opponents use their true elos[j].
// This drives convergence: when rating[i] < elo[i], E_rating < E_elo → net rating
// gain per game exceeds net elo gain → rating rises toward elo.
export function expectedScoreForRating(elos: number[], ratings: number[], i: number, D: number): number {
    let sum = 0
    for (let j = 0; j < elos.length; j++) {
        if (j !== i) sum += pairwiseExpected(ratings[i], elos[j], D)
    }
    return sum / (elos.length * (elos.length - 1) / 2)
}
