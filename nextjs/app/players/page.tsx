"use client";

import React, { Suspense, useMemo } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { usePlayers } from "./PlayersContext";
import { useClubs } from "@/app/clubsContext";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { Player, Club, Period } from "../api";
import { useMe } from "@/app/meContext";
import { ClubSelect } from "@/components/club-select";
import { RankIcon } from "@/components/rank-icon";
import { NO_CLUB_ID } from "@/lib/player-groups";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/app/pageHeaderContext";

function LoadingOrError() {
    const { loading, error } = usePlayers();
    if (loading) return <div>Загрузка...</div>;
    if (error) return <div>Ошибка: {error}</div>;
    return null;
}

function RankChangeIndicator({ currentRank, previousRank }: { currentRank: number | null; previousRank?: number | null }) {
    if (currentRank == null) return null;

    if (previousRank == null) return (
        <span className="text-green-600 text-xs" aria-label={`New`}>
            <span>New!</span>
        </span>
    );

    const changed = previousRank !== currentRank;
    if (!changed) return null;

    const delta = previousRank - currentRank;
    const diff = Math.abs(delta);

    if (delta > 0) {
        return (
            <span className="text-green-600 text-xs" aria-label={`Rank up ${diff}`}>
                <span className="mr-1">▴</span>
                <span>{diff}</span>
            </span>
        );
    }

    return (
        <span className="text-red-600 text-xs" aria-label={`Rank down ${diff}`}>
            <span className="mr-1">▾</span>
            <span>{diff}</span>
        </span>
    );
}

function EloValueAndDiff({ currentElo, previousElo }: { currentElo: number; previousElo?: number | null }) {
    if (previousElo == null) {
        return <>{currentElo.toFixed(0)}</>;
    }

    const diff = currentElo - previousElo;
    if (diff === 0) return <>{currentElo.toFixed(0)}</>;

    return (
        <span className="line-clamp-1">
            {currentElo.toFixed(0)} <span className="text-sm text-gray-500">({diff > 0 ? "+" : ""}{diff.toFixed(1)})</span>
        </span>
    );
}

function filterByClub(players: Player[], selectedClubId: string | null, clubs: Club[]): Player[] {
    if (selectedClubId === null) return players;
    if (selectedClubId === NO_CLUB_ID) {
        const allClubPlayerIds = new Set(clubs.flatMap(c => c.players.map(String)));
        return players.filter(p => !allClubPlayerIds.has(p.id));
    }
    const clubPlayerIds = new Set(clubs.find(c => c.id === selectedClubId)?.players.map(String) ?? []);
    return players.filter(p => clubPlayerIds.has(p.id));
}

