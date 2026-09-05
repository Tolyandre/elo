import { describe, expect, it } from 'vitest'
import { sharesForAmount } from '../app/markets/lmsr'
import { formatAmount } from '../app/markets/format'

// Independent LMSR cost, mirroring the server's ammCostN (b·ln Σ e^(q_j/b),
// stabilized with a max-shift log-sum-exp).
function cost(q: number[], b: number): number {
    const m = Math.max(...q.map((v) => v / b))
    const sum = q.reduce((acc, v) => acc + Math.exp(v / b - m), 0)
    return b * (m + Math.log(sum))
}

function buyCost(q: number[], b: number, i: number, shares: number): number {
    const after = q.slice()
    after[i] += shares
    return cost(after, b) - cost(q, b)
}

describe('sharesForAmount', () => {
    it.each([
        { q: [0, 0], b: 8, i: 0 },
        { q: [0, 0, 0], b: 16 / Math.LN2, i: 1 },
        { q: [3.5, 1.25, 0], b: 8, i: 2 },
        { q: [10, -2], b: 23, i: 1 },
        { q: [0.5, 0.5, 0.5, 0.5], b: 16 / Math.log(4), i: 3 },
    ])('buys exactly the amount of elo for q=$q b=$b i=$i', ({ q, b, i }) => {
        const shares = sharesForAmount(q, b, i, 1)
        expect(Number.isFinite(shares)).toBe(true)
        expect(buyCost(q, b, i, shares)).toBeCloseTo(1, 10)
    })

    it('buys more shares for a bigger amount', () => {
        const q = [2, 1]
        expect(sharesForAmount(q, 8, 0, 2)).toBeGreaterThan(sharesForAmount(q, 8, 0, 1))
    })

    it('is cheaper per share than the opening marginal price allows for large buys', () => {
        // The average price of a big buy is between the opening marginal price
        // and 1 (the price rises as the buy proceeds).
        const q = [0, 0]
        const b = 8
        const shares = sharesForAmount(q, b, 0, 5)
        const avg = 5 / shares
        expect(avg).toBeGreaterThan(0.5)
        expect(avg).toBeLessThan(1)
    })

    it('returns NaN for unusable inputs', () => {
        expect(sharesForAmount([0, 0], 0, 0, 1)).toBeNaN()
        expect(sharesForAmount([0, 0], 8, 0, -1)).toBeNaN()
        expect(sharesForAmount([5], 8, 0, 1)).toBeNaN()
        expect(sharesForAmount([0, 0], 8, 5, 1)).toBeNaN()
    })
})

describe('buy mode price equivalence', () => {
    it('buying k shares at once costs the same as k single-share buys', () => {
        const q = [1, 0.5, 0.25]
        const b = 8
        const bulk = buyCost(q, b, 1, 3)

        let sequential = 0
        const cur = q.slice()
        for (let k = 0; k < 3; k++) {
            sequential += buyCost(cur, b, 1, 1)
            cur[1] += 1
        }
        expect(bulk).toBeCloseTo(sequential, 10)
    })

    it('a fixed-amount buy costs the same as buying its share count share by share', () => {
        const q = [2, 3]
        const b = 10
        const shares = sharesForAmount(q, b, 0, 1)

        let sequential = 0
        const cur = q.slice()
        while (cur[0] < q[0] + shares) {
            const step = Math.min(1, q[0] + shares - cur[0])
            sequential += buyCost(cur, b, 0, step)
            cur[0] += step
        }
        expect(sequential).toBeCloseTo(1, 10)
    })
})

describe('payoutMultiplier', () => {
    it('shows the multiplier a 1-elo bet realizes, not the instantaneous 1/price', () => {
        // Demo market with max guarantor loss L=1 and two outcomes: b = L/ln2.
        // At the initial q the marginal price is 0.5 (instantaneous ×2), but a
        // whole 1-elo bet walks the price up and only buys ~1.585 shares —
        // the multiplier the user actually gets.
        const b = 1 / Math.LN2
        const coeff = sharesForAmount([0, 0], b, 0, 1)
        expect(coeff).toBeCloseTo(1.585, 2)
        // Betting 1 elo at these odds pays exactly `coeff` if the outcome wins.
        expect(buyCost([0, 0], b, 0, coeff)).toBeCloseTo(1, 10)
    })
})

describe('formatAmount', () => {
    it('renders whole numbers without decimals', () => {
        expect(formatAmount(5)).toBe('5')
        expect(formatAmount(0)).toBe('0')
        expect(formatAmount(5.000000000001)).toBe('5')
    })

    it('renders fractional values with two decimals', () => {
        expect(formatAmount(1.8893624)).toBe('1.89')
        expect(formatAmount(2.3)).toBe('2.30')
        expect(formatAmount(0.125)).toBe('0.13')
    })
})
