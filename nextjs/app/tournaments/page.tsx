"use client";

import Link from "next/link";
import { PageHeader } from "@/app/pageHeaderContext";
import { getTournamentsPromise } from "@/app/api";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useMe } from "@/app/meContext";
import { ErrorAlert } from "@/components/error-alert";
import { Button } from "@/components/ui/button";
import { LoadingRows } from "@/components/loading-rows";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { TournamentList } from "./tournament-list";

/**
 * The /tournaments page (ADR-26 §UI) — kept for deep links; the primary entry
 * point is the tournaments tab of /arenas, which renders the same list.
 */
export default function TournamentsPage() {
    const { canEdit } = useMe();
    const { data: tournaments, loading, error } = useAsyncResource(() => getTournamentsPromise());

    return (
        <PageContainer width="narrow">
            <PageHeader
                title="Турниры"
                action={canEdit ? (
                    <Button asChild size="sm"><Link href="/tournaments/new">Создать турнир</Link></Button>
                ) : undefined}
            />
            {error && <ErrorAlert message={error} />}
            {loading && <LoadingRows count={3} />}
            {tournaments && tournaments.length === 0 && (
                <EmptyState title="Турниров пока нет" />
            )}
            {tournaments && tournaments.length > 0 && (
                <TournamentList tournaments={tournaments} />
            )}
        </PageContainer>
    );
}
