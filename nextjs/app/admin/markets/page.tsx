"use client"
import React from "react";
import Link from "next/link";
import { Market, getMarketsPromise, deleteMarketPromise, closeMarketBettingPromise } from "@/app/api";
import { PageHeader } from "@/app/pageHeaderContext";
import { useMe } from "@/app/meContext";
import { usePlayers } from "@/app/players/PlayersContext";
import { useGames } from "@/app/gamesContext";
import { Button } from "@/components/ui/button";
import { MarketCard } from "@/components/market-card";
import { ErrorAlert } from "@/components/error-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { getMarketTitle } from "@/app/market/marketTypes";
import { ConfirmDialog, useConfirmAction } from "@/components/confirm-dialog";
import { useAsyncResource } from "@/hooks/useAsyncResource";

export default function AdminMarketsPage() {
    const me = useMe();
    const { players, playerDisplayName } = usePlayers();
    const { games } = useGames();
    const { data: marketsData, loading, error, invalidate } = useAsyncResource(async () => (await getMarketsPromise()).active);
    const markets = marketsData ?? [];

    const closeBetting = useConfirmAction(async (m: Market) => {
        await closeMarketBettingPromise(m.id);
        invalidate();
    });

    const del = useConfirmAction(async (m: Market) => {
        await deleteMarketPromise(m.id);
        invalidate();
    });

    return (
        <main className="p-4 max-w-sm mx-auto space-y-4">
            <PageHeader title="Активные рынки" />
            <div className="mb-4">
                <Button variant="link" asChild className="px-0">
                    <Link href="/admin">Назад</Link>
                </Button>
            </div>

            {error && <ErrorAlert message={error} />}
            {loading && (
                <>
                    {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-28 w-full rounded-xl" />
                    ))}
                </>
            )}
            {!loading && !error && markets.length === 0 && (
                <p className="text-muted-foreground">Активных рынков нет</p>
            )}

            {markets.map((market) => (
                <div key={market.id} className="space-y-2">
                    <MarketCard market={market} />
                    {me.canEdit && (
                        <div className="flex flex-col gap-2">
                            {market.status === "open" && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full"
                                    onClick={() => closeBetting.trigger(market)}
                                >
                                    Закрыть ставки
                                </Button>
                            )}
                            <Button
                                variant="destructive"
                                size="sm"
                                className="w-full"
                                onClick={() => del.trigger(market)}
                            >
                                Удалить рынок
                            </Button>
                        </div>
                    )}
                </div>
            ))}

            <ConfirmDialog
                open={closeBetting.open}
                onOpenChange={closeBetting.onOpenChange}
                title="Закрыть приём ставок?"
                description={closeBetting.target ? <>На рынок «{getMarketTitle(closeBetting.target, players, games, playerDisplayName)}» больше нельзя будет поставить новые ставки. Рынок ещё не разрешён и может быть разрешён или отменён позднее.</> : undefined}
                cancelText="Назад"
                confirmText="Закрыть ставки"
                loading={closeBetting.pending}
                onConfirm={closeBetting.confirm}
            />

            <ConfirmDialog
                open={del.open}
                onOpenChange={del.onOpenChange}
                title="Удалить рынок?"
                description={del.target ? <>«{getMarketTitle(del.target, players, games, playerDisplayName)}» будет удалён безвозвратно. Все ставки будут аннулированы, рейтинг будет пересчитан.
                    Это действие необратимо.</> : undefined}
                cancelText="Назад"
                confirmText="Удалить"
                confirmVariant="destructive"
                loading={del.pending}
                onConfirm={del.confirm}
            />
        </main>
    );
}
