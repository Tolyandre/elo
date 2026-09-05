export interface ProbabilityPoint {
    /** Epoch milliseconds. */
    t: number;
    /** Probability in (0,1) of every outcome, keyed by outcome id. Probabilities sum to 1. */
    probabilities: Record<string, number>;
}

function sameProbabilities(a: Record<string, number> | undefined, b: Record<string, number>): boolean {
    if (!a) return false;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
        if (Math.abs((a[k] ?? -1) - (b[k] ?? -1)) >= 1e-9) return false;
    }
    return true;
}

// mergeProbabilityHistory combines the server-replayed history with live points
// appended from the SSE probability stream. A live point is dropped when:
//   - its timestamp is not newer than the newest replayed point — it is
//     covered by the refetched history (or the connect frame echoing the
//     state the history already ends with);
//   - or its probability vector matches the last point before it — a bet always
//     moves some probability, so equal probabilities mean the same event
//     counted twice (replays and SSE broadcast the same probabilities).
export function mergeProbabilityHistory(history: ProbabilityPoint[], live: ProbabilityPoint[]): ProbabilityPoint[] {
    const points = [...history];
    const lastHistoryT = history.length > 0 ? history[history.length - 1].t : -Infinity;
    for (const lp of live) {
        if (lp.t <= lastHistoryT) continue;
        const last = points[points.length - 1];
        if (last && sameProbabilities(last.probabilities, lp.probabilities)) continue;
        points.push(lp);
    }
    return points;
}
