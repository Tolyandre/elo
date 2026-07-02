'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { RatingChart } from '@/components/rating-chart'
import { findExtremes } from '@/lib/rating-chart'
import { getPlayerStatsPromise, type PlayerStats, type GameEloStat, type GameMatchStat } from '@/app/api'
import { useMe } from '@/app/meContext'
import { PageHeader } from '@/app/pageHeaderContext'
import { ErrorAlert } from '@/components/error-alert'

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
                                    <th className="text-right py-2 pr-4 font-medium">Партии</th>
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
    const history = stats.rating_history
    const current = history.length > 0 ? history[history.length - 1] : null
    const extremes = useMemo(() => findExtremes(history), [history])

    return (
        <div className="space-y-6 p-4 max-w-3xl mx-auto">
            <PageHeader title={stats.player_name} />

            <Card>
                <CardHeader className="pb-2">
                    <div className="flex items-end justify-between gap-4">
                        <div>
                            <CardTitle className="text-sm font-medium text-muted-foreground mb-1">Рейтинг</CardTitle>
                            {current && <p className="text-4xl font-bold leading-none">{Math.round(current.rating)}</p>}
                        </div>
                        {current && (
                            <div className="text-right text-sm text-muted-foreground mb-0.5">
                                <span>эло </span>
                                <span className="font-medium text-foreground">{Math.round(current.elo)}</span>
                            </div>
                        )}
                    </div>
                    {extremes && (
                        <div className="flex flex-wrap gap-1 pt-2 text-xs">
                            <Badge variant="secondary">эло макс {extremes.eloMax.value} · {formatDate(extremes.eloMax.date)}</Badge>
                            <Badge variant="secondary">эло мин {extremes.eloMin.value} · {formatDate(extremes.eloMin.date)}</Badge>
                        </div>
                    )}
                </CardHeader>
                <CardContent>
                    <RatingChart history={history} />
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
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        /* eslint-disable react-hooks/set-state-in-effect -- loading indicator around async fetch */
        if (!id) { setLoading(false); return }
        setLoading(true)
        setError(null)
        /* eslint-enable react-hooks/set-state-in-effect */
        getPlayerStatsPromise(id)
            .then(data => { setStats(data); setLoading(false) })
            .catch(e => { setError(e instanceof Error ? e.message : String(e)); setLoading(false) })
    }, [id])

    if (!id) return <div className="p-6 text-muted-foreground">Игрок не указан</div>
    if (loading) return <LoadingSkeleton />
    if (error) return <div className="p-6"><ErrorAlert message={error} /></div>
    if (!stats) return <div className="p-6"><ErrorAlert message="Данные игрока не найдены" /></div>

    return <PlayerProfileContent stats={stats} />
}

export default function PlayerPage() {
    return (
        <Suspense fallback={<LoadingSkeleton />}>
            <PlayerPageContent />
        </Suspense>
    )
}
