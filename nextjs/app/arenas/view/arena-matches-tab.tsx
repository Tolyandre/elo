"use client";

import { useEffect, useRef } from "react";
import { Arena } from "@/app/api";
import { MatchWithMarkets } from "@/components/match-with-markets";
import { CorrectionCard } from "@/components/correction-card";
import { PlayerCombobox } from "@/components/player-combobox";
import { GameCombobox } from "@/components/game-combobox";
import { ClubSelect } from "@/components/club-select";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel, FieldContent, FieldGroup } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useMe } from "@/app/meContext";
import type { ArenaMatchFilters, TimelineItem } from "./use-arena-matches";

/**
 * Arena match timeline (ADR-24): the same rendering as /matches — filter card,
 * matches with lazily loaded markets, correction cards (global arena only,
 * since corrections settle only there) — over the cursor-paginated arena
 * matches endpoint. The game filter is hidden when the arena's filter pins it
 * to exactly one game.
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
}: {
    arena: Arena;
    items: TimelineItem[];
    loading: boolean;
    loadingMore: boolean;
    hasMore: boolean;
    filters: ArenaMatchFilters;
    onFiltersChange: (filters: ArenaMatchFilters) => void;
    onLoadMore: () => void;
}) {
    const { roundToInteger } = useMe();
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

            {loading ? (
                <>
                    {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-28 w-full rounded-xl" />
                    ))}
                </>
            ) : items.length === 0 ? (
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
