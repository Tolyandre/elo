"use client";

import Link from "next/link";
import { PageHeader } from "@/app/pageHeaderContext";
import { Tournament, getTournamentsPromise } from "@/app/api";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useMe } from "@/app/meContext";
import { tournamentStatusLabel } from "./labels";
import { ErrorAlert } from "@/components/error-alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The tournaments list (ADR-26 §UI): rows with name, status chip and
 * participants count, open tournaments (registration/running) first — the
 * order the server delivers. Feeds its own fetch so loading/error/refetch
 * stay local to the page; the app-wide preloaded list lives in
 * TournamentsProvider (main page, match form).
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
                <Card>
                    <CardContent className="divide-y px-3">
                        {tournaments.map((t) => (
                            <TournamentItem key={t.id} tournament={t} />
                        ))}
                    </CardContent>
                </Card>
            )}
        </main>
    );
}

function TournamentItem({ tournament: t }: { tournament: Tournament }) {
    return (
        <div className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
            <span className="min-w-0">
                <Link href={`/tournaments/view?id=${t.id}`} className="font-medium underline min-w-0">
                    {t.name}
                </Link>
                <span className="block text-sm text-muted-foreground">
                    Участников: {t.participant_ids?.length ?? 0}
                </span>
            </span>
            <Badge variant={statusBadgeVariant(t.status)} className="shrink-0 whitespace-nowrap">
                {tournamentStatusLabel(t.status)}
            </Badge>
        </div>
    );
}

function statusBadgeVariant(status: Tournament["status"]): "default" | "secondary" | "outline" | "destructive" {
    switch (status) {
        case "registration": return "secondary";
        case "running": return "default";
        case "completed": return "outline";
        case "cancelled": return "destructive";
    }
}
