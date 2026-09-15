"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toBase58ID } from "@/lib/id";
import { PageHeader } from "@/app/pageHeaderContext";
import { getTournamentPromise, getTournamentStatsPromise, getArenasPromise, getArenaPlayersPromise } from "@/app/api";
import { usePlayers } from "@/app/players/PlayersContext";
import { useMe } from "@/app/meContext";
import { RankIcon } from "@/components/rank-icon";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { BackButton } from "@/components/back-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy } from "lucide-react";
import type { Base58ID } from "@/lib/id";

function TournamentContent() {
    const searchParams = useSearchParams();
    const id = toBase58ID(searchParams.get("id") ?? "");
    const { canEdit } = useMe();
    const { playerMap, playerDisplayName } = usePlayers();

    const { data, loading } = useAsyncResource(async () => {
        if (!id) throw new Error("no id");
        const [t, s, arenas] = await Promise.all([
            getTournamentPromise(id),
            getTournamentStatsPromise(id),
            getArenasPromise({ tournament_id: id }),
        ]);
        return { tournament: t, stats: s, arena: arenas[0] ?? null };
    }, [id]);

    const tournament = data?.tournament ?? null;
    const stats = data?.stats ?? null;
    const arena = data?.arena ?? null;

    if (!id) return <p>Не указан ID турнира.</p>;
    if (loading) return <p>Загрузка...</p>;
    if (!tournament) return <p>Турнир не найден.</p>;

    const players = stats?.players ?? [];

    return (
        <>
            <BackButton href="/tournaments" label="Назад к турнирам" />
            <PageHeader
                title={tournament.name}
                action={canEdit ? (
                    <Link href={`/tournaments/edit?id=${tournament.id}`} className="text-sm text-blue-600">Редактировать</Link>
                ) : undefined}
            />

            {players.length === 0 ? (
                <p className="text-muted-foreground">Нет участников</p>
            ) : (
                <table className="table-auto border-collapse w-full text-sm">
                    <thead>
                        <tr className="text-muted-foreground">
                            <th className="text-left py-2 pr-2 font-medium">Игрок</th>
                            <th className="py-2 px-1"><div className="flex justify-center"><RankIcon rank={1} /></div></th>
                            <th className="py-2 px-1"><div className="flex justify-center"><RankIcon rank={2} /></div></th>
                            <th className="py-2 px-1"><div className="flex justify-center"><RankIcon rank={3} /></div></th>
                            <th className="py-2 px-1"><div className="flex justify-center"><RankIcon rank={4} /></div></th>
                            <th className="py-2 pl-1 text-center font-medium">Партии</th>
                        </tr>
                    </thead>
                    <tbody>
                        {players.map((p) => {
                            const player = playerMap.get(p.player_id);
                            const name = player ? playerDisplayName(player) : "Unknown";
                            return (
                                <tr key={p.player_id} className="border-t">
                                    <td className="py-2 pr-2">
                                        <Link href={`/players/view?id=${p.player_id}`} className="hover:underline">{name}</Link>
                                    </td>
                                    <td className="py-2 px-1 text-center tabular-nums">{p.first || ""}</td>
                                    <td className="py-2 px-1 text-center tabular-nums">{p.second || ""}</td>
                                    <td className="py-2 px-1 text-center tabular-nums">{p.third || ""}</td>
                                    <td className="py-2 px-1 text-center tabular-nums">{p.fourth || ""}</td>
                                    <td className="py-2 pl-1 text-center tabular-nums">{p.matches_count}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}

            {/* The tournament's own arena (ADR-24): rating over the attached matches. */}
            {arena && (
                <div className="pt-4 space-y-2">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Trophy className="h-5 w-5 text-muted-foreground" />
                        <Link href={`/arenas/view?id=${arena.id}`} className="hover:underline">
                            {arena.name}
                        </Link>
                    </h2>
                    <ArenaRating arenaId={arena.id} />
                </div>
            )}
        </>
    );
}

/** Compact arena players table for the tournament page (top of the arena ranking). */
function ArenaRating({ arenaId }: { arenaId: Base58ID | null }) {
    const { data: players, loading, error } = useAsyncResource(
        () => (arenaId ? getArenaPlayersPromise(arenaId) : Promise.resolve([])),
        [arenaId],
    );
    if (error) return null;
    if (loading) return <Skeleton className="h-24 w-full rounded-xl" />;
    if (!players || players.length === 0) {
        return <p className="text-sm text-muted-foreground">Рейтинг арены появится после пересчёта партий.</p>;
    }
    return (
        <table className="table-auto border-collapse w-full text-sm">
            <tbody>
                {players.slice(0, 10).map((p) => (
                    <tr key={p.player_id}>
                        <td className="px-1 py-1.5">
                            {p.rank != null ? <RankIcon rank={p.rank} /> : null}
                        </td>
                        <td className="px-4 py-1.5">{p.name}</td>
                        <td className="px-1 py-1.5 tabular-nums text-right">{p.rating.toFixed(0)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export default function TournamentPage() {
    return (
        <main className="max-w-md mx-auto space-y-6">
            <Suspense fallback={<p>Загрузка...</p>}>
                <TournamentContent />
            </Suspense>
        </main>
    );
}