function PlayersTable() {
    const { players, playerDisplayName, loading, error } = usePlayers();
    const { clubs } = useClubs();
    const { playerId: myPlayerId, selectedClubId, setSelectedClubId } = useMe();
    const [period, setPeriod] = useLocalStorage<Period>("players-period", "day_ago");
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    React.useEffect(() => {
        const clubParam = searchParams.get("club");
        if (clubParam !== null) {
            setSelectedClubId(clubParam === "" ? null : clubParam);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // only on mount

    function handleClubChange(id: string | null) {
        setSelectedClubId(id);
        const params = new URLSearchParams(Array.from(searchParams.entries()));
        if (id === null) {
            params.delete("club");
        } else {
            params.set("club", id);
        }
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }

    const filtered = useMemo(
        () => filterByClub(players, selectedClubId, clubs),
        [players, selectedClubId, clubs]
    );

    const rankedPlayers = useMemo<Player[]>(() => filtered
        .filter((p: Player) => p.rank.now.rank != null)
        .sort((a: Player, b: Player) => b.rank.now.elo - a.rank.now.elo),
        [filtered]);

    const unRankedPlayers = useMemo<Player[]>(() => filtered
        .filter((p: Player) => p.rank.now.rank == null)
        .sort((a: Player, b: Player) => a.rank.now.matches_left_for_ranked - b.rank.now.matches_left_for_ranked),
        [filtered]);

    if (loading || error) return null;
    return (
        <>
            <div className="mb-4">
                <ClubSelect value={selectedClubId} onChange={handleClubChange} />
            </div>

            <div className="flex gap-2 items-center mb-3">
                <button
                    type="button"
                    onClick={() => setPeriod("day_ago")}
                    className={`px-3 py-1 rounded ${period === "day_ago" ? "" : "text-blue-600 underline decoration-dashed"}`}
                >
                    за день
                </button>
                <button
                    type="button"
                    onClick={() => setPeriod("week_ago")}
                    className={`px-3 py-1 rounded ${period === "week_ago" ? "" : "text-blue-600 underline decoration-dashed"}`}
                >
                    за неделю
                </button>
            </div>

            {rankedPlayers.length === 0 && unRankedPlayers.length === 0 && selectedClubId !== null && (
                <p className="text-muted-foreground mb-4">
                    Нет игроков.{" "}
                    <button type="button" className="text-blue-600 underline decoration-dashed" onClick={() => setSelectedClubId(null)}>
                        Показать все клубы
                    </button>
                </p>
            )}

            {rankedPlayers.length > 0 && (
                <table className="table-auto border-collapse mb-6">
                    <tbody>
                        {rankedPlayers.map((player) => {
                            const prev = player.rank[period] ?? player.rank.day_ago;
                            return (
                                <tr key={player.id}>
                                    <td className="py-2 text-center align-top min-w-7">
                                        <RankIcon rank={player.rank.now.rank} />
                                    </td>
                                    <td className="py-2 text-center align-top min-w-7">
                                        <RankChangeIndicator
                                            currentRank={player.rank.now.rank}
                                            previousRank={prev.rank}
                                        />
                                    </td>
                                    <td className="py-2 px-1 w-50">
                                        <Link href={`/player?id=${player.id}`} className={`hover:underline${player.id === myPlayerId ? " bg-blue-100 dark:bg-blue-900/40 rounded px-1" : ""}`}>{playerDisplayName(player)}</Link>
                                    </td>
                                    <td className="py-2 px-1 align-top min-w-25">
                                        <EloValueAndDiff currentElo={player.rank.now.elo} previousElo={prev.elo} />
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}

            {unRankedPlayers.length > 0 && (
                <>
                    <div className="flex items-center justify-between">
                        <h2 className="text-2xl font-semibold mb-4 mx-auto">Недостаточно партий</h2>
                    </div>
                    <table className="table-auto border-collapse mb-6">
                        <tbody>
                            {unRankedPlayers.map((player) => {
                                const prev = player.rank[period] ?? player.rank.day_ago;
                                return (
                                    <tr key={player.id}>
                                        <td className="py-2 text-center align-top min-w-7">
                                            <RankIcon rank={player.rank.now.rank} />
                                        </td>
                                        <td className="py-2 text-center align-top min-w-7"></td>
                                        <td className="py-2 px-1 w-50">
                                            <Link href={`/player?id=${player.id}`} className={`hover:underline${player.id === myPlayerId ? " bg-blue-100 dark:bg-blue-900/40 rounded px-1" : ""}`}>{playerDisplayName(player)}</Link>
                                            <span className="text-xs text-muted-foreground ml-1">ещё {player.rank.now.matches_left_for_ranked}</span>
                                        </td>
                                        <td className="py-2 px-1 align-top min-w-25">
                                            <EloValueAndDiff currentElo={player.rank.now.elo} previousElo={prev.elo} />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </>
            )}
        </>
    );
}

export default function PlayersPage() {
    return (
        <main className="max-w-sm mx-auto space-y-6">
            <PageHeader
                title="Игроки"
                action={<Button asChild size="sm"><Link href="/add-match">Добавить партию</Link></Button>}
            />
            <LoadingOrError />
            <Suspense>
                <PlayersTable />
            </Suspense>
        </main>
    );
}
