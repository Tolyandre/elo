'use client'

// The profile's game collection ("Коллекция игр"): the games the player keeps
// on their shelf. Everyone sees it; only the user linked to the player
// (users.player_id) may add or remove games — the same link the backend
// enforces. The first PREVIEW_COUNT games show collapsed with the total; the
// rest behind «Показать все».

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Dices, Library, Plus, X } from 'lucide-react'
import { toast } from 'sonner'

import type { Base58ID } from '@/lib/id'
import { addPlayerGamePromise, getPlayerGameCollectionPromise, removePlayerGamePromise, type PlayerCollectionGame } from '@/app/api'
import { useMe } from '@/app/meContext'
import { useGames } from '@/app/gamesContext'
import { useOffline } from '@/app/offline/OfflineContext'
import { useAsyncResource } from '@/hooks/useAsyncResource'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { ErrorAlert } from '@/components/error-alert'
import { LoadingRows } from '@/components/loading-rows'
import { EmptyState } from '@/components/empty-state'
import { GameImage } from '@/components/game-image'
import { GameCombobox } from '@/components/game-combobox'

const PREVIEW_COUNT = 12

function GameChip({
    game,
    canManage,
    busy,
    onRemove,
}: {
    game: PlayerCollectionGame
    canManage: boolean
    busy: boolean
    onRemove: (game: PlayerCollectionGame) => void
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
            {canManage && (
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 shrink-0 rounded-full text-muted-foreground hover:text-destructive"
                    onClick={() => onRemove(game)}
                    disabled={busy}
                    aria-label={`Убрать «${game.name}» из коллекции`}
                >
                    {busy ? <Spinner className="size-3.5" /> : <X className="size-3.5" />}
                </Button>
            )}
        </li>
    )
}

export function CollectionSection({ playerId }: { playerId: Base58ID }) {
    const { data, loading, error, invalidate } = useAsyncResource(
        () => getPlayerGameCollectionPromise(playerId),
        [playerId],
    )
    const { playerId: mePlayerId } = useMe()
    const { games } = useGames()
    const { pendingGames } = useOffline()
    const canManage = !!mePlayerId && mePlayerId === playerId

    const [expanded, setExpanded] = useState(false)
    const [addOpen, setAddOpen] = useState(false)
    // The chip whose remove is in flight (spinner on its X button).
    const [busyId, setBusyId] = useState<string | null>(null)
    // A brand-new game picked from the combobox lives only in the offline
    // queue until a sync run lands it server-side — hold it here and add it
    // to the collection the moment the games catalog knows it.
    const [awaitingId, setAwaitingId] = useState<Base58ID | null>(null)
    const [pickerValue, setPickerValue] = useState<Base58ID | undefined>(undefined)

    const collected = useMemo(() => data?.games ?? [], [data])
    const total = data?.total ?? 0
    const collectedIds = useMemo(() => new Set(collected.map((g) => g.id)), [collected])
    const visible = expanded ? collected : collected.slice(0, PREVIEW_COUNT)
    const awaitingName =
        pendingGames.find((g) => g.clientId === awaitingId)?.name ?? 'Новая игра'

    // The catalog has learned the awaiting game — a sync run landed it, so
    // the collection add can finally go through. The ref keeps the in-flight
    // POST single-shot: the games context re-renders and re-fires this effect
    // while the request is on the wire.
    const addingRef = useRef<Base58ID | null>(null)
    useEffect(() => {
        if (!awaitingId || addingRef.current === awaitingId) return
        if (!games.some((g) => g.id === awaitingId)) return
        addingRef.current = awaitingId
        addPlayerGamePromise(playerId, awaitingId)
            .then(() => {
                setAwaitingId(null)
                toast.success('Игра добавлена в коллекцию')
                invalidate()
            })
            .catch(() => {
                // The error toast comes from the api client middleware; the
                // awaiting chip goes so the game can simply be picked again.
                setAwaitingId(null)
            })
    }, [awaitingId, games, playerId, invalidate])

    const handleRemove = (game: PlayerCollectionGame) => {
        setBusyId(game.id)
        removePlayerGamePromise(playerId, game.id)
            .then(() => invalidate())
            .finally(() => setBusyId(null))
    }

    // Selecting an existing catalog game adds it right away. The combobox
    // value resets so the trigger reads «Игра...» for the next pick.
    const handlePicked = (id?: Base58ID) => {
        setPickerValue(undefined)
        if (!id || collectedIds.has(id) || id === awaitingId) return
        if (!games.some((g) => g.id === id)) {
            // Not in the catalog: a brand-new game queued offline (the
            // combobox's create flow). Its id is final, but the row does not
            // exist server-side until a sync run lands it — the watcher above
            // finishes the collection add then.
            setAwaitingId(id)
            return
        }
        addPlayerGamePromise(playerId, id)
            .then(() => {
                toast.success('Игра добавлена в коллекцию')
                invalidate()
            })
            .catch(() => {
                // The error toast comes from the api client middleware.
            })
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div className="flex items-center gap-2">
                    <CardTitle>Коллекция игр</CardTitle>
                    {!loading && <Badge variant="secondary">{total}</Badge>}
                </div>
                {canManage && (
                    <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                        <Plus className="size-4" />
                        Добавить
                    </Button>
                )}
            </CardHeader>
            <CardContent>
                {error ? (
                    <ErrorAlert message={error} />
                ) : loading ? (
                    <LoadingRows count={2} />
                ) : collected.length === 0 && !awaitingId ? (
                    <EmptyState
                        icon={Library}
                        title="Коллекция пуста"
                        action={
                            canManage ? (
                                <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                                    <Plus className="size-4" />
                                    Добавить игру
                                </Button>
                            ) : undefined
                        }
                    />
                ) : (
                    <>
                        <ul className="flex flex-wrap gap-2">
                            {visible.map((game) => (
                                <GameChip
                                    key={game.id}
                                    game={game}
                                    canManage={canManage}
                                    busy={busyId === game.id}
                                    onRemove={handleRemove}
                                />
                            ))}
                            {awaitingId && (
                                <li className="inline-flex items-center gap-2 rounded-full border border-dashed py-1 pl-3 pr-3 text-sm text-muted-foreground">
                                    <Spinner className="size-3.5" />
                                    «{awaitingName}» — синхронизация…
                                </li>
                            )}
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

            {canManage && (
                <Dialog open={addOpen} onOpenChange={setAddOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Добавить игру в коллекцию</DialogTitle>
                            <DialogDescription>
                                Найдите игру в каталоге или создайте новую — она появится в
                                коллекции сразу после синхронизации.
                            </DialogDescription>
                        </DialogHeader>
                        <GameCombobox
                            value={pickerValue}
                            onChange={handlePicked}
                            filterGame={(game) => !collectedIds.has(game.id)}
                        />
                        {awaitingId && (
                            <p className="text-sm text-muted-foreground">
                                «{awaitingName}» создаётся — добавим её в коллекцию после
                                синхронизации.
                            </p>
                        )}
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setAddOpen(false)}>
                                Готово
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </Card>
    )
}
