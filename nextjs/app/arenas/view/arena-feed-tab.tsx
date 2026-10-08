"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import type { Base58ID } from "@/lib/id";
import { Arena } from "@/app/api";
import { MatchCard } from "@/components/match-card";
import { MarketCard } from "@/components/market-card";
import { PlayerCombobox } from "@/components/player-combobox";
import { GameCombobox } from "@/components/game-combobox";
import { ClubSelect } from "@/components/club-select";
import { PendingMatchCard } from "@/components/pending-match-card";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel, FieldContent, FieldGroup } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useMe } from "@/app/meContext";
import { useOffline } from "@/app/offline/OfflineContext";
import type { ArenaMatchFilters } from "./use-arena-feed";
import type { FeedEvent } from "@/app/api";

/**
 * The arena feed tab (ADR-32): the server-merged event stream — matches, and
 * for the global arena also market resolutions (they settle
 * only there). Each event kind renders as its own card. The game filter is
 * hidden when the arena's filter pins it to exactly one game. The
 * offline-sync queue rides on top of the global feed, like /matches did.
 * (Live tables moved to the main page, above the tabs.)
 */
export function ArenaFeedTab({
    arena,
    events,
    loading,
    loadingMore,
    hasMore,
    filters,
    onFiltersChange,
    onLoadMore,
    isGlobal,
    pendingGameId,
}: {
    arena: Arena;
    events: FeedEvent[];
    loading: boolean;
    loadingMore: boolean;
    hasMore: boolean;
    filters: ArenaMatchFilters;
    onFiltersChange: (filters: ArenaMatchFilters) => void;
    onLoadMore: () => void;
    isGlobal: boolean;
    pendingGameId?: Base58ID;
}) {
    const { roundToInteger } = useMe();
    const { pendingMatches } = useOffline();
    const sentinelRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const node = sentinelRef.current;
        if (!node) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting) && hasMore && !loadingMore) {
                    onLoadMore();
                }
            },
            { rootMargin: "200px" },
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [hasMore, loadingMore, onLoadMore]);

    // Hide the game select when the arena's match filter pins one game.
    const showGameFilter = (arena.filter?.game_ids.length ?? 0) !== 1;

    // Unsynced matches go on top of the global feed. A player filter hides
    // them (pending score keys may reference offline player ids).
    const visiblePending = useMemo(() => {
        if (!isGlobal || filters.playerId) return [];
        return pendingMatches
            .filter((m) => !pendingGameId || m.gameId === pendingGameId)
            .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
    }, [isGlobal, pendingMatches, pendingGameId, filters.playerId]);

    return (
        <div className="space-y-2">
            <Card>
                <CardContent>
                    <FieldGroup>
                        <Field>
                            <FieldLabel className="sr-only">Клуб</FieldLabel>
                            <FieldContent>
                                <ClubSelect
                                    value={filters.clubId ?? null}
                                    onChange={(id) => onFiltersChange({ ...filters, clubId: id ?? undefined })}
                                />
                            </FieldContent>
                        </Field>

                        <Field>
                            <FieldLabel className="sr-only">Игрок</FieldLabel>
                            <FieldContent>
                                <PlayerCombobox
                                    value={filters.playerId}
                                    onChange={(id) => onFiltersChange({ ...filters, playerId: id })}
                                />
                            </FieldContent>
                        </Field>

                        {showGameFilter && (
                            <Field>
                                <FieldLabel className="sr-only">Игра</FieldLabel>
                                <FieldContent>
                                    <GameCombobox
                                        value={filters.gameId}
                                        onChange={(id) => onFiltersChange({ ...filters, gameId: id })}
                                    />
                                </FieldContent>
                            </Field>
                        )}
                    </FieldGroup>
                </CardContent>
            </Card>

            {visiblePending.map((pm) => (
                <PendingMatchCard key={pm.clientId} match={pm} clickable />
            ))}

            {loading ? (
                <>
                    {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-28 w-full rounded-xl" />
                    ))}
                </>
            ) : events.length === 0 && visiblePending.length === 0 ? (
                <EmptyState title="Пока нет событий" />
            ) : (
                events.map((event) => {
                    switch (event.type) {
                        case "match":
                            return (
                                <MatchCard
                                    key={`m-${event.data.id}`}
                                    match={event.data}
                                    roundToInteger={roundToInteger}
                                    clickable
                                />
                            );
                        case "market":
                            return (
                                <Link
                                    key={`mk-${event.data.id}`}
                                    href={`/markets/view?id=${event.data.id}`}
                                    className="block"
                                >
                                    <MarketCard
                                        market={event.data}
                                        className="hover:bg-accent transition-colors cursor-pointer"
                                    />
                                </Link>
                            );
                    }
                })
            )}

            <div ref={sentinelRef} className="flex justify-center py-4">
                {loadingMore && <Spinner className="size-6" />}
            </div>
        </div>
    );
}
