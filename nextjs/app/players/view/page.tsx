'use client'

import { Suspense, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { toBase58ID, type Base58ID } from '@/lib/id'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { RatingChart } from '@/components/rating-chart'
import { findExtremes } from '@/lib/rating-chart'
import { getPlayerStatsPromise, type PlayerStats, type GameEloStat, type GameMatchStat } from '@/app/api'
import { useMe } from '@/app/meContext'
import { useTenantScope } from '@/app/tenantScopeContext'
import { PageHeader } from '@/app/pageHeaderContext'
import { PageContainer } from '@/components/page-container'
import { ErrorAlert } from '@/components/error-alert'
import { RankIcon } from '@/components/rank-icon'
import { formatDate } from '@/lib/datetime'
import { useAsyncResource } from '@/hooks/useAsyncResource'
import { BackButton } from '@/components/back-button'

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
                                        <td className={`py-2 text-right font-mono ${row.elo_earned >= 0 ? 'text-success' : 'text-destructive'}`}>
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
                                    <th className="py-2 px-1"><div className="flex justify-center"><RankIcon rank={1} /></div></th>
                                    <th className="py-2 px-1"><div className="flex justify-center"><RankIcon rank={2} /></div></th>
                                    <th className="py-2 px-1"><div className="flex justify-center"><RankIcon rank={3} /></div></th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(row => (
                                    <tr key={row.game_id} className="border-b last:border-0">
                                        <td className="py-2 pr-4">{row.game_name}</td>
                                        <td className="py-2 pr-4 text-right">{row.matches_count}</td>
                                        <td className="py-2 px-1 text-center">{row.gold_count}</td>
                                        <td className="py-2 px-1 text-center">{row.silver_count}</td>
                                        <td className="py-2 px-1 text-center">{row.bronze_count}</td>
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
        <PageContainer width="wide">
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
        </PageContainer>
    )
}

function PlayerProfileContent({ stats, tenantName }: { stats: PlayerStats; tenantName?: string }) {
    const history = stats.rating_history
    const current = history.length > 0 ? history[history.length - 1] : null
    const extremes = useMemo(() => findExtremes(history), [history])

    return (
        <PageContainer width="wide">
            <BackButton href="/" />
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
                    <div className="flex flex-wrap gap-1 pt-2 text-xs">
                        {tenantName && (
                            <Badge variant="secondary" title="Рейтинг и игры этой страницы считаются в основном арене сообщества">
                                Рейтинг сообщества «{tenantName}»
                            </Badge>
                        )}
                        {extremes && (
                            <>
                                <Badge variant="secondary">эло макс {extremes.eloMax.value} · {formatDate(extremes.eloMax.date)}</Badge>
                                <Badge variant="secondary">эло мин {extremes.eloMin.value} · {formatDate(extremes.eloMin.date)}</Badge>
                            </>
                        )}
                    </div>
                </CardHeader>
                <CardContent>
                    <RatingChart history={history} />
                </CardContent>
            </Card>

            <MatchesTable rows={stats.top_games_by_matches} />
            <EloTable rows={stats.top_games_by_elo_earned} title="Успешные игры" />
            <EloTable rows={stats.worst_games_by_elo_earned} title="&quot;Я понял как играть&quot;" />
        </PageContainer>
    )
}

function PlayerPageContent() {
    const searchParams = useSearchParams()
    const id = toBase58ID(searchParams.get('id') ?? '')
    const { ready, tenantId, tenant } = useTenantScope()

    if (!id) return <div className="p-6 text-muted-foreground">Игрок не указан</div>
    // The tenant scope settles within the first ticks (a deep link carries
    // ?tenant=; otherwise the default resolution needs the tenants list) —
    // hold the skeleton rather than flash global-arena numbers.
    if (!ready) return <LoadingSkeleton />

    return <PlayerStatsView id={id} tenantId={tenantId} tenantName={tenant?.name} />
}

function PlayerStatsView({ id, tenantId, tenantName }: { id: Base58ID; tenantId: Base58ID | null; tenantName?: string }) {
    // The stats read is tenant-required (ADR-36 phase 5); hold loading while
    // unresolved (the scope's prompt covers the rare no-tenant case).
    const { data: stats, loading, error } = useAsyncResource(
        () => (tenantId ? getPlayerStatsPromise(id, { tenant: tenantId }) : new Promise<PlayerStats>(() => {})),
        [id, tenantId],
    )

    if (loading) return <LoadingSkeleton />
    if (error) return <div className="p-6"><ErrorAlert message={error} /></div>
    if (!stats) return <div className="p-6"><ErrorAlert message="Данные игрока не найдены" /></div>

    return <PlayerProfileContent stats={stats} tenantName={tenantName} />
}

export default function PlayerPage() {
    return (
        <Suspense fallback={<LoadingSkeleton />}>
            <PlayerPageContent />
        </Suspense>
    )
}
