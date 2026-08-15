import { describe, expect, it } from 'vitest'
import { mergePriceHistory, type ChartPricePoint } from '../app/market/priceHistory'

function point(t: number, yesPrice: number): ChartPricePoint {
    return { t, yesPrice }
}

describe('mergePriceHistory', () => {
    it('returns history alone when there are no live points', () => {
        const history = [point(1, 0.5), point(2, 0.6)]
        expect(mergePriceHistory(history, [])).toEqual(history)
    })

    it('appends live points that are newer and moved the price', () => {
        const history = [point(1, 0.5), point(2, 0.6)]
        const merged = mergePriceHistory(history, [point(3, 0.7)])
        expect(merged).toEqual([point(1, 0.5), point(2, 0.6), point(3, 0.7)])
    })

    it('drops the SSE connect frame echoing the current state', () => {
        // The stream sends the current price on connect; it equals the last
        // replayed point and must not add a flat segment to the chart.
        const history = [point(1, 0.5), point(2, 0.6)]
        const merged = mergePriceHistory(history, [point(3, 0.6)])
        expect(merged).toEqual(history)
    })

    it('drops live points a history refetch already picked up', () => {
        // After a refetch the history includes the bet that produced the live
        // point (same marginal price, earlier timestamp) — only genuinely
        // newer points survive.
        const history = [point(1, 0.5), point(4, 0.7)]
        const merged = mergePriceHistory(history, [point(2, 0.6), point(3, 0.6), point(5, 0.8)])
        expect(merged).toEqual([point(1, 0.5), point(4, 0.7), point(5, 0.8)])
    })

    it('drops the stale connect echo once a newer bet has been refetched', () => {
        // Page opened at t=2 (echo at the then-current price 0.6), a buy at
        // t=4 moved the price, then the refetched history ends at t=4: the
        // t=2 echo predates the newest replayed point and must not resurface.
        const history = [point(1, 0.5), point(4, 0.7)]
        const merged = mergePriceHistory(history, [point(2, 0.6), point(5, 0.7)])
        expect(merged).toEqual([point(1, 0.5), point(4, 0.7)])
    })

    it('keeps a live point while the refetched history is still stale', () => {
        // Between the SSE event and the refetch, the history still ends
        // before the live point — the buy must show up immediately.
        const history = [point(1, 0.5)]
        const merged = mergePriceHistory(history, [point(3, 0.6)])
        expect(merged).toEqual([point(1, 0.5), point(3, 0.6)])
    })

    it('drops consecutive duplicate live frames', () => {
        const merged = mergePriceHistory(
            [point(1, 0.5)],
            [point(2, 0.6), point(3, 0.6)],
        )
        expect(merged).toEqual([point(1, 0.5), point(2, 0.6)])
    })

    it('handles an empty history (market with no bets yet)', () => {
        const merged = mergePriceHistory([], [point(1, 0.5)])
        expect(merged).toEqual([point(1, 0.5)])
    })

    it('does not mutate the inputs', () => {
        const history = [point(1, 0.5)]
        const live = [point(2, 0.6)]
        mergePriceHistory(history, live)
        expect(history).toEqual([point(1, 0.5)])
        expect(live).toEqual([point(2, 0.6)])
    })
})
