import { describe, expect, it } from 'vitest'
import { DEFAULT_MAX_GUARANTOR_LOSS } from '../app/markets/new/liquidity'

describe('new-market liquidity defaults', () => {
    // Since guarantees became voluntary (ADR-20) the form sends only the max
    // guarantor loss; the LMSR liquidity is derived server side as
    // b = min(L, Σrisk)/ln(n) and grows with each guarantor wager.
    it('mirrors the settings default max guarantor loss', () => {
        expect(DEFAULT_MAX_GUARANTOR_LOSS).toBe(16)
    })
})
