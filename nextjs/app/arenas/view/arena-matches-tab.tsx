"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Base58ID } from "@/lib/id";
import { Arena } from "@/app/api";
import { MatchWithMarkets } from "@/components/match-with-markets";
import { CorrectionCard } from "@/components/correction-card";
import { PlayerCombobox } from "@/components/player-combobox";
import { GameCombobox } from "@/components/game-combobox";
import { ClubSelect } from "@/components/club-select";
import { PendingMatchCard } from "@/components/pending-match-card";
import { RunningTables } from "@/components/tables/running-tables";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel, FieldContent, FieldGroup } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useMe } from "@/app/meContext";
import { useOffline } from "@/app/offline/OfflineContext";
import type { ArenaMatchFilters, TimelineItem } from "./use-arena-matches";

/**
 * Arena match timeline (ADR-24): the same rendering as /matches — filter card,
 * matches with lazily loaded markets, correction cards (global arena only,
 * since corrections settle only there) — over the cursor-paginated arena
 * matches endpoint. The game filter is hidden when the arena's filter pins it
 * to exactly one game. The global arena's timeline also shows the live tables
 * and the offline-sync queue, like /matches did.
 */
export function ArenaMatchesTab({
    arena,
    items,
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
    items: TimelineItem[];
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
    const showGameFilter = arena.filter.game_ids.length !== 1;

    // Unsynced matches go on top of the global timeline. A player filter hides
    // them (pending score keys may reference offline player ids).
    const visiblePending = useMemo(() => {
        if (!isGlobal || filters.playerId) return [];
        return pendingMatches
            .filter((m) => !pendingGameId || m.gameId === pendingGameId)
            .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
    }, [isGlobal, pendingMatches, pendingGameId, filters.playerId]);

    return (
        <div className="space-y-2">
            {isGlobal && <RunningTables />}

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
            ) : items.length === 0 && visiblePending.length === 0 ? (
                <p className="text-sm text-muted-foreground">Нет партий</p>
            ) : (
                items.map((item) =>
                    item.type === "match" ? (
                        <MatchWithMarkets
                            key={`m-${item.data.id}`}
                            match={item.data}
                            roundToInteger={roundToInteger}
                        />
                    ) : (
                        <CorrectionCard key={`c-${item.data.id}`} correction={item.data} />
                    ),
                )
            )}

            <div ref={sentinelRef} className="flex justify-center py-4">
                {loadingMore && <Spinner className="size-6" />}
            </div>
        </div>
    );
}
