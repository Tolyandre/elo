"use client"
import { Market, getMarketsPagePromise } from "@/app/api";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/app/pageHeaderContext";
import { MarketCard } from "@/components/market-card";
import { ErrorAlert } from "@/components/error-alert";
import { LoadingRows } from "@/components/loading-rows";
import { useMarketsLobbySSE } from "@/hooks/useMarketsSSE";
import { PageContainer } from "@/components/page-container";
import { SectionHeader } from "@/components/section-header";
import { EmptyState } from "@/components/empty-state";
import { Spinner } from "@/components/ui/spinner";

/**
 * The markets lobby (ADR-32): the active markets on top (always full — the
 * bucket is small), the closed markets under infinite scroll (one keyset page
 * per step, the cursor carries the page state). A "markets-changed" SSE
 * signal (create/delete/bet/close) reloads page 1 and resets the cursor.
 */
export default function MarketsPage() {
    const [active, setActive] = useState<Market[] | null>(null);
    const [closed, setClosed] = useState<Market[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const cursorRef = useRef<string | null>(null);
    const sentinelRef = useRef<HTMLDivElement | null>(null);

    const lobbyTick = useMarketsLobbySSE(true);

    const loadPage = useCallback((params?: { closed_next?: string }) => {
        return getMarketsPagePromise(params);
    }, []);

    // (Re)load page 1 on mount and on every lobby signal.
    useEffect(() => {
        let cancelled = false;
        /* eslint-disable-next-line react-hooks/set-state-in-effect -- reset loading/error before async fetch */
        setLoading(true);
        setError(null);
        cursorRef.current = null;
        loadPage()
            .then((data) => {
                if (cancelled) return;
                setActive(data.active);
                setClosed(data.closed);
                cursorRef.current = data.next;
            })
            .catch((e) => {
                if (!cancelled) setError(e instanceof Error ? e.message : String(e));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [lobbyTick, loadPage]);

    const loadMore = useCallback(() => {
        if (loadingMore) return;
        const cursor = cursorRef.current;
        if (!cursor) return;
        setLoadingMore(true);
        loadPage({ closed_next: cursor })
            .then((data) => {
                cursorRef.current = data.next;
                setClosed((prev) => {
                    const seen = new Set(prev.map((m) => m.id));
                    return [...prev, ...data.closed.filter((m) => !seen.has(m.id))];
                });
            })
            .finally(() => setLoadingMore(false));
    }, [loadingMore, loadPage]);

    useEffect(() => {
        const node = sentinelRef.current;
        if (!node) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting) && cursorRef.current && !loadingMore && !loading) {
                    loadMore();
                }
            },
            { rootMargin: "200px" },
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [loading, loadingMore, loadMore]);

    return (
        <PageContainer width="narrow">
            <PageHeader
                title="Ставки"
                action={<Button asChild size="sm"><Link href="/markets/new">Создать рынок</Link></Button>}
            />

            {error && <ErrorAlert message={error} />}

            {loading ? (
                <LoadingRows count={3} />
            ) : active !== null && (
                <>
                    {active.length > 0 && (
                        <section className="space-y-4">
                            <SectionHeader>Активные рынки</SectionHeader>
                            {active.map(m => (
                                <Link key={m.id} href={`/markets/view?id=${m.id}`} className="block">
                                    <MarketCard market={m} className="hover:bg-accent transition-colors cursor-pointer" />
                                </Link>
                            ))}
                        </section>
                    )}

                    {active.length === 0 && closed.length === 0 && (
                        <EmptyState title="Нет рынков" />
                    )}

                    {closed.length > 0 && (
                        <section className="space-y-4">
                            <SectionHeader>Завершённые рынки</SectionHeader>
                            {closed.map(m => (
                                <Link key={m.id} href={`/markets/view?id=${m.id}`} className="block">
                                    <MarketCard market={m} className="hover:bg-accent transition-colors cursor-pointer" />
                                </Link>
                            ))}
                        </section>
                    )}

                    <div ref={sentinelRef} className="flex justify-center py-4">
                        {loadingMore && <Spinner className="size-6" />}
                    </div>
                </>
            )}
        </PageContainer>
    );
}
