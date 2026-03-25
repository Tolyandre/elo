"use client"
import React, { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MarketDetail, getMarketByIdPromise, placeBetPromise } from "@/app/api";
import { useMe } from "@/app/meContext";
import { Button } from "@/components/ui/button";
import { MarketCard } from "@/components/market-card";

function OutcomeColumn({
    label,
    myStaked,
    canBet,
    onBet,
    betting,
}: {
    label: string;
    myStaked?: number;
    canBet: boolean;
    onBet?: () => void;
    betting: boolean;
}) {
    return (
        <div className="flex-1 flex flex-col p-3 border rounded-lg gap-2">
            <h3 className="font-semibold text-lg text-center">{label}</h3>
            <div className="text-sm space-y-1">
                {myStaked !== undefined && myStaked > 0 && (
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Моя ставка:</span>
                        <span>{myStaked.toFixed(1)}</span>
                    </div>
                )}
            </div>
            {onBet && (
                <Button
                    size="sm"
                    className="w-full mt-auto"
                    onClick={onBet}
                    disabled={!canBet || betting}
                >
                    {betting ? "..." : "Поставить 1"}
                </Button>
            )}
        </div>
    );
}

function MarketPageContent() {
    const searchParams = useSearchParams();
    const id = searchParams.get("id") ?? "";
    const me = useMe();

    const [market, setMarket] = useState<MarketDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [bettingYes, setBettingYes] = useState(false);
    const [bettingNo, setBettingNo] = useState(false);

    useEffect(() => {
        if (!id) return;
        setLoading(true);
        getMarketByIdPromise(id).then(setMarket).finally(() => setLoading(false));
    }, [id]);

    if (loading || !market) {
        return (
            <main className="max-w-sm mx-auto">
                <p className="text-muted-foreground">{loading ? "Загрузка..." : "Рынок не найден"}</p>
            </main>
        );
    }

    const isOpen = market.status === "open";
    const hasPlayer = !!(me.playerId);
    const isLoggedIn = me.isAuthenticated;
    const canBet = isOpen && isLoggedIn && hasPlayer;

    const betDisabledReason = !isLoggedIn
        ? "Авторизуйтесь и привяжите игрока в Настройках"
        : !hasPlayer
        ? "Привяжите игрока в Настройках"
        : "";

    async function handleBet(outcome: "yes" | "no") {
        if (outcome === "yes") setBettingYes(true);
        else setBettingNo(true);
        try {
            await placeBetPromise(id, outcome, 1);
            const updated = await getMarketByIdPromise(id);
            setMarket(updated);
        } finally {
            if (outcome === "yes") setBettingYes(false);
            else setBettingNo(false);
        }
    }

    const reserved = market.reserved;
    const betLimit = market.bet_limit;

    return (
        <main className="max-w-sm mx-auto space-y-4">
            <MarketCard market={market} />

            <div className="flex flex-col sm:flex-row gap-3">
                <OutcomeColumn
                    label="ДА"
                    myStaked={market.my_yes_staked}
                    canBet={canBet}
                    onBet={isOpen ? () => handleBet("yes") : undefined}
                    betting={bettingYes}
                />
                <OutcomeColumn
                    label="НЕТ"
                    myStaked={market.my_no_staked}
                    canBet={canBet}
                    onBet={isOpen ? () => handleBet("no") : undefined}
                    betting={bettingNo}
                />
            </div>

            {isOpen && !canBet && betDisabledReason && (
                <p className="text-sm text-muted-foreground text-center">{betDisabledReason}</p>
            )}

            {isOpen && reserved !== undefined && betLimit !== undefined && (
                <p className="text-sm text-muted-foreground text-center">
                    Лимит: {reserved.toFixed(1)} забронировано / {betLimit.toFixed(1)} доступно
                </p>
            )}
        </main>
    );
}

export default function MarketPage() {
    return (
        <Suspense>
            <MarketPageContent />
        </Suspense>
    );
}
