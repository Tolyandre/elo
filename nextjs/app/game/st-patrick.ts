function comb(a: number, b: number): bigint {
    if (b < 0 || b > a) return 0n;
    if (b === 0 || b === a) return 1n;
    const k = Math.min(b, a - b);
    let res = 1n;
    for (let i = 1; i <= k; ++i) {
        res = res * BigInt(a - k + i) / BigInt(i);
    }
    return res;
}

/**
 * Probability that at least one opponent is forced to take the trick.
 * An opponent is "forced" if they have 0 lower black cards AND ≥1 higher black cards
 * (they must follow suit and all their black cards beat our card).
 *
 * Uses inclusion-exclusion over the m opponents.
 *
 * @param m  number of opponents (numberOfPlayers - 1)
 * @param n  cards in each player's hand
 * @param L  opponent lower black cards (rank < played card)
 * @param H  opponent higher black cards (rank > played card)
 */
export function forcedToTakeProbability(
    m: number,
    n: number,
    L: number,
    H: number,
): number {
    if (H === 0) return 0;

    const N = m * n;
    const total = comb(N, L) * comb(N - L, H);
    if (total === 0n) return 0;

    let favorableSum = 0n;
    for (let k = 1; k <= m; k++) {
        // Ways to place all L lower cards into the (m-k)*n non-forced slots
        const lowerWays = comb((m - k) * n, L);

        // Inclusion-exclusion: each of k forced opponents has ≥1 higher card
        let innerSum = 0n;
        for (let j = 0; j <= k; j++) {
            const slots = N - L - j * n;
            const term = comb(k, j) * comb(slots, H);
            if (j % 2 === 0) {
                innerSum += term;
            } else {
                innerSum -= term;
            }
        }

        const favorable = lowerWays * innerSum;
        const kSign = k % 2 === 1 ? 1n : -1n;
        favorableSum += kSign * comb(m, k) * favorable;
    }

    return Number(favorableSum) / Number(total);
}
