"use client"
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { OutcomeMarket, getMarketsPromise, cancelMarketPromise } from "@/app/api";
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
    const { players } = usePlayers();
    const { games } = useGames();
    const [markets, setMarkets] = useState<OutcomeMarket[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [cancelTarget, setCancelTarget] = useState<OutcomeMarket | null>(null);
    const [cancelling, setCancelling] = useState(false);

    useEffect(() => {
        setLoading(true);
        getMarketsPromise()
            .then((data) => setMarkets(data.active))
            .catch((e) => setError(e instanceof Error ? e.message : String(e)))
            .finally(() => setLoading(false));
    }, []);

    async function confirmCancel() {
        if (!cancelTarget) return;
        setCancelling(true);
        try {
            await cancelMarketPromise(cancelTarget.id);
            setMarkets((prev) => prev.filter((m) => m.id !== cancelTarget.id));
            setCancelTarget(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setCancelling(false);
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
                            onClick={() => setCancelTarget(market)}
                        >
                            Отменить рынок
                        </Button>
                    )}
                </div>
            ))}

            <Dialog open={!!cancelTarget} onOpenChange={(open) => { if (!open) setCancelTarget(null); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Отменить рынок?</DialogTitle>
                        <DialogDescription>
                            «{cancelTarget ? getMarketTitle(cancelTarget, players, games) : ""}» будет отменён. Ставки будут возвращены участникам.
                            Это действие необратимо.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={cancelling}>
                            Назад
                        </Button>
                        <Button variant="destructive" onClick={confirmCancel} disabled={cancelling}>
                            {cancelling ? "Отмена..." : "Отменить"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </main>
    );
}
