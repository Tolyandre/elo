import Link from "next/link";
import { Tournament } from "@/app/api";
import { tournamentStatusLabel } from "./labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The tournaments list shared by the /tournaments page and the tournaments
 * tab of /arenas (ADR-26 §UI): rows with name, status chip and participants
 * count. The hosts own fetching, loading/error/empty states.
 */
export function TournamentList({ tournaments }: { tournaments: Tournament[] }) {
    return (
        <Card>
            <CardContent className="divide-y px-3">
                {tournaments.map((t) => (
                    <TournamentItem key={t.id} tournament={t} />
                ))}
            </CardContent>
        </Card>
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
