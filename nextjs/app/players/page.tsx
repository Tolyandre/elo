"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { usePlayers } from "./PlayersContext";
import { useClubs } from "@/app/clubsContext";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { Player, Club, Period } from "../api";
import { ClubMultiSelect } from "@/components/club-multi-select";
import { RankIcon } from "@/components/rank-icon";
import { NO_CLUB_ID } from "@/lib/player-groups";

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

function filterByClubs(players: Player[], selectedClubIds: string[] | null, clubs: Club[]): Player[] {
    if (selectedClubIds === null) return players;
    if (selectedClubIds.length === 0) return [];

    const included = new Set<string>();
    const allClubPlayerIds = new Set(clubs.flatMap(c => c.players.map(String)));

    for (const id of selectedClubIds) {
        if (id === NO_CLUB_ID) {
            players.filter(p => !allClubPlayerIds.has(p.id)).forEach(p => included.add(p.id));
        } else {
            clubs.find(c => c.id === id)?.players.forEach(pid => included.add(String(pid)));
        }
    }

    return players.filter(p => included.has(p.id));
}

function PlayersTable() {
    const { players, loading, error } = usePlayers();
    const { clubs } = useClubs();
    const [period, setPeriod] = useLocalStorage<Period>("players-period", "day_ago");
    const [selectedClubIds, setSelectedClubIds] = useLocalStorage<string[] | null>("players-club-filter", null);

    const filtered = useMemo(
        () => filterByClubs(players, selectedClubIds, clubs),
        [players, selectedClubIds, clubs]
    );

    const rankedPlayers = useMemo<Player[]>(() => filtered
        .filter(p => p.rank.now.rank !== null)
        .sort((a, b) => b.rank.now.elo - a.rank.now.elo),
        [filtered]);

    const unRankedPlayers = useMemo<Player[]>(() => filtered
        .filter(p => p.rank.now.rank === null)
        .sort((a, b) => a.rank.now.matches_left_for_ranked - b.rank.now.matches_left_for_ranked),
        [filtered]);

    if (loading || error) return null;
    return (
        <>
            <div className="mb-4">
                <ClubMultiSelect value={selectedClubIds} onChange={setSelectedClubIds} />
            </div>

            <div className="flex gap-2 items-center mb-3">
                <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); setPeriod("day_ago"); }}
                    className={`px-3 py-1 rounded ${period === "day_ago" ? "" : "text-blue-600 underline decoration-dashed"}`}
                >
                    за день
                </a>
                <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); setPeriod("week_ago"); }}
                    className={`px-3 py-1 rounded ${period === "week_ago" ? "" : "text-blue-600 underline decoration-dashed"}`}
                >
                    за неделю
                </a>
            </div>

            {rankedPlayers.length === 0 && unRankedPlayers.length === 0 && selectedClubIds !== null && (
                <p className="text-muted-foreground mb-4">
                    Нет игроков.{" "}
                    <a href="#" className="text-blue-600 underline decoration-dashed" onClick={(e) => { e.preventDefault(); setSelectedClubIds(null); }}>
                        Показать все клубы
                    </a>
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
                                    <td className="py-2 px-1 w-50">{player.name}</td>
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
                                        <td className="py-2 px-1 w-50">{player.name}
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
        <main>
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-semibold mb-4 mx-auto">Игроки</h1>
            </div>
            <LoadingOrError />
            <PlayersTable />
            <Link
                href="/add-match"
                className="inline-block bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-center w-full"
            >
                Добавить партию
            </Link>
        </main>
    );
}
