"use client"
import { Market, getMarketsPromise } from "@/app/api";
import Link from "next/link";
import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/app/pageHeaderContext";
import { MarketCard } from "@/components/market-card";
import { ErrorAlert } from "@/components/error-alert";
import { Skeleton } from "@/components/ui/skeleton";

export default function MarketsPage() {
    const [data, setData] = useState<{ active: Market[]; closed: Market[] } | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        getMarketsPromise()
            .then(setData)
            .catch((e) => setError(e instanceof Error ? e.message : String(e)))
            .finally(() => setLoading(false));
    }, []);

    return (
        <main className="max-w-sm mx-auto space-y-6">
            <PageHeader
                title="Ставки"
                action={<Button asChild size="sm"><Link href="/markets/new">Создать рынок</Link></Button>}
            />

            {error && <ErrorAlert message={error} />}

            {loading ? (
                <>
                    {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-28 w-full rounded-xl" />
                    ))}
                </>
            ) : data && (
                <>
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
                </>
            )}
        </main>
    );
}
