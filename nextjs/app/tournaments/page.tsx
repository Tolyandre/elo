"use client";

import Link from "next/link";
import { PageHeader } from "@/app/pageHeaderContext";
import { getTournamentsPromise } from "@/app/api";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useMe } from "@/app/meContext";
import { ErrorAlert } from "@/components/error-alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TournamentList } from "./tournament-list";

/**
 * The /tournaments page (ADR-26 §UI) — kept for deep links; the primary entry
 * point is the tournaments tab of /arenas, which renders the same list.
 */
export default function TournamentsPage() {
    const { canEdit } = useMe();
    const { data: tournaments, loading, error } = useAsyncResource(() => getTournamentsPromise());

    return (
        <main className="max-w-sm mx-auto space-y-6">
            <PageHeader
                title="Турниры"
                action={canEdit ? (
                    <Button asChild size="sm"><Link href="/tournaments/new">Создать турнир</Link></Button>
                ) : undefined}
            />
            {error && <ErrorAlert message={error} />}
            {loading && (
                <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full rounded-xl" />
                    ))}
                </div>
            )}
            {tournaments && tournaments.length === 0 && (
                <p className="text-sm text-muted-foreground">Турниров пока нет</p>
            )}
            {tournaments && tournaments.length > 0 && (
                <TournamentList tournaments={tournaments} />
            )}
        </main>
    );
}
