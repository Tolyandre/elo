"use client";

import React, { Suspense, useMemo } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { usePlayers } from "./PlayersContext";
import { useClubs } from "@/app/clubsContext";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { Player, Club, Period } from "../api";
import { useMe } from "@/app/meContext";
import { useSettings } from "@/app/settingsContext";
import { winsNeededForAmateur } from "@/app/eloCalculation";
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

function computeRanks(players: Player[], period: "now" | Period): Map<string, number> {
    const leaguePrio = (l: string) => l === "elite" ? 0 : l === "amateur" ? 1 : 2;
    type Snap = { rating: number; league: string };
    const snap = (p: Player): Snap | null => {
        const r = period === "now" ? p.rank.now : (p.rank[period] ?? null);
        return r ? { rating: r.rating, league: r.league } : null;
    };

    const entries = players.flatMap(p => { const s = snap(p); return s ? [{ id: p.id, ...s }] : []; });
    entries.sort((a, b) => {
        const ld = leaguePrio(a.league) - leaguePrio(b.league);
        return ld !== 0 ? ld : b.rating - a.rating;
    });

    const map = new Map<string, number>();
    let counter = 0;
    let prevRounded: number | null = null;
    let prevLeague: string | null = null;
    let prevRank = 0;
    for (const e of entries) {
        const rounded = Math.round(e.rating);
        if (prevRounded === rounded && prevLeague === e.league) {
            map.set(e.id, prevRank);
        } else {
            prevRank = counter + 1;
            map.set(e.id, prevRank);
            prevRounded = rounded;
            prevLeague = e.league;
        }
        counter++;
    }
    return map;
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
    const { newbieLeagueGoalGap, eliteMatches6m, eliteMatches2m,
            startingRatingGlobalArena, startingElo,
            eloConstK, eloConstD, newbieLeagueEarnedMax, newbieLeagueEarnedTau } = useSettings();

    const [typicalWinsLower, typicalWinsUpper] = winsNeededForAmateur(
        startingElo - startingRatingGlobalArena,
        newbieLeagueGoalGap, eloConstK, newbieLeagueEarnedMax, newbieLeagueEarnedTau, eloConstD
    );
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
        router.replace(id !== null ? `${pathname}?club=${id}` : pathname, { scroll: false });
    }

    const filtered = useMemo(
        () => filterByClub(players, selectedClubId, clubs),
        [players, selectedClubId, clubs]
    );

    const byRating = (a: Player, b: Player) => b.rank.now.rating - a.rank.now.rating;

    const elitePlayers = useMemo<Player[]>(() =>
        filtered.filter(p => p.rank.now.league === "elite").sort(byRating), [filtered]);
    const amateurPlayers = useMemo<Player[]>(() =>
        filtered.filter(p => p.rank.now.league === "amateur").sort(byRating), [filtered]);
    const newbiePlayers = useMemo<Player[]>(() =>
        filtered.filter(p => p.rank.now.league === "newbie").sort(byRating), [filtered]);

    const isClubFiltered = selectedClubId !== null && selectedClubId !== NO_CLUB_ID;
    const clubRanksNow  = useMemo(() => isClubFiltered ? computeRanks(filtered, "now")    : null, [isClubFiltered, filtered]);
    const clubRanksPrev = useMemo(() => isClubFiltered ? computeRanks(filtered, period)   : null, [isClubFiltered, filtered, period]);

    const hasAny = elitePlayers.length + amateurPlayers.length + newbiePlayers.length > 0;

    function PlayerRow({ player }: { player: Player }) {
        const prev = player.rank[period] ?? player.rank.day_ago;
        const matchesLeftForElite = player.rank.now.matches_left_for_elite;
        const winsLower = player.rank.now.wins_needed_for_amateur;
        const winsUpper = player.rank.now.wins_needed_for_amateur_upper;
        const displayRank  = isClubFiltered ? (clubRanksNow?.get(player.id)  ?? null) : (player.rank.now.rank ?? null);
        const previousRank = isClubFiltered ? (clubRanksPrev?.get(player.id) ?? null) : (prev.rank ?? null);
        return (
            <tr key={player.id}>
                <td className="py-2 text-center align-top min-w-7">
                    <RankIcon rank={displayRank} />
                </td>
                <td className="py-2 text-center align-top min-w-7">
                    <RankChangeIndicator currentRank={displayRank} previousRank={previousRank} />
                </td>
                <td className="py-2 px-1 w-50">
                    <Link href={`/player?id=${player.id}`} className={`hover:underline${player.id === myPlayerId ? " bg-blue-100 dark:bg-blue-900/40 rounded px-1" : ""}`}>{playerDisplayName(player)}</Link>
                    {matchesLeftForElite != null && matchesLeftForElite > 0 && (
                        <span className="text-xs text-muted-foreground ml-1">ещё {matchesLeftForElite} партий</span>
                    )}
                    {winsLower != null && winsLower > 0 && (
                        <span className="text-xs text-muted-foreground ml-1">
                            ещё ~{winsLower}{winsUpper != null && winsUpper > winsLower ? `–${winsUpper}` : ""} побед
                        </span>
                    )}
                </td>
                <td className="py-2 px-1 align-top min-w-25">
                    <EloValueAndDiff currentElo={player.rank.now.rating} previousElo={prev.rating} />
                </td>
            </tr>
        );
    }

    function LeagueSection({ title, footer, players }: { title: string; footer?: string; players: Player[] }) {
        return (
            <>
                <h2 className="text-xl font-semibold mb-2 mt-4">{title}</h2>
                {players.length === 0
                    ? <p className="text-sm text-muted-foreground mb-2">Нет игроков</p>
                    : <table className="table-auto border-collapse mb-2">
                        <tbody>
                            {players.map(p => <PlayerRow key={p.id} player={p} />)}
                        </tbody>
                    </table>
                }
                {footer && <p className="text-xs text-muted-foreground mb-2">{footer}</p>}
            </>
        );
    }

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

            {!hasAny && selectedClubId !== null && (
                <p className="text-muted-foreground mb-4">
                    Нет игроков.{" "}
                    <button type="button" className="text-blue-600 underline decoration-dashed" onClick={() => setSelectedClubId(null)}>
                        Показать все клубы
                    </button>
                </p>
            )}

            <LeagueSection
                title="Высшая лига"
                footer={eliteMatches6m > 0 ? `Для Высшей Лиги нужно ${eliteMatches6m} партий за последние 6 месяцев, среди них ${eliteMatches2m} за последние 2 месяца` : undefined}
                players={elitePlayers}
            />
            <LeagueSection
                title="Любители"
                footer={`Для Лиги Любителей нужно совпадение рейтинга с эло (эло − рейтинг ≤ ${newbieLeagueGoalGap}), примерно ${typicalWinsLower}–${typicalWinsUpper} побед`}
                players={amateurPlayers}
            />
            <LeagueSection title="Новички" players={newbiePlayers} />
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
