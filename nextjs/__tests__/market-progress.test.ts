import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Base58ID } from '../lib/id'
import type { Match, WinStreakParams } from '../app/api'

vi.mock('../app/api', () => ({
    getMatchesPagePromise: vi.fn(),
}))

import { getMatchesPagePromise } from '../app/api'
import {
    computeStreakProgress,
    fetchStreakMatches,
    formatRemainingTime,
    streakTimeRow,
    streakWindowEnd,
} from '../app/markets/progress'

const TARGET = 'p-target' as Base58ID
const ALLY = 'p-ally' as Base58ID
const RIVAL = 'p-rival' as Base58ID

function makeMatch(id: string, date: string, scores: Record<string, number>): Match {
    return {
        id: id as Base58ID,
        game_id: 'g1' as Base58ID,
        game_name: 'Game',
        score: Object.fromEntries(
            Object.entries(scores).map(([pid, score]) => [
                pid,
                { ratingStaked: 0, ratingEarned: 0, score, ratingAfter: null },
            ]),
        ),
        date: new Date(date),
        dateISO: date,
        has_markets: false,
        tournaments: [],
    }
}

const streakParams = (gameIds: Base58ID[] = ['g1' as Base58ID]): WinStreakParams => ({
    target_player_id: TARGET,
    game_ids: gameIds,
    wins_required: 5,
})

describe('computeStreakProgress', () => {
    it('counts a sole win and a strict loss', () => {
        const matches = [
            makeMatch('m1', '2026-09-01T10:00:00Z', { [TARGET]: 50, [RIVAL]: 30 }),
            makeMatch('m2', '2026-09-02T10:00:00Z', { [TARGET]: 10, [RIVAL]: 80 }),
        ]
        expect(computeStreakProgress(matches, TARGET)).toEqual({ wins: 1, losses: 1 })
    })

    it('counts a tie at the top as a win, mirroring the server resolution counter', () => {
        const matches = [makeMatch('m1', '2026-09-01T10:00:00Z', { [TARGET]: 50, [ALLY]: 50, [RIVAL]: 30 })]
        expect(computeStreakProgress(matches, TARGET)).toEqual({ wins: 1, losses: 0 })
    })

    it('ignores matches without the target player', () => {
        const matches = [makeMatch('m1', '2026-09-01T10:00:00Z', { [ALLY]: 50, [RIVAL]: 30 })]
        expect(computeStreakProgress(matches, TARGET)).toEqual({ wins: 0, losses: 0 })
    })
})

describe('streakWindowEnd', () => {
    const base = {
        id: 'mk1' as Base58ID,
        market_type: 'win_streak' as const,
        outcomes: [],
        liquidity_b: 8,
        max_guarantor_loss: 16,
        params: streakParams(),
    }

    it('is unbounded while the market is open', () => {
        expect(streakWindowEnd({ ...base, status: 'open', closes_at: '2026-09-30T00:00:00Z' })).toBeNull()
    })

    it('is the resolution moment once resolved', () => {
        const end = streakWindowEnd({
            ...base,
            status: 'resolved',
            resolved_at: '2026-09-05T12:00:00Z',
            closes_at: '2026-09-30T00:00:00Z',
        })
        expect(end?.toISOString()).toBe('2026-09-05T12:00:00.000Z')
    })

    it('falls back to closes_at once betting is closed', () => {
        const end = streakWindowEnd({ ...base, status: 'betting_closed', closes_at: '2026-09-30T00:00:00Z' })
        expect(end?.toISOString()).toBe('2026-09-30T00:00:00.000Z')
    })
})

describe('formatRemainingTime', () => {
    const now = new Date('2026-09-10T12:00:00Z')
    const left = (ms: number) => new Date(now.getTime() + ms)

    it('renders days and hours', () => {
        expect(formatRemainingTime(left((5 * 24 * 60 + 20 * 60) * 60_000), now)).toBe('5 дней, 20 часов')
    })

    it('uses Russian plural forms', () => {
        expect(formatRemainingTime(left(21 * 60 * 60_000), now)).toBe('21 час')
        expect(formatRemainingTime(left(2 * 60 * 60_000), now)).toBe('2 часа')
        expect(formatRemainingTime(left(5 * 60 * 60_000), now)).toBe('5 часов')
        expect(formatRemainingTime(left(45 * 60_000), now)).toBe('45 минут')
        expect(formatRemainingTime(left(2 * 60_000), now)).toBe('2 минуты')
    })

    it('drops zero units', () => {
        expect(formatRemainingTime(left(2 * 24 * 60 * 60_000), now)).toBe('2 дня')
        expect(formatRemainingTime(left(60 * 60_000), now)).toBe('1 час')
    })

    it('reports sub-minute time and the past', () => {
        expect(formatRemainingTime(left(30_000), now)).toBe('меньше минуты')
        expect(formatRemainingTime(left(-1000), now)).toBeNull()
    })
})

