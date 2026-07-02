// Pure helpers for the player rating chart (no React). Covered by __tests__/rating-chart.test.ts.

export type RatingPoint = { date: string; rating: number; elo: number }

export type ChartPoint = { ts: number; label: string; rating: number; elo: number }

export type Granularity = 'match' | 'day'

export type Extreme = { value: number; date: string }

export type Extremes = { eloMax: Extreme; eloMin: Extreme; ratingMax: Extreme }

const DOWNSAMPLE_THRESHOLD = 150

function dayLabel(d: Date) {
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function matchLabel(d: Date) {
    const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    return `${dayLabel(d)} ${time}`
}

/** Strips the time suffix from a match-granularity label; day labels pass through unchanged. */
export function labelDatePart(label: string) {
    return label.slice(0, 8)
}

/**
 * Builds the display array for the chart. Above the threshold the history is
 * aggregated to the last point of each local calendar day, so the "all time"
 * view stays readable as the match count grows. Labels double as category-axis
 * keys, so they must be unique (hence the time suffix in match granularity).
 */
export function buildChartPoints(
    history: RatingPoint[],
    threshold: number = DOWNSAMPLE_THRESHOLD,
): { points: ChartPoint[]; granularity: Granularity } {
    if (history.length <= threshold) {
        return {
            granularity: 'match',
            points: history.map(p => {
                const d = new Date(p.date)
                return { ts: d.getTime(), label: matchLabel(d), rating: Math.round(p.rating), elo: Math.round(p.elo) }
            }),
        }
    }

    const points: ChartPoint[] = []
    for (const p of history) {
        const d = new Date(p.date)
        const label = dayLabel(d)
        const point = { ts: d.getTime(), label, rating: Math.round(p.rating), elo: Math.round(p.elo) }
        if (points.length > 0 && points[points.length - 1].label === label) {
            points[points.length - 1] = point
        } else {
            points.push(point)
        }
    }
    return { granularity: 'day', points }
}

/**
 * Extremes are computed from the full per-match history so downsampling never
 * hides a peak. No rating minimum: everyone starts from the same fixed rating,
 * so it is the same for all players. Ties keep the first occurrence.
 */
export function findExtremes(history: RatingPoint[]): Extremes | null {
    if (history.length === 0) return null

    let eloMax = history[0]
    let eloMin = history[0]
    let ratingMax = history[0]
    for (const p of history) {
        if (p.elo > eloMax.elo) eloMax = p
        if (p.elo < eloMin.elo) eloMin = p
        if (p.rating > ratingMax.rating) ratingMax = p
    }
    return {
        eloMax: { value: Math.round(eloMax.elo), date: eloMax.date },
        eloMin: { value: Math.round(eloMin.elo), date: eloMin.date },
        ratingMax: { value: Math.round(ratingMax.rating), date: ratingMax.date },
    }
}

function presetCutoff(months: number, now: number) {
    const d = new Date(now)
    d.setMonth(d.getMonth() - months)
    return d.getTime()
}

/** First index inside the preset window [now - months, now]; 0 when the whole history fits. */
export function presetStartIndex(points: { ts: number }[], months: number, now: number): number {
    const cutoff = presetCutoff(months, now)
    const idx = points.findIndex(p => p.ts >= cutoff)
    return idx < 0 ? Math.max(points.length - 1, 0) : idx
}

/** A preset is useful only if it actually narrows the window (history extends past the cutoff). */
export function isPresetUseful(points: { ts: number }[], months: number, now: number): boolean {
    return points.length > 0 && points[0].ts < presetCutoff(months, now)
}

/**
 * Maps an extreme (from the full history) to the display point it should be
 * drawn on. In day granularity the marker takes the aggregated point of that
 * day and its y-value, so the dot always sits on the line; the chip carries
 * the true extreme value.
 */
export function dotPointFor(
    points: ChartPoint[],
    granularity: Granularity,
    extreme: Extreme,
    key: 'rating' | 'elo',
): { label: string; value: number } | null {
    const d = new Date(extreme.date)
    const label = granularity === 'match' ? matchLabel(d) : dayLabel(d)
    const point = points.find(p => p.label === label)
    if (!point) return null
    return { label, value: granularity === 'match' ? extreme.value : point[key] }
}
