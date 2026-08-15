export interface ChartPricePoint {
    /** Epoch milliseconds. */
    t: number;
    /** Marginal yes-price in (0,1). */
    yesPrice: number;
}

// mergePriceHistory combines the server-replayed history with live points
// appended from the SSE price stream. A live point is dropped when:
//   - its timestamp is not newer than the newest replayed point — it is
//     covered by the refetched history (or the connect frame echoing the
//     state the history already ends with);
//   - or its price matches the last point before it — a bet always moves the
//     price, so an equal price means the same event counted twice (replays
//     and SSE broadcast the same marginal price).
export function mergePriceHistory(history: ChartPricePoint[], live: ChartPricePoint[]): ChartPricePoint[] {
    const points = [...history];
    const lastHistoryT = history.length > 0 ? history[history.length - 1].t : -Infinity;
    for (const lp of live) {
        if (lp.t <= lastHistoryT) continue;
        const last = points[points.length - 1];
        if (last && Math.abs(last.yesPrice - lp.yesPrice) < 1e-9) continue;
        points.push(lp);
    }
    return points;
}
