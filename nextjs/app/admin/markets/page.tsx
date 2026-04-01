"use client"
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Market, getMarketsPromise, deleteMarketPromise } from "@/app/api";
import { useMe } from "@/app/meContext";
import { usePlayers } from "@/app/players/PlayersContext";
import { useGames } from "@/app/gamesContext";
import { Button } from "@/components/ui/button";
import { MarketCard } from "@/components/market-card";
import { getMarketTitle } from "@/app/market/marketTypes";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

export default function AdminMarketsPage() {
    const me = useMe();
    const { players, playerDisplayName } = usePlayers();
    const { games } = useGames();
    const [markets, setMarkets] = useState<Market[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<Market | null>(null);
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        setLoading(true);
        getMarketsPromise()
            .then((data) => setMarkets(data.active))
            .catch((e) => setError(e instanceof Error ? e.message : String(e)))
            .finally(() => setLoading(false));
    }, []);

    async function confirmDelete() {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await deleteMarketPromise(deleteTarget.id);
            setMarkets((prev) => prev.filter((m) => m.id !== deleteTarget.id));
            setDeleteTarget(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setDeleting(false);
        }
    }

    return (
        <main className="p-4 max-w-sm mx-auto space-y-4">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-semibold">Активные рынки</h1>
                <Button variant="link" asChild className="px-0">
                    <Link href="/admin">Назад</Link>
                </Button>
            </div>

            {loading && <p className="text-muted-foreground">Загрузка...</p>}
            {error && <p className="text-sm text-destructive">{error}</p>}
            {!loading && markets.length === 0 && (
                <p className="text-muted-foreground">Активных рынков нет</p>
            )}

            {markets.map((market) => (
                <div key={market.id} className="space-y-2">
                    <MarketCard market={market} />
                    {me.canEdit && (
                        <Button
                            variant="destructive"
                            size="sm"
                            className="w-full"
                            onClick={() => setDeleteTarget(market)}
                        >
                            Удалить рынок
                        </Button>
                    )}
                </div>
            ))}

            <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Удалить рынок?</DialogTitle>
                        <DialogDescription>
                            «{deleteTarget ? getMarketTitle(deleteTarget, players, games, playerDisplayName) : ""}» будет удалён безвозвратно. Все ставки будут аннулированы, рейтинг будет пересчитан.
                            Это действие необратимо.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                            Назад
                        </Button>
                        <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
                            {deleting ? "Удаление..." : "Удалить"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </main>
    );
}
