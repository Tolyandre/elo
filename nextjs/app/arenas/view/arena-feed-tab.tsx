"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import type { Base58ID } from "@/lib/id";
import { Arena, type Match } from "@/app/api";
import { MatchCard } from "@/components/match-card";
import { MarketCard } from "@/components/market-card";
import { PlayerCombobox } from "@/components/player-combobox";
import { GameCombobox } from "@/components/game-combobox";
import { ClubSelect } from "@/components/club-select";
import { PendingMatchCard } from "@/components/pending-match-card";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel, FieldContent, FieldGroup } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useMe } from "@/app/meContext";
import { useOffline } from "@/app/offline/OfflineContext";
import { MatchEntity } from "@/lib/offline/match-entity";
import type { PendingOp } from "@/lib/offline/types";
import { useOpNameHelpers } from "@/hooks/useOpNameHelpers";
import type { ArenaMatchFilters } from "./use-arena-feed";
import type { FeedEvent } from "@/app/api";

/**
 * The arena feed tab (ADR-32): the server-merged event stream — matches, and
 * for the tenant community feed also its market resolutions (ADR-36). Each
 * event kind renders as its own card. The game filter is hidden when the
 * arena's filter pins it to exactly one game; the club filter is hidden on a
 * members-only tenant's main page (arena-view computes that); the markets
 * toggle — only markets and the matches that resolved them — exists only on
 * the tenant feed (the main page). The offline-sync queue rides on top of the
 * tenant feed, like /matches did. (Live tables moved to the main page, above
 * the tabs.)
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
    isTenantFeed,
    showClubFilter,
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
    isTenantFeed: boolean;
    showClubFilter: boolean;
    pendingGameId?: Base58ID;
}) {
    const { roundToInteger } = useMe();
    const { pendingMatches, ops } = useOffline();
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

    // Unsynced matches go on top of the tenant feed. A player filter hides
    // them (pending score keys may reference offline player ids), and so does
    // the market view — pending matches are plain matches.
    const visiblePending = useMemo(() => {
        if (!isTenantFeed || filters.playerId || filters.marketsOnly) return [];
        return pendingMatches
            .filter((m) => !pendingGameId || m.gameId === pendingGameId)
            .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
    }, [isTenantFeed, pendingMatches, pendingGameId, filters.playerId, filters.marketsOnly]);

    // Queued match edits by id (ADR-37): feed events render through the
    // entity overlay, so an offline edit is visible here the moment it is
    // made — the same display state the match view page and /offline show.
    const opsByMatchId = useMemo(() => {
        const map = new Map<Base58ID, PendingOp>();
        for (const op of ops ?? []) {
            if (op.kind === "match" && op.op === "update") map.set(op.entityId, op);
        }
        return map;
    }, [ops]);

    return (
        <div className="space-y-2">
            <Card>
                <CardContent>
                    <FieldGroup>
                        {showClubFilter && (
                            <Field>
                                <FieldLabel className="sr-only">Клуб</FieldLabel>
                                <FieldContent>
                                    <ClubSelect
                                        value={filters.clubId ?? null}
                                        onChange={(id) => onFiltersChange({ ...filters, clubId: id ?? undefined })}
                                    />
                                </FieldContent>
                            </Field>
                        )}

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

                        {isTenantFeed && (
                            <div className="flex items-center justify-between">
                                <Label htmlFor="feed-markets-view">Только рынки</Label>
                                <Switch
                                    id="feed-markets-view"
                                    checked={!!filters.marketsOnly}
                                    onCheckedChange={(v) => onFiltersChange({ ...filters, marketsOnly: v })}
                                />
                            </div>
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
                        case "match": {
                            const op = opsByMatchId.get(event.data.id);
                            return op ? (
                                <FeedMatchCard
                                    key={`m-${event.data.id}`}
                                    match={event.data}
                                    op={op}
                                    roundToInteger={roundToInteger}
                                />
                            ) : (
                                <MatchCard
                                    key={`m-${event.data.id}`}
                                    match={event.data}
                                    roundToInteger={roundToInteger}
                                    clickable
                                />
                            );
                        }
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

/**
 * A feed match event with a queued offline edit (ADR-37): the entity overlays
 * the op on the server read — the same display state the match view page and
 * the /offline queue show — plus the unsynced chip and the dashed border (no
 * rating values until the server re-settles). Its own component so the hooks
 * stay unconditional (plain events render the plain MatchCard).
 */
function FeedMatchCard({ match, op, roundToInteger }: { match: Match; op: PendingOp; roundToInteger: boolean }) {
    const helpers = useOpNameHelpers();
    const entity = useMemo(() => MatchEntity.resolve(match.id, { saved: match, op }), [match, op]);
    const view = useMemo(() => entity?.effective(helpers) ?? match, [entity, helpers, match]);
    return (
        <MatchCard
            match={view}
            pending
            syncStatus={op.status}
            syncError={op.error}
            roundToInteger={roundToInteger}
            clickable
        />
    );
}
