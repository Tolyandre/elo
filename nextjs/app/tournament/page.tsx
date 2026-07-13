"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/app/pageHeaderContext";
import { Tournament, TournamentStats, getTournamentPromise, getTournamentStatsPromise } from "@/app/api";
import { usePlayers } from "@/app/players/PlayersContext";
import { useMe } from "@/app/meContext";
import { RankIcon } from "@/components/rank-icon";

function TournamentContent() {
    const searchParams = useSearchParams();
    const id = searchParams.get("id") ?? "";
    const { canEdit } = useMe();
    const { playerMap, playerDisplayName } = usePlayers();

    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [stats, setStats] = useState<TournamentStats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!id) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- loading indicator before async fetch
        setLoading(true);
        Promise.all([getTournamentPromise(id), getTournamentStatsPromise(id)])
            .then(([t, s]) => { setTournament(t); setStats(s); })
            .finally(() => setLoading(false));
    }, [id]);

    if (!id) return <p>Не указан ID турнира.</p>;
    if (loading) return <p>Загрузка...</p>;
    if (!tournament) return <p>Турнир не найден.</p>;

    const players = stats?.players ?? [];

    return (
        <>
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
                                        <Link href={`/player?id=${p.player_id}`} className="hover:underline">{name}</Link>
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
        </>
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
