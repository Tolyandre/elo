"use client";

import Link from "next/link";
import { PageHeader } from "@/app/pageHeaderContext";
import { useTournaments } from "@/app/tournamentsContext";
import { useMe } from "@/app/meContext";
import { Button } from "@/components/ui/button";

export default function TournamentsPage() {
    const { tournaments } = useTournaments();
    const { canEdit } = useMe();

    return (
        <main className="max-w-sm mx-auto space-y-6">
            <PageHeader
                title="Кемпы и турниры"
                action={canEdit ? (
                    <Button asChild size="sm"><Link href="/tournaments/new">Создать турнир</Link></Button>
                ) : undefined}
            />

            {tournaments.length === 0 ? (
                <p className="text-muted-foreground">Турниров пока нет</p>
            ) : (
                <div className="space-y-2">
                    {tournaments.map((t) => (
                        <div key={t.id} className="border rounded p-3 flex items-center justify-between gap-2">
                            <Link href={`/tournament?id=${t.id}`} className="font-medium underline">
                                {t.name}
                            </Link>
                            {canEdit && (
                                <Link href={`/tournaments/edit?id=${t.id}`} className="text-sm text-blue-600 shrink-0">
                                    Изменить
                                </Link>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </main>
    );
}
