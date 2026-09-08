"use client"
import React, { useState } from "react";
import {
    getMatchByIdPromise,
    Market,
    Match,
    WinStreakParams,
} from "@/app/api";
import type { Base58ID } from "@/lib/id";
import { MatchCard } from "@/components/match-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import {
    computeStreakProgress,
    fetchStreakMatches,
    formatRemainingTime,
    streakWindowEnd,
} from "@/app/markets/progress";

function CardsSkeleton() {
    return (
        <>
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
        </>
    );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <p className="text-sm text-muted-foreground font-medium tracking-wide">{children}</p>
    );
}

/** The match that resolved a match_winner market, rendered like a /matches card. */
function ResolvedMatch({ matchId, roundToInteger }: { matchId: Base58ID; roundToInteger: boolean }) {
    const { data: match, loading } = useAsyncResource(() => getMatchByIdPromise(matchId), [matchId]);
    return (
        <div className="space-y-3">
            <SectionTitle>Партия, разрешившая рынок:</SectionTitle>
            {loading && <CardsSkeleton />}
            {match && <MatchCard match={match} roundToInteger={roundToInteger} clickable />}
        </div>
    );
}

/**
 * Win-streak section: the live streak progress (wins / losses / time left)
 * followed by every match that counts for the market, as /matches cards.
 */
function WinStreakSection({ market, roundToInteger }: { market: Market; roundToInteger: boolean }) {
    const params = market.params as WinStreakParams | null;
    const start = market.starts_at ? new Date(market.starts_at) : null;
    const end = streakWindowEnd(market);

    // Progress changes only when new (or edited) matches land in the window —
    // refetch when the market's lifecycle moves (a match resolving the market
    // flips status/resolution_match_id).
    const { data: matches, loading } = useAsyncResource(
        () => (params && start ? fetchStreakMatches(params, start, end) : Promise.resolve([] as Match[])),
        [market.id, market.status, market.resolution_match_id],
    );

    // Minute-level ticker so "осталось 5 дней, 20 часов" counts down while the page sits open.
    const [now, setNow] = useState(() => new Date());
    React.useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 60_000);
        return () => clearInterval(timer);
    }, []);

    if (!params || !start) return null;

    const progress = matches ? computeStreakProgress(matches, params.target_player_id) : null;
    const remaining = market.closes_at ? formatRemainingTime(new Date(market.closes_at), now) : null;
    return (
        <div className="space-y-3">
            {progress && (
                <div className="text-sm space-y-1.5 p-3 rounded-lg bg-muted/50">
                    <p className="text-sm text-muted-foreground font-medium tracking-wide mb-2">Прогресс серии:</p>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Победы</span>
                        <span className="font-medium">
                            {progress.wins} из {params.wins_required}
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Поражения</span>
                        <span className="font-medium">
                            {progress.losses}
                            {params.max_losses != null && <> из {params.max_losses}</>}
                        </span>
                    </div>
                    {remaining && (
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Осталось</span>
                            <span className="font-medium">{remaining}</span>
                        </div>
                    )}
                </div>
            )}
            <SectionTitle>Партии, влияющие на рынок:</SectionTitle>
            {loading && <CardsSkeleton />}
            {!loading && matches && matches.length === 0 && (
                <p className="text-sm text-muted-foreground">Пока нет связанных партий</p>
            )}
            {matches && matches.length > 0 && (
                <div className="space-y-3">
                    {matches.map((m) => (
                        <MatchCard key={m.id} match={m} roundToInteger={roundToInteger} clickable />
                    ))}
                </div>
            )}
        </div>
    );
}

/**
 * The bottom section of the market view page: the relevant global-arena
 * matches as plain /matches cards (without their related markets). For a
 * match_winner market that is the single resolving match; for a win_streak
 * market it is every match counting toward the streak, headed by the progress.
 */
export function MarketRelatedMatches({ market, roundToInteger = false }: { market: Market; roundToInteger?: boolean }) {
    if (market.market_type === "win_streak") {
        return <WinStreakSection market={market} roundToInteger={roundToInteger} />;
    }
    if (market.resolution_match_id) {
        return <ResolvedMatch matchId={market.resolution_match_id} roundToInteger={roundToInteger} />;
    }
    return null;
}
