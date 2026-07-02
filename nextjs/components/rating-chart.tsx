'use client'

import { useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Brush, ReferenceDot } from 'recharts'
import { Button } from '@/components/ui/button'
import { ChartContainer } from '@/components/ui/chart'
import {
    buildChartPoints,
    dotPointFor,
    findExtremes,
    isPresetUseful,
    labelDatePart,
    presetStartIndex,
    type RatingPoint,
} from '@/lib/rating-chart'

const PRESETS = [
    { key: '3m', label: '3М', months: 3 },
    { key: '6m', label: '6М', months: 6 },
    { key: '12m', label: 'Год', months: 12 },
    { key: 'all', label: 'Всё', months: null },
] as const

type PresetKey = (typeof PRESETS)[number]['key']

export function RatingChart({ history }: { history: RatingPoint[] }) {
    const { points, granularity } = useMemo(() => buildChartPoints(history), [history])
    const dots = useMemo(() => {
        const extremes = findExtremes(history)
        if (!extremes) return []
        return [
            { ...dotPointFor(points, granularity, extremes.ratingMax, 'rating'), color: 'var(--color-rating)' },
            { ...dotPointFor(points, granularity, extremes.eloMax, 'elo'), color: 'var(--color-elo)' },
            { ...dotPointFor(points, granularity, extremes.eloMin, 'elo'), color: 'var(--color-elo)' },
        ].filter((d): d is { label: string; value: number; color: string } => d.label !== undefined)
    }, [history, points, granularity])

    const [range, setRange] = useState<{ start: number; end: number } | null>(null)
    const [activePreset, setActivePreset] = useState<PresetKey | null>('all')
    const [prevHistory, setPrevHistory] = useState(history)
    if (history !== prevHistory) {
        setPrevHistory(history)
        setRange(null)
        setActivePreset('all')
    }

    // Frozen at mount: preset cutoffs don't need to track a live clock.
    const [now] = useState(() => Date.now())
    const lastIndex = points.length - 1
    const start = Math.min(range?.start ?? 0, lastIndex)
    const end = Math.min(range?.end ?? lastIndex, lastIndex)

    if (points.length === 0) {
        return <p className="text-muted-foreground text-sm">Нет данных</p>
    }

    const showControls = points.length >= 2

    return (
        <div className="space-y-2">
            {showControls && (
                <div className="flex flex-wrap gap-1">
                    {PRESETS.map(preset => (
                        <Button
                            key={preset.key}
                            size="sm"
                            variant={activePreset === preset.key ? 'secondary' : 'ghost'}
                            className="h-7 px-2 text-xs"
                            disabled={preset.months !== null && !isPresetUseful(points, preset.months, now)}
                            onClick={() => {
                                setRange({
                                    start: preset.months === null ? 0 : presetStartIndex(points, preset.months, now),
                                    end: lastIndex,
                                })
                                setActivePreset(preset.key)
                            }}
                        >
                            {preset.label}
                        </Button>
                    ))}
                </div>
            )}
            <ChartContainer
                className="aspect-auto h-80 w-full"
                config={{
                    rating: { label: 'Рейтинг', color: 'var(--chart-1)' },
                    elo: { label: 'Эло', color: 'var(--chart-3)' },
                }}
            >
                <LineChart data={points}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11 }}
                        tickFormatter={labelDatePart}
                        interval="preserveStartEnd"
                    />
                    <YAxis
                        domain={['auto', 'auto']}
                        tick={{ fontSize: 11 }}
                        width={55}
                    />
                    <Tooltip
                        formatter={(value, name) => [value, name === 'rating' ? 'Рейтинг' : 'Эло']}
                    />
                    <Legend
                        formatter={(name) => name === 'rating' ? 'Рейтинг' : 'Эло'}
                        wrapperStyle={{ fontSize: 12, paddingTop: 4 }}
                    />
                    {dots.map((dot, i) => (
                        <ReferenceDot
                            key={i}
                            x={dot.label}
                            y={dot.value}
                            r={4}
                            fill={dot.color}
                            stroke="var(--background)"
                            strokeWidth={1.5}
                        />
                    ))}
                    <Line
                        type="monotone"
                        dataKey="elo"
                        stroke="var(--color-elo)"
                        strokeDasharray="5 3"
                        strokeWidth={1.0}
                        dot={false}
                        name="elo"
                    />
                    <Line
                        type="monotone"
                        dataKey="rating"
                        stroke="var(--color-rating)"
                        strokeWidth={2.5}
                        dot={false}
                        name="rating"
                    />
                    {showControls && (
                        <Brush
                            dataKey="label"
                            height={28}
                            travellerWidth={8}
                            stroke="var(--muted-foreground)"
                            fill="transparent"
                            startIndex={start}
                            endIndex={end}
                            tickFormatter={labelDatePart}
                            onChange={({ startIndex, endIndex }) => {
                                setRange({ start: startIndex ?? 0, end: endIndex ?? lastIndex })
                                setActivePreset(null)
                            }}
                        />
                    )}
                </LineChart>
            </ChartContainer>
        </div>
    )
}
