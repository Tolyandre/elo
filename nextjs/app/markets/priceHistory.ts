export interface ChartPricePoint {
    /** Epoch milliseconds. */
    t: number;
    /** Marginal price in (0,1) of every outcome, keyed by outcome id. Prices sum to 1. */
    prices: Record<string, number>;
}

function samePrices(a: Record<string, number> | undefined, b: Record<string, number>): boolean {
    if (!a) return false;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
        if (Math.abs((a[k] ?? -1) - (b[k] ?? -1)) >= 1e-9) return false;
    }
    return true;
}

// mergePriceHistory combines the server-replayed history with live points
// appended from the SSE price stream. A live point is dropped when:
//   - its timestamp is not newer than the newest replayed point — it is
//     covered by the refetched history (or the connect frame echoing the
//     state the history already ends with);
//   - or its price vector matches the last point before it — a bet always
//     moves some price, so equal prices mean the same event counted twice
//     (replays and SSE broadcast the same marginal prices).
export function mergePriceHistory(history: ChartPricePoint[], live: ChartPricePoint[]): ChartPricePoint[] {
    const points = [...history];
    const lastHistoryT = history.length > 0 ? history[history.length - 1].t : -Infinity;
    for (const lp of live) {
        if (lp.t <= lastHistoryT) continue;
        const last = points[points.length - 1];
        if (last && samePrices(last.prices, lp.prices)) continue;
        points.push(lp);
    }
    return points;
}
