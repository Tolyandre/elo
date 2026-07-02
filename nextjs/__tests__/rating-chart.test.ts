import { describe, expect, it } from 'vitest'
import {
    buildChartPoints,
    dotPointFor,
    findExtremes,
    isPresetUseful,
    labelDatePart,
    presetStartIndex,
    type RatingPoint,
} from '../lib/rating-chart'

function point(date: string, rating: number, elo: number): RatingPoint {
    return { date, rating, elo }
}

describe('buildChartPoints', () => {
    it('maps 1:1 below the threshold with unique labels for same-day matches', () => {
        const history = [
            point('2025-03-10T10:00:00Z', 1000.4, 1000.6),
            point('2025-03-10T12:00:00Z', 1010.2, 1009.8),
            point('2025-03-11T12:00:00Z', 1020.0, 1015.0),
        ]
        const { points, granularity } = buildChartPoints(history, 150)

        expect(granularity).toBe('match')
        expect(points).toHaveLength(3)
        expect(points[0].rating).toBe(1000)
        expect(points[0].elo).toBe(1001)
        expect(new Set(points.map(p => p.label)).size).toBe(3)
        expect(labelDatePart(points[0].label)).toBe(labelDatePart(points[1].label))
    })

    it('keeps the last point of each day above the threshold', () => {
        const history = [
            point('2025-03-10T10:00:00Z', 1000, 1000),
            point('2025-03-10T18:00:00Z', 1010, 1011),
            point('2025-03-11T10:00:00Z', 1005, 1006),
            point('2025-03-12T10:00:00Z', 1020, 1021),
            point('2025-03-12T18:00:00Z', 990, 991),
            point('2025-03-13T10:00:00Z', 1015, 1016),
        ]
        const { points, granularity } = buildChartPoints(history, 5)

        expect(granularity).toBe('day')
        expect(points).toHaveLength(4)
        expect(points.map(p => p.rating)).toEqual([1010, 1005, 990, 1015])
        expect(points.map(p => p.ts)).toEqual([...points.map(p => p.ts)].sort((a, b) => a - b))
    })
})

describe('findExtremes', () => {
    it('returns null for empty history', () => {
        expect(findExtremes([])).toBeNull()
    })

    it('finds elo max/min and rating max with dates, rounded', () => {
        const history = [
            point('2025-01-01T12:00:00Z', 1000, 1000),
            point('2025-02-01T12:00:00Z', 1050.6, 980.4),
            point('2025-03-01T12:00:00Z', 1030, 1060.2),
            point('2025-04-01T12:00:00Z', 1040, 1010),
        ]
        const extremes = findExtremes(history)

        expect(extremes).toEqual({
            eloMax: { value: 1060, date: '2025-03-01T12:00:00Z' },
            eloMin: { value: 980, date: '2025-02-01T12:00:00Z' },
            ratingMax: { value: 1051, date: '2025-02-01T12:00:00Z' },
        })
    })

    it('keeps the first occurrence on ties', () => {
        const history = [
            point('2025-01-01T12:00:00Z', 1050, 1060),
            point('2025-02-01T12:00:00Z', 1050, 1060),
        ]
        const extremes = findExtremes(history)

        expect(extremes?.eloMax.date).toBe('2025-01-01T12:00:00Z')
        expect(extremes?.ratingMax.date).toBe('2025-01-01T12:00:00Z')
    })
})

describe('presetStartIndex / isPresetUseful', () => {
    const now = Date.parse('2025-06-15T12:00:00Z')
    const monthsAgo = (m: number) => {
        const d = new Date(now)
        d.setMonth(d.getMonth() - m)
        return d.getTime()
    }
    const points = [{ ts: monthsAgo(10) }, { ts: monthsAgo(5) }, { ts: monthsAgo(1) }]

    it('finds the first index inside the window', () => {
        expect(presetStartIndex(points, 6, now)).toBe(1)
        expect(presetStartIndex(points, 3, now)).toBe(2)
    })

    it('returns 0 when the whole history fits', () => {
        expect(presetStartIndex(points, 12, now)).toBe(0)
    })

    it('clamps to the last point when nothing is inside the window', () => {
        const stale = [{ ts: monthsAgo(10) }, { ts: monthsAgo(8) }]
        expect(presetStartIndex(stale, 3, now)).toBe(1)
    })

    it('marks a preset useless when history is shorter than the window', () => {
        expect(isPresetUseful(points, 12, now)).toBe(false)
        expect(isPresetUseful(points, 6, now)).toBe(true)
        expect(isPresetUseful([], 3, now)).toBe(false)
    })
})

describe('dotPointFor', () => {
    it('returns the exact point in match granularity', () => {
        const history = [
            point('2025-03-10T10:00:00Z', 1000, 1000),
            point('2025-03-10T18:00:00Z', 1010, 1011),
        ]
        const { points, granularity } = buildChartPoints(history, 150)
        const dot = dotPointFor(points, granularity, { value: 1011, date: '2025-03-10T18:00:00Z' }, 'elo')

        expect(dot).toEqual({ label: points[1].label, value: 1011 })
    })

    it('snaps to the aggregated day value in day granularity', () => {
        const history = [
            point('2025-03-10T10:00:00Z', 1000, 1050), // intra-day elo peak…
            point('2025-03-10T18:00:00Z', 1010, 1011), // …but the day closes lower
            point('2025-03-11T10:00:00Z', 1005, 1006),
        ]
        const { points, granularity } = buildChartPoints(history, 2)
        const dot = dotPointFor(points, granularity, { value: 1050, date: '2025-03-10T10:00:00Z' }, 'elo')

        expect(granularity).toBe('day')
        expect(dot).toEqual({ label: points[0].label, value: 1011 })
    })

    it('returns null when the extreme is outside the display points', () => {
        const { points, granularity } = buildChartPoints([point('2025-03-10T12:00:00Z', 1000, 1000)], 150)
        expect(dotPointFor(points, granularity, { value: 999, date: '2025-04-01T12:00:00Z' }, 'elo')).toBeNull()
    })
})