describe('streakTimeRow', () => {
    const now = new Date('2026-09-10T12:00:00Z')
    const base = {
        id: 'mk1' as Base58ID,
        market_type: 'win_streak' as const,
        outcomes: [],
        liquidity_b: 8,
        max_guarantor_loss: 16,
        params: streakParams(),
        closes_at: '2026-09-30T00:00:00Z',
    }

    it('counts down to closes_at while the market lives', () => {
        expect(streakTimeRow({ ...base, status: 'open' }, now)).toEqual({
            label: 'Осталось',
            value: '19 дней, 12 часов',
        })
        expect(streakTimeRow({ ...base, status: 'betting_closed' }, now)).toEqual({
            label: 'Осталось',
            value: '19 дней, 12 часов',
        })
    })

    it('hides the row when a match ended the market early', () => {
        // The streak was reached (or the loss limit hit) before closes_at —
        // "осталось 20 дней" over a finished race reads as nonsense.
        const market = {
            ...base,
            status: 'resolved' as const,
            resolved_at: '2026-09-05T12:00:00Z',
            resolution_match_id: 'm1' as Base58ID,
        }
        expect(streakTimeRow(market, now)).toBeNull()
    })

    it('reports expired time when expiry is what resolved the market', () => {
        // A win_streak market resolved without a resolution match was ended
        // by the overdue path at closes_at.
        const market = {
            ...base,
            status: 'resolved' as const,
            resolved_at: '2026-09-30T00:00:00Z',
        }
        expect(streakTimeRow(market, now)).toEqual({ label: 'Время', value: 'истекло' })
    })

    it('shows nothing for cancelled markets', () => {
        expect(streakTimeRow({ ...base, status: 'cancelled' }, now)).toBeNull()
    })
})

describe('fetchStreakMatches', () => {
    const mockedGet = vi.mocked(getMatchesPagePromise)

    beforeEach(() => {
        mockedGet.mockReset()
    })

    it('follows cursors, filters to the window, and merges games newest-first', async () => {
        const start = new Date('2026-09-01T00:00:00Z')
        const end = new Date('2026-09-10T00:00:00Z')

        // Game 1: two pages — the second one entirely older than the window.
        mockedGet.mockImplementation(async ({ game_id, next } = {}) => {
            if (game_id === 'g1') {
                if (!next) {
                    return {
                        items: [
                            makeMatch('m2', '2026-09-05T00:00:00Z', { [TARGET]: 50, [RIVAL]: 30 }),
                            makeMatch('m1', '2026-09-02T00:00:00Z', { [TARGET]: 10, [RIVAL]: 80 }),
                        ],
                        next: 'cursor-1',
                    }
                }
                return {
                    items: [makeMatch('m0', '2026-08-20T00:00:00Z', { [TARGET]: 50, [RIVAL]: 30 })],
                    next: null,
                }
            }
            // Game 2: one match inside the window and one after its end.
            return {
                items: [
                    makeMatch('m3', '2026-09-07T00:00:00Z', { [TARGET]: 50, [RIVAL]: 30 }),
                    makeMatch('m9', '2026-09-20T00:00:00Z', { [TARGET]: 50, [RIVAL]: 30 }),
                ],
                next: null,
            }
        })

        const matches = await fetchStreakMatches(streakParams(['g1', 'g2'] as Base58ID[]), start, end)

        expect(matches.map((m) => m.id)).toEqual(['m3', 'm2', 'm1'])
        // The g1 feed was followed into its second (cursor) page; the games
        // fetch concurrently, so only the call set is asserted, not the order.
        expect(mockedGet.mock.calls.map(([a]) => a?.next ?? null)).toContain('cursor-1')
    })

    it('stops after a single page when the feed is exhausted', async () => {
        mockedGet.mockResolvedValue({ items: [], next: null })
        const matches = await fetchStreakMatches(
            streakParams(),
            new Date('2026-09-01T00:00:00Z'),
            null,
        )
        expect(matches).toEqual([])
        expect(mockedGet).toHaveBeenCalledTimes(1)
    })
})
