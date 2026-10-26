'use client'

// The collection edit page («Коллекция игр» of one player). The profile stays
// read-only — the pencil on its collection card leads here. Any editor (the
// edit permission, not the player link) manages the shelf: adding runs through
// the game multi-select, removal is a plain chip button with no confirmation —
// every real change lands one player-collection audit event (ADR-14). The
// page renders the whole collection: no preview cut, no «Показать все».

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Library, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { toBase58ID, type Base58ID } from '@/lib/id'
import {
    addPlayerGamePromise,
    getPlayerGameCollectionPromise,
    removePlayerGamePromise,
    type PlayerCollectionGame,
} from '@/app/api'
import { useMe } from '@/app/meContext'
import { useGames } from '@/app/gamesContext'
import { usePlayers } from '@/app/players/PlayersContext'
import { useOffline } from '@/app/offline/OfflineContext'
import { useAsyncResource } from '@/hooks/useAsyncResource'
import { PageHeader } from '@/app/pageHeaderContext'
import { PageContainer } from '@/components/page-container'
import { ErrorAlert } from '@/components/error-alert'
import { BackButton } from '@/components/back-button'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LoadingRows } from '@/components/loading-rows'
import { EmptyState } from '@/components/empty-state'
import { GameMultiSelect } from '@/components/game-multi-select'
import { GameChip } from '@/app/players/view/collection-section'

function addedToast(count: number) {
    toast.success(count === 1 ? 'Игра добавлена в коллекцию' : `Добавлено игр: ${count}`)
}

function CollectionEditor({ playerId, title }: { playerId: Base58ID; title: string }) {
    const { data, loading, error, invalidate } = useAsyncResource(
        () => getPlayerGameCollectionPromise(playerId),
        [playerId],
    )
    const { canEdit, loading: meLoading } = useMe()
    const { games } = useGames()
    const { pendingGames } = useOffline()

    const [addOpen, setAddOpen] = useState(false)
    // The games ticked in the multiselect, awaiting the «Добавить» press.
    const [picked, setPicked] = useState<Base58ID[]>([])
    const [adding, setAdding] = useState(false)
    // Games created fresh in the picker: their ids are final but the rows do
    // not exist server-side until a sync run lands them — hold them here and
    // add to the collection the moment the games catalog knows each one.
    const [awaitingIds, setAwaitingIds] = useState<Base58ID[]>([])
    // Per-chip removal spinners; the games stay visible until the server
    // answers (no confirmation step — the audit log holds the story).
    const [removingIds, setRemovingIds] = useState<Set<string>>(new Set())

    const collected = useMemo(() => data?.games ?? [], [data])
    const total = data?.total ?? 0
    const collectedIds = useMemo(() => new Set(collected.map((g) => g.id)), [collected])
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

    const handleRemove = (game: PlayerCollectionGame) => {
        if (removingIds.has(game.id)) return
        setRemovingIds((prev) => new Set(prev).add(game.id))
        removePlayerGamePromise(playerId, game.id)
            .then(() => invalidate())
            .catch(() => {
                // The error toast comes from the api client middleware; the
                // chip stays so the removal can be retried.
            })
            .finally(() =>
                setRemovingIds((prev) => {
                    const next = new Set(prev)
                    next.delete(game.id)
                    return next
                }),
            )
    }

    return (
        <>
            <PageHeader
                title={title}
                action={
                    canEdit ? (
                        <Button size="sm" onClick={() => setAddOpen(true)}>
                            <Plus className="size-4" />
                            Добавить
                        </Button>
                    ) : undefined
                }
            />
            {!meLoading && !canEdit && (
                <p className="text-muted-foreground">У вас нет прав на редактирование коллекций.</p>
            )}
            {canEdit && (
                // The same card the profile shows the shelf in — title with
                // the count chip, chips flowing below.
                <>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0">
                            <div className="flex items-center gap-2">
                                <CardTitle>Коллекция игр</CardTitle>
                                {!loading && <Badge variant="secondary">{total}</Badge>}
                            </div>
                        </CardHeader>
                        <CardContent>
                            {error ? (
                                <ErrorAlert message={error} />
                            ) : loading ? (
                                <LoadingRows count={4} />
                            ) : collected.length === 0 && awaitingIds.length === 0 ? (
                                <EmptyState
                                    icon={Library}
                                    title="Коллекция пуста"
                                    action={
                                        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                                            <Plus className="size-4" />
                                            Добавить игру
                                        </Button>
                                    }
                                />
                            ) : (
                                <ul className="flex flex-wrap gap-2">
                                    {collected.map((game) => (
                                        <GameChip
                                            key={game.id}
                                            game={game}
                                            onRemove={handleRemove}
                                            removing={removingIds.has(game.id)}
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
                            )}
                        </CardContent>
                    </Card>

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
                </>
            )}
        </>
    )
}

function CollectionPageContent() {
    const searchParams = useSearchParams()
    const id = toBase58ID(searchParams.get('id') ?? '')
    const { playerMap, playerDisplayName } = usePlayers()

    if (!id) return <p className="text-muted-foreground">Игрок не указан</p>

    const player = playerMap.get(id)
    const title = player ? playerDisplayName(player) : 'Коллекция игр'

    return (
        <>
            <BackButton href={`/players/view?id=${id}`} />
            <CollectionEditor playerId={id} title={title} />
        </>
    )
}

export default function PlayerCollectionPage() {
    return (
        <PageContainer width="wide">
            <Suspense fallback={<LoadingRows count={4} />}>
                <CollectionPageContent />
            </Suspense>
        </PageContainer>
    )
}
