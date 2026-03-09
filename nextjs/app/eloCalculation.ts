export type EloChange = {
    id: string;
    minus: number;
    plus: number;
    delta: number;
};

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
                .map(inner_p => 1 / (1 + Math.pow(10, (getPlayerElo(inner_p.id) - getPlayerElo(p.id)) / d)))
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
