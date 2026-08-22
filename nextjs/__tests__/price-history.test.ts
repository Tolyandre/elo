import { describe, expect, it } from 'vitest'
import { mergePriceHistory, type ChartPricePoint } from '../app/market/priceHistory'

function point(t: number, prices: Record<string, number>): ChartPricePoint {
    return { t, prices }
}

describe('mergePriceHistory', () => {
    it('returns history alone when there are no live points', () => {
        const history = [point(1, { a: 0.5, b: 0.5 }), point(2, { a: 0.6, b: 0.4 })]
        expect(mergePriceHistory(history, [])).toEqual(history)
    })

    it('appends live points that are newer and moved some price', () => {
        const history = [point(1, { a: 0.5, b: 0.5 }), point(2, { a: 0.6, b: 0.4 })]
        const merged = mergePriceHistory(history, [point(3, { a: 0.7, b: 0.3 })])
        expect(merged).toEqual([point(1, { a: 0.5, b: 0.5 }), point(2, { a: 0.6, b: 0.4 }), point(3, { a: 0.7, b: 0.3 })])
    })

    it('keeps a live point that only moves a non-first outcome', () => {
        // With n outcomes a bet moves at least one price — here only b moves.
        const history = [point(1, { a: 0.5, b: 0.25, c: 0.25 })]
        const merged = mergePriceHistory(history, [point(2, { a: 0.5, b: 0.4, c: 0.1 })])
        expect(merged).toHaveLength(2)
    })

    it('drops the SSE connect frame echoing the current state', () => {
        // The stream sends the current prices on connect; they equal the last
        // replayed point and must not add a flat segment to the chart.
        const history = [point(1, { a: 0.5, b: 0.5 }), point(2, { a: 0.6, b: 0.4 })]
        const merged = mergePriceHistory(history, [point(3, { a: 0.6, b: 0.4 })])
        expect(merged).toEqual(history)
    })

    it('drops live points a history refetch already picked up', () => {
        // After a refetch the history includes the bet that produced the live
        // point (same price vector, earlier timestamp) — only genuinely
        // newer points survive.
        const history = [point(1, { a: 0.5, b: 0.5 }), point(4, { a: 0.7, b: 0.3 })]
        const merged = mergePriceHistory(history, [
            point(2, { a: 0.6, b: 0.4 }),
            point(3, { a: 0.6, b: 0.4 }),
            point(5, { a: 0.8, b: 0.2 }),
        ])
        expect(merged).toEqual([point(1, { a: 0.5, b: 0.5 }), point(4, { a: 0.7, b: 0.3 }), point(5, { a: 0.8, b: 0.2 })])
    })

    it('drops the stale connect echo once a newer bet has been refetched', () => {
        // Page opened at t=2 (echo at the then-current prices), a buy at t=4
        // moved the price, then the refetched history ends at t=4: the t=2
        // echo predates the newest replayed point and must not resurface.
        const history = [point(1, { a: 0.5, b: 0.5 }), point(4, { a: 0.7, b: 0.3 })]
        const merged = mergePriceHistory(history, [point(2, { a: 0.6, b: 0.4 }), point(5, { a: 0.7, b: 0.3 })])
        expect(merged).toEqual([point(1, { a: 0.5, b: 0.5 }), point(4, { a: 0.7, b: 0.3 })])
    })

    it('keeps a live point while the refetched history is still stale', () => {
        // Between the SSE event and the refetch, the history still ends
        // before the live point — the buy must show up immediately.
        const history = [point(1, { a: 0.5, b: 0.5 })]
        const merged = mergePriceHistory(history, [point(3, { a: 0.6, b: 0.4 })])
        expect(merged).toEqual([point(1, { a: 0.5, b: 0.5 }), point(3, { a: 0.6, b: 0.4 })])
    })

    it('drops consecutive duplicate live frames', () => {
        const merged = mergePriceHistory(
            [point(1, { a: 0.5, b: 0.5 })],
            [point(2, { a: 0.6, b: 0.4 }), point(3, { a: 0.6, b: 0.4 })],
        )
        expect(merged).toEqual([point(1, { a: 0.5, b: 0.5 }), point(2, { a: 0.6, b: 0.4 })])
    })

    it('handles an empty history (market with no bets yet)', () => {
        const merged = mergePriceHistory([], [point(1, { a: 0.5, b: 0.5 })])
        expect(merged).toEqual([point(1, { a: 0.5, b: 0.5 })])
    })

    it('does not mutate the inputs', () => {
        const history = [point(1, { a: 0.5, b: 0.5 })]
        const live = [point(2, { a: 0.6, b: 0.4 })]
        mergePriceHistory(history, live)
        expect(history).toEqual([point(1, { a: 0.5, b: 0.5 })])
        expect(live).toEqual([point(2, { a: 0.6, b: 0.4 })])
    })
})
