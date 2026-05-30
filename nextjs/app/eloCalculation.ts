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

// Mirror of elo-web-service/pkg/elo/matches.go:ratingK
export function ratingK(gap: number, kStd: number, kMax: number, tau: number): number {
    return kStd + (kMax - kStd) * (1 - Math.exp(-Math.abs(gap) / tau))
}

// Mirror of elo-web-service/pkg/elo/matches.go:applyNewbieClamping
export function applyNewbieClamping(league: string, staked: number, earned: number): [number, number] {
    if (league === "newbie" && staked + earned < 0) return [0, 1]
    return [staked, earned]
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
