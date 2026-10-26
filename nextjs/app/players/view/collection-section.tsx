'use client'

// The profile's game collection («Коллекция игр»): the games the player keeps
// on their shelf. Everyone sees it; the profile is read-only — editors reach
// the collection edit page («/players/collection») through the pencil in the
// section header. The first PREVIEW_COUNT games show collapsed with the
// total; the rest behind «Показать все». The server orders by the player's
// play count.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Dices, Pencil, X } from 'lucide-react'

import type { Base58ID } from '@/lib/id'
import { getPlayerGameCollectionPromise, type PlayerCollectionGame } from '@/app/api'
import { useMe } from '@/app/meContext'
import { useAsyncResource } from '@/hooks/useAsyncResource'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ErrorAlert } from '@/components/error-alert'
import { LoadingRows } from '@/components/loading-rows'
import { GameImage } from '@/components/game-image'

const PREVIEW_COUNT = 12

export function GameChip({
    game,
    onRemove,
    removing,
}: {
    game: PlayerCollectionGame
    onRemove?: (game: PlayerCollectionGame) => void
    removing?: boolean
}) {
    return (
        <li className="inline-flex max-w-full items-center gap-2 rounded-full border bg-background py-1 pl-1 pr-2">
            {game.image_thumb_url ? (
                <GameImage src={game.image_thumb_url} alt="" className="size-8 shrink-0 rounded-full" />
            ) : (
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Dices className="size-4 text-muted-foreground" />
                </span>
            )}
            <Link
                href={`/games/view?id=${game.id}`}
                className="min-w-0 truncate text-sm underline-offset-2 hover:underline"
            >
                {game.name}
            </Link>
            {onRemove && (
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 shrink-0 rounded-full text-muted-foreground hover:text-destructive"
                    disabled={removing}
                    onClick={() => onRemove(game)}
                    aria-label={`Убрать «${game.name}» из коллекции`}
                >
                    {removing ? <Spinner className="size-3" /> : <X className="size-3.5" />}
                </Button>
            )}
        </li>
    )
}

export function CollectionSection({ playerId }: { playerId: Base58ID }) {
    const { data, loading, error } = useAsyncResource(
        () => getPlayerGameCollectionPromise(playerId),
        [playerId],
    )
    const { canEdit } = useMe()

    const [expanded, setExpanded] = useState(false)

    const collected = useMemo(() => data?.games ?? [], [data])
    const total = data?.total ?? 0
    const visible = expanded ? collected : collected.slice(0, PREVIEW_COUNT)

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div className="flex items-center gap-2">
                    <CardTitle>Коллекция игр</CardTitle>
                    {!loading && <Badge variant="secondary">{total}</Badge>}
                </div>
                {canEdit && (
                    <Button asChild size="icon-sm" variant="ghost" aria-label="Изменить коллекцию игр">
                        <Link href={`/players/collection?id=${playerId}`}>
                            <Pencil className="size-4" />
                        </Link>
                    </Button>
                )}
            </CardHeader>
            {(error || loading || collected.length > 0) && (
                <CardContent>
                    {error ? (
                        <ErrorAlert message={error} />
                    ) : loading ? (
                        <LoadingRows count={2} />
                    ) : (
                        <>
                            <ul className="flex flex-wrap gap-2">
                                {visible.map((game) => (
                                    <GameChip key={game.id} game={game} />
                                ))}
                            </ul>
                            {collected.length > PREVIEW_COUNT && (
                                <div className="mt-3">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setExpanded((v) => !v)}
                                    >
                                        {expanded ? 'Свернуть' : `Показать все (${total})`}
                                    </Button>
                                </div>
                            )}
                        </>
                    )}
                </CardContent>
            )}
        </Card>
    )
}
