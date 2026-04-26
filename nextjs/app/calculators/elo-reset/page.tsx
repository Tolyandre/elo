'use client'

import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Legend } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ChartContainer, ChartTooltip } from '@/components/ui/chart'
import { getEloResetPromise, type EloResetResult } from '@/app/api'
import { useClubs } from '@/app/clubsContext'
import { PlayerMultiSelect } from '@/components/player-multi-select'
import { PageHeader } from '@/app/pageHeaderContext'

const CLUB_ID = '2'
const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']

function EloTooltip({ active, payload, label }: {
    active?: boolean
    payload?: { name: string; value: number; color: string }[]
    label?: string
}) {
    if (!active || !payload?.length) return null
    return (
        <div className="grid min-w-[8rem] gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
            <div className="font-medium text-foreground">Дата сброса: {label}</div>
            <div className="grid gap-1">
                {payload.map((entry, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: entry.color }} />
                        <span className="text-muted-foreground">{entry.name}</span>
                        <span className="ml-auto font-mono font-medium tabular-nums text-foreground">{entry.value}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

function formatDate(iso: string) {
    const d = new Date(iso)
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function toDatetimeLocal(iso: string) {
    return iso.slice(0, 16)
}

function fromDatetimeLocal(local: string): string {
    return new Date(local).toISOString()
}

export default function EloResetPage() {
    const { clubs } = useClubs()
    const [playerIds, setPlayerIds] = useState<string[]>([])
    const [calcDate, setCalcDate] = useState<string>(() => new Date().toISOString())
    const [result, setResult] = useState<EloResetResult | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (playerIds.length > 0) return
        const club = clubs.find(c => c.id === CLUB_ID)
        if (club && club.players.length > 0) {
            setPlayerIds(club.players.map(String))
        }
    }, [clubs, playerIds.length])

    async function handleCalculate() {
        if (playerIds.length === 0) return
        setLoading(true)
        setError(null)
        setResult(null)
        try {
            const data = await getEloResetPromise(playerIds, calcDate)
            setResult(data)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Ошибка загрузки')
        } finally {
            setLoading(false)
        }
    }

    const chartConfig = Object.fromEntries(
        (result?.players ?? []).map((p, i) => [
            p.id,
            { label: p.name, color: CHART_COLORS[i % CHART_COLORS.length] },
        ])
    )

    const chartData = result?.series.map(pt => ({
        date: formatDate(pt.reset_date),
        ...Object.fromEntries(
            Object.entries(pt.players).map(([k, v]) => [k, Math.round(v)])
        ),
    })) ?? []

    return (
        <div className="space-y-6 p-4 max-w-3xl mx-auto">
            <PageHeader title="Сходимость Эло" />

            <Card>
                <CardContent className="space-y-4 pt-4">
                    <div className="space-y-1">
                        <p className="text-sm font-medium">Игроки</p>
                        <PlayerMultiSelect value={playerIds} onChange={setPlayerIds} />
                    </div>
                    <div className="space-y-1">
                        <p className="text-sm font-medium">Дата расчёта</p>
                        <input
                            type="datetime-local"
                            value={toDatetimeLocal(calcDate)}
                            onChange={e => setCalcDate(fromDatetimeLocal(e.target.value))}
                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                    </div>
                    <Button onClick={handleCalculate} disabled={loading || playerIds.length === 0}>
                        {loading ? 'Расчёт...' : 'Рассчитать'}
                    </Button>
                </CardContent>
            </Card>

            {error && (
                <p className="text-sm text-destructive">{error}</p>
            )}

            {result && result.series.length === 0 && (
                <p className="text-sm text-muted-foreground">Нет данных для выбранных игроков в указанный период</p>
            )}

            {result && result.series.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle>Эло на дату расчёта в зависимости от даты сброса</CardTitle>
                    </CardHeader>
                    <CardContent className="pb-2">
                        <p className="text-sm text-muted-foreground">
                            Каждая точка на графике — это гипотетическое Эло на дату расчёта,
                            если бы рейтинг игроков был сброшен до начального значения в дату по оси X,
                            а все последующие партии пересчитаны заново.
                        </p>
                       <p className="text-sm text-muted-foreground">
                            График показывает, после сброса значения Эло в начальное (1000),
                            значение рейтинга всё равно стремится к одному значению, показывающему относительную силу игроков
                        </p>
                    </CardContent>
                    <CardContent>
                        <ChartContainer config={chartConfig}>
                            <LineChart data={chartData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis
                                    dataKey="date"
                                    tick={{ fontSize: 11 }}
                                    interval="preserveStartEnd"
                                />
                                <YAxis
                                    domain={['auto', 'auto']}
                                    tick={{ fontSize: 11 }}
                                    width={55}
                                />
                                <ChartTooltip content={({ active, payload, label }) => (
                                    <EloTooltip active={active} payload={payload as unknown as { name: string; value: number; color: string }[]} label={String(label ?? '')} />
                                )} />
                                <Legend />
                                {result.players.map((p, i) => (
                                    <Line
                                        key={p.id}
                                        type="monotone"
                                        dataKey={p.id}
                                        name={p.name}
                                        stroke={CHART_COLORS[i % CHART_COLORS.length]}
                                        dot={false}
                                        strokeWidth={2}
                                    />
                                ))}
                            </LineChart>
                        </ChartContainer>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
