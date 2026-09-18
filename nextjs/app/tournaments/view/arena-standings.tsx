"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { Base58ID } from "@/lib/id";
import { getArenaPlayersPromise, getArenasPromise } from "@/app/api";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { ArenaPlayersGroups, type ArenaRankPeriod } from "@/components/arena-players-table";
import { ArenaMedalsTab } from "@/app/arenas/view/arena-medals-tab";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The tournament page's rating embed (ADR-26): the tournament's auto-managed
 * arena (created at start) renders its standings and medals — rating and
 * medals come from the arena for free. Before the start there is no arena.
 */
export function TournamentArenaStandings({ tournamentId }: { tournamentId: Base58ID }) {
    const [period, setPeriod] = useLocalStorage<ArenaRankPeriod>("arena-players-period", "day_ago");

    const { data, loading, error, invalidate } = useAsyncResource(async () => {
        const arenas = await getArenasPromise({ tournament_id: tournamentId });
        const arena = arenas[0] ?? null;
        if (!arena) return { notFound: true as const };
        const players = await getArenaPlayersPromise(arena.id);
        return { notFound: false as const, arena, players };
    }, [tournamentId]);

    const arena = data?.notFound ? null : data?.arena ?? null;
    const players = useMemo(() => (data?.notFound ? [] : data?.players ?? []), [data]);

    if (loading) {
        return (
            <div className="space-y-2">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-48 w-full rounded-xl" />
            </div>
        );
    }
    if (error) {
        return (
            <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Не удалось загрузить рейтинг.</p>
                <button type="button" className="text-sm underline" onClick={invalidate}>Повторить</button>
            </div>
        );
    }
    if (!arena) {
        return <p className="text-sm text-muted-foreground">Арена появится после жеребьёвки.</p>;
    }

    return (
        <div className="space-y-4">
            <p className="text-sm">
                Рейтинг и медали считает арена турнира —{" "}
                <Link href={`/arenas/view?id=${arena.id}`} className="underline">{arena.name}</Link>
            </p>
            <div className="flex gap-2 items-center">
                <button
                    type="button"
                    onClick={() => setPeriod("day_ago")}
                    className={`px-3 py-1 rounded text-sm whitespace-nowrap ${period === "day_ago" ? "font-medium" : "text-blue-600 underline decoration-dashed"}`}
                >
                    за день
                </button>
                <button
                    type="button"
                    onClick={() => setPeriod("week_ago")}
                    className={`px-3 py-1 rounded text-sm whitespace-nowrap ${period === "week_ago" ? "font-medium" : "text-blue-600 underline decoration-dashed"}`}
                >
                    за неделю
                </button>
            </div>
            <ArenaPlayersGroups players={players} arena={arena} ranks={undefined} period={period} />
            <ArenaMedalsTab players={players} loading={false} />
        </div>
    );
}
