import { describe, expect, it } from 'vitest'
import { DEFAULT_MAX_GUARANTOR_LOSS, bFromRisk, outcomeCount } from '../app/markets/new/liquidity'

describe('outcomeCount', () => {
    it('adds the shared "other" outcome for match_winner', () => {
        expect(outcomeCount('match_winner', 2)).toBe(3)
        expect(outcomeCount('match_winner', 0)).toBe(1)
    })

    it('ignores the target count for win_streak yes/no outcomes', () => {
        expect(outcomeCount('win_streak', 5)).toBe(2)
    })
})

describe('bFromRisk', () => {
    // The whole point of the risk-based input: with a fixed max guarantor loss
    // L, more outcomes mean a smaller b, so per-share price movement stays in
    // the same ballpark instead of crawling as the market grows.
    it('scales b down as 1/ln(n) for a fixed risk', () => {
        expect(bFromRisk(16, 2)).toBeCloseTo(16 / Math.LN2, 12)
        expect(bFromRisk(16, 3)).toBeCloseTo(16 / Math.log(3), 12)
        expect(bFromRisk(16, 6)).toBeLessThan(bFromRisk(16, 3)!)
        expect(bFromRisk(16, 3)!.toFixed(1)).toBe('14.6')
    })

    it('scales b up linearly with the risk for a fixed outcome count', () => {
        expect(bFromRisk(32, 2)).toBeCloseTo(2 * bFromRisk(16, 2)!, 12)
    })

    it('rejects inputs that cannot produce a sane market', () => {
        expect(bFromRisk(0, 3)).toBeNull()
        expect(bFromRisk(-5, 3)).toBeNull()
        expect(bFromRisk(NaN, 3)).toBeNull()
        expect(bFromRisk(16, 1)).toBeNull() // ln(1) = 0
    })

    it('has a default risk of 16 elo (b ≈ 14.6 for a two-target market)', () => {
        // elo_settings.market_default_max_guarantor_loss mirrors this value.
        expect(bFromRisk(DEFAULT_MAX_GUARANTOR_LOSS, 3)!.toFixed(1)).toBe('14.6')
    })
})
