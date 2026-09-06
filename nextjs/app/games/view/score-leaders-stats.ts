import { GameMatch } from "@/app/api";

// Statistics for the "Лидеры по очкам" tab: per player count, only the
// winner's score matters (second and lower places are never included).

export type WinnerScoreBin = {
    from: number;
    /** Exclusive end of the bin range. */
    to: number;
    count: number;
    /** Axis label: the score itself (step 1) or a "from–to" range. */
    label: string;
};

export type WinnerScoreAchiever = {
    name: string;
    /** How many winning matches achieved this exact score. */
    count: number;
};

export type WinnerScoreTop = {
    score: number;
    achievers: WinnerScoreAchiever[];
};

export type ScoreLeadersSection = {
    playerCount: number;
    matchCount: number;
    distribution: WinnerScoreBin[];
    topScores: WinnerScoreTop[];
};

const MAX_BINS = 15;
const TOP_SCORES = 5;

export function computeWinnerScoreStats(matches: GameMatch[]): ScoreLeadersSection[] {
    const byPlayerCount = new Map<number, GameMatch[]>();
    for (const match of matches) {
        if (match.players.length === 0) continue;
        const group = byPlayerCount.get(match.players.length);
        if (group) {
            group.push(match);
        } else {
            byPlayerCount.set(match.players.length, [match]);
        }
    }

    return [...byPlayerCount.keys()]
        .sort((a, b) => a - b)
        .map((playerCount) => {
            const group = byPlayerCount.get(playerCount)!;
            const winners = group.map(winnerOf);
            return {
                playerCount,
                matchCount: group.length,
                distribution: buildDistribution(winners.map(w => w.score)),
                topScores: buildTopScores(winners),
            };
        });
}

/**
 * Every player holding the top score of the match is a winner — same rule
 * MatchCard uses to assign rank 1 on a tie. The match still contributes one
 * score to the distribution; only the achiever list holds several names.
 */
function winnerOf(match: GameMatch): { score: number; names: string[] } {
    const max = Math.max(...match.players.map(p => p.score));
    return { score: max, names: match.players.filter(p => p.score === max).map(p => p.name) };
}

function buildDistribution(scores: number[]): WinnerScoreBin[] {
    if (scores.length === 0) return [];
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const step = pickStep(max - min);
    const start = Math.floor(min / step + 1e-9) * step;

    const bins: WinnerScoreBin[] = [];
    for (const score of scores) {
        const index = Math.floor((score - start) / step + 1e-9);
        while (bins.length <= index) {
            const from = start + bins.length * step;
            bins.push({
                from,
                to: from + step,
                count: 0,
                label: binLabel(from, from + step, step),
            });
        }
        bins[index].count++;
    }
    return bins;
}

/**
 * Smallest "nice" step (1, 2, 5 × 10^k) keeping the histogram within MAX_BINS
 * columns.
 */
function pickStep(span: number): number {
    for (let exp = 0; exp <= 9; exp++) {
        for (const mantissa of [1, 2, 5]) {
            const step = mantissa * 10 ** exp;
            if (Math.floor(span / step + 1e-9) + 1 <= MAX_BINS) return step;
        }
    }
    return 10 ** 10;
}

function binLabel(from: number, to: number, step: number): string {
    return step === 1 ? `${from}` : `${from}–${to - 1}`;
}

function buildTopScores(winners: { score: number; names: string[] }[]): WinnerScoreTop[] {
    const byScore = new Map<number, Map<string, number>>();
    for (const { score, names } of winners) {
        let achievers = byScore.get(score);
        if (!achievers) {
            achievers = new Map();
            byScore.set(score, achievers);
        }
        for (const name of names) {
            achievers.set(name, (achievers.get(name) ?? 0) + 1);
        }
    }
    return [...byScore.entries()]
        .sort((a, b) => b[0] - a[0])
        .slice(0, TOP_SCORES)
        .map(([score, names]) => ({
            score,
            achievers: [...names.entries()]
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(([name, count]) => ({ name, count })),
        }));
}

/** Russian pluralization: "2 игрока", "5 игроков", "21 игрок". */
export function formatPlayerCount(n: number): string {
    const mod100 = n % 100;
    const mod10 = n % 10;
    if (mod10 === 1 && mod100 !== 11) return `${n} игрок`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} игрока`;
    return `${n} игроков`;
}
