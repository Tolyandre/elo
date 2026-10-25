'use client'

// The profile's game collection («Коллекция игр»): the games the player keeps
// on their shelf. Everyone sees it; only the user linked to the player
// (users.player_id) may add or remove games — the same link the backend
// enforces. The first PREVIEW_COUNT games show collapsed with the total; the
// rest behind «Показать все». The server orders by the player's play count.

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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ConfirmDialog, useConfirmAction } from '@/components/confirm-dialog'
import { ErrorAlert } from '@/components/error-alert'
import { LoadingRows } from '@/components/loading-rows'
import { EmptyState } from '@/components/empty-state'
import { GameImage } from '@/components/game-image'
import { GameMultiSelect } from '@/components/game-multi-select'

const PREVIEW_COUNT = 12

function addedToast(count: number) {
    toast.success(count === 1 ? 'Игра добавлена в коллекцию' : `Добавлено игр: ${count}`)
}

function GameChip({
    game,
    canManage,
    onRemove,
}: {
    game: PlayerCollectionGame
    canManage: boolean
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
                    aria-label={`Убрать «${game.name}» из коллекции`}
                >
                    <X className="size-3.5" />
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
    // The games ticked in the multiselect, awaiting the «Добавить» press.
    const [picked, setPicked] = useState<Base58ID[]>([])
    const [adding, setAdding] = useState(false)
    // Games created fresh in the picker: their ids are final but the rows do
    // not exist server-side until a sync run lands them — hold them here and
    // add to the collection the moment the games catalog knows each one.
    const [awaitingIds, setAwaitingIds] = useState<Base58ID[]>([])

    const collected = useMemo(() => data?.games ?? [], [data])
    const total = data?.total ?? 0
    const collectedIds = useMemo(() => new Set(collected.map((g) => g.id)), [collected])
    const visible = expanded ? collected : collected.slice(0, PREVIEW_COUNT)
    const awaitingName = (id: Base58ID) =>
        pendingGames.find((g) => g.clientId === id)?.name ?? 'Новая игра'

    // The catalog has learned some awaiting games — a sync run landed them,
    // so their collection adds can finally go through. The ref keeps each
    // in-flight POST single-shot: the games context re-renders and re-fires
    // this effect while the requests are on the wire.
    const addingRef = useRef<Set<string>>(new Set())
    useEffect(() => {
        if (awaitingIds.length === 0) return
        const ready = awaitingIds.filter(
            (id) => games.some((g) => g.id === id) && !addingRef.current.has(id),
        )
        if (ready.length === 0) return
        ready.forEach((id) => addingRef.current.add(id))
        Promise.all(ready.map((id) => addPlayerGamePromise(playerId, id).then(() => id)))
            .then((addedIds) => {
                setAwaitingIds((prev) => prev.filter((id) => !addedIds.includes(id)))
                addedToast(addedIds.length)
                invalidate()
            })
            .catch(() => {
                // The error toast comes from the api client middleware; the
                // awaiting chips go so the games can simply be picked again.
                setAwaitingIds((prev) => prev.filter((id) => !ready.includes(id)))
            })
    }, [awaitingIds, games, playerId, invalidate])

    const handleAddPicked = () => {
        if (picked.length === 0 || adding) return
        // A picked id absent from the catalog is a brand-new offline game
        // (the picker's create flow); the known ones add right away, the
        // fresh ones join through the watcher above once synced.
        const fresh = picked.filter((id) => !games.some((g) => g.id === id))
        const known = picked.filter((id) => games.some((g) => g.id === id))
        setAdding(true)
        Promise.all(known.map((id) => addPlayerGamePromise(playerId, id).then(() => id)))
            .then((addedIds) => {
                if (addedIds.length > 0) {
                    addedToast(addedIds.length)
                    invalidate()
                }
                setPicked([])
                if (fresh.length > 0) setAwaitingIds((prev) => [...prev, ...fresh])
                setAddOpen(false)
            })
            .catch(() => {
                // The error toast comes from the api client middleware; the
                // dialog stays open with the selection so the user can retry.
            })
            .finally(() => setAdding(false))
    }

    const removeAction = useConfirmAction(async (game: PlayerCollectionGame) => {
        await removePlayerGamePromise(playerId, game.id)
        invalidate()
    })

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
                ) : collected.length === 0 && awaitingIds.length === 0 ? (
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
                                    onRemove={removeAction.trigger}
                                />
                            ))}
                            {awaitingIds.map((id) => (
                                <li
                                    key={id}
                                    className="inline-flex items-center gap-2 rounded-full border border-dashed py-1 pl-3 pr-3 text-sm text-muted-foreground"
                                >
                                    <Spinner className="size-3.5" />
                                    «{awaitingName(id)}» — синхронизация…
                                </li>
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

            {canManage && (
                <Dialog open={addOpen} onOpenChange={setAddOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Добавить игры в коллекцию</DialogTitle>
                        </DialogHeader>
                        <GameMultiSelect
                            value={picked}
                            onChange={setPicked}
                            filter={(game) => !collectedIds.has(game.id)}
                        />
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setAddOpen(false)}>
                                Отмена
                            </Button>
                            <Button
                                onClick={handleAddPicked}
                                disabled={picked.length === 0 || adding}
                                aria-busy={adding}
                            >
                                {adding && <Spinner className="size-4" />}
                                Добавить{picked.length > 0 ? ` (${picked.length})` : ''}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}

            <ConfirmDialog
                open={removeAction.open}
                onOpenChange={removeAction.onOpenChange}
                title="Убрать игру из коллекции?"
                description={
                    removeAction.target
                        ? `${removeAction.target.name}`
                        : undefined
                }
                confirmText="Убрать"
                confirmVariant="destructive"
                loading={removeAction.pending}
                onConfirm={removeAction.confirm}
            />
        </Card>
    )
}
