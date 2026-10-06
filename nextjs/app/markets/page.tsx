"use client"
import { Market, getMarketsPromise } from "@/app/api";
import Link from "next/link";
import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/app/pageHeaderContext";
import { MarketCard } from "@/components/market-card";
import { ErrorAlert } from "@/components/error-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useMarketsLobbySSE } from "@/hooks/useMarketsSSE";
import { PageContainer } from "@/components/page-container";
import { SectionHeader } from "@/components/section-header";
import { EmptyState } from "@/components/empty-state";

export default function MarketsPage() {
    const [data, setData] = useState<{ active: Market[]; closed: Market[] } | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Refetch on every "markets-changed" signal (create/delete/bet/close).
    const lobbyTick = useMarketsLobbySSE(true);

    useEffect(() => {
        getMarketsPromise()
            .then(setData)
            .catch((e) => setError(e instanceof Error ? e.message : String(e)))
            .finally(() => setLoading(false));
    }, [lobbyTick]);

    return (
        <PageContainer width="narrow">
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
                            <SectionHeader>Активные рынки</SectionHeader>
                            {data.active.map(m => (
                                <Link key={m.id} href={`/markets/view?id=${m.id}`} className="block">
                                    <MarketCard market={m} className="hover:bg-accent transition-colors cursor-pointer" />
                                </Link>
                            ))}
                        </section>
                    )}

                    {data.active.length === 0 && data.closed.length === 0 && (
                        <EmptyState title="Нет рынков" />
                    )}

                    {data.closed.length > 0 && (
                        <section className="space-y-4">
                            <SectionHeader>Завершённые рынки</SectionHeader>
                            {data.closed.map(m => (
                                <Link key={m.id} href={`/markets/view?id=${m.id}`} className="block">
                                    <MarketCard market={m} className="hover:bg-accent transition-colors cursor-pointer" />
                                </Link>
                            ))}
                        </section>
                    )}
                </>
            )}
        </PageContainer>
    );
}
