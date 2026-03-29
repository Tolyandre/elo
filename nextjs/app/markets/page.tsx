"use client"
import { Market, getMarketsPromise } from "@/app/api";
import Link from "next/link";
import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { MarketCard } from "@/components/market-card";

export default function MarketsPage() {
    const [data, setData] = useState<{ active: Market[]; closed: Market[] } | null>(null);

    useEffect(() => {
        getMarketsPromise().then(setData);
    }, []);

    if (!data) {
        return (
            <main className="max-w-sm mx-auto space-y-4">
                <h1 className="text-2xl font-semibold">Загрузка...</h1>
            </main>
        );
    }

    return (
        <main className="max-w-sm mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-semibold">Ставки</h1>
                <Button asChild size="sm">
                    <Link href="/markets/new">Создать рынок</Link>
                </Button>
            </div>

            {data.active.length > 0 && (
                <section className="space-y-4">
                    <h2 className="text-lg font-medium">Активные рынки</h2>
                    {data.active.map(m => (
                        <Link key={m.id} href={`/market?id=${m.id}`} className="block">
                            <MarketCard market={m} className="hover:bg-accent transition-colors cursor-pointer" />
                        </Link>
                    ))}
                </section>
            )}

            {data.active.length === 0 && data.closed.length === 0 && (
                <p className="text-muted-foreground text-center py-8">Нет рынков</p>
            )}

            {data.closed.length > 0 && (
                <section className="space-y-4">
                    <h2 className="text-lg font-medium">Завершённые рынки</h2>
                    {data.closed.map(m => (
                        <Link key={m.id} href={`/market?id=${m.id}`} className="block">
                            <MarketCard market={m} className="hover:bg-accent transition-colors cursor-pointer" />
                        </Link>
                    ))}
                </section>
            )}
        </main>
    );
}
