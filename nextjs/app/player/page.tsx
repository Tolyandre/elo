'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ChartContainer } from '@/components/ui/chart'
import { getPlayerStatsPromise, type PlayerStats, type GameEloStat, type GameMatchStat } from '@/app/api'
import { useMe } from '@/app/meContext'

function formatDate(iso: string) {
    const d = new Date(iso)
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function formatElo(value: number, roundToInteger: boolean) {
    if (roundToInteger) {
        const rounded = Math.round(value)
        return rounded >= 0 ? `+${rounded}` : `${rounded}`
    }
    const fixed = value.toFixed(1)
    return value >= 0 ? `+${fixed}` : fixed
}

function EloTable({ rows, title }: { rows: GameEloStat[]; title: string }) {
    const { roundToInteger } = useMe()
    return (
        <Card>
            <CardHeader>
                <CardTitle>{title}</CardTitle>
            </CardHeader>
            <CardContent>
                {rows.length === 0 ? (
                    <p className="text-muted-foreground text-sm">Нет данных</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b">
                                    <th className="text-left py-2 pr-4 font-medium">Игра</th>
                                    <th className="text-right py-2 font-medium">Изменение Эло</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(row => (
                                    <tr key={row.game_id} className="border-b last:border-0">
                                        <td className="py-2 pr-4">{row.game_name}</td>
                                        <td className={`py-2 text-right font-mono ${row.elo_earned >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                            {formatElo(row.elo_earned, roundToInteger)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

function MatchesTable({ rows }: { rows: GameMatchStat[] }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Частые игры</CardTitle>
            </CardHeader>
            <CardContent>
                {rows.length === 0 ? (
                    <p className="text-muted-foreground text-sm">Нет данных</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b">
                                    <th className="text-left py-2 pr-4 font-medium">Игра</th>
                                    <th className="text-right py-2 pr-4 font-medium">Матчи</th>
                                    <th className="text-right py-2 font-medium">Победы</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(row => (
                                    <tr key={row.game_id} className="border-b last:border-0">
                                        <td className="py-2 pr-4">{row.game_name}</td>
                                        <td className="py-2 pr-4 text-right">{row.matches_count}</td>
                                        <td className="py-2 text-right">{row.wins}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

function LoadingSkeleton() {
    return (
        <div className="space-y-6 p-4 max-w-3xl mx-auto">
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
        </div>
    )
}

function PlayerProfileContent({ stats }: { stats: PlayerStats }) {
    const chartData = stats.rating_history.map(p => ({
        date: formatDate(p.date),
        rating: Math.round(p.rating),
    }))

    return (
        <div className="space-y-6 p-4 max-w-3xl mx-auto">
            <h1 className="text-3xl font-bold">{stats.player_name}</h1>

            <Card>
                <CardHeader>
                    <CardTitle>Рейтинг Эло</CardTitle>
                </CardHeader>
                <CardContent>
                    {chartData.length === 0 ? (
                        <p className="text-muted-foreground text-sm">Нет данных</p>
                    ) : (
                        <ChartContainer config={{ rating: { label: 'Эло', color: 'var(--chart-1)' } }}>
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
                                <Tooltip
                                    formatter={(value: number) => [value, 'Эло']}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="rating"
                                    stroke="var(--color-rating)"
                                    dot={false}
                                    strokeWidth={2}
                                />
                            </LineChart>
                        </ChartContainer>
                    )}
                </CardContent>
            </Card>

            <MatchesTable rows={stats.top_games_by_matches} />
            <EloTable rows={stats.top_games_by_elo_earned} title="Успешные игры" />
            <EloTable rows={stats.worst_games_by_elo_earned} title="&quot;Я понял как играть&quot;" />
        </div>
    )
}

function PlayerPageContent() {
    const searchParams = useSearchParams()
    const id = searchParams.get('id')
    const [stats, setStats] = useState<PlayerStats | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!id) { setLoading(false); return }
        setLoading(true)
        getPlayerStatsPromise(id)
            .then(data => { setStats(data); setLoading(false) })
            .catch(() => setLoading(false))
    }, [id])

    if (!id) return <div className="p-6 text-muted-foreground">Игрок не указан</div>
    if (loading) return <LoadingSkeleton />
    if (!stats) return <div className="p-6 text-destructive">Не удалось загрузить данные</div>

    return <PlayerProfileContent stats={stats} />
}

export default function PlayerPage() {
    return (
        <Suspense fallback={<LoadingSkeleton />}>
            <PlayerPageContent />
        </Suspense>
    )
}
