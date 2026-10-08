"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Tent } from "lucide-react";
import { toBase58ID, type Base58ID } from "@/lib/id";
import { useUrlQuery, setUrlQuery } from "@/lib/url-state";
import { NO_CLUB_ID } from "@/lib/player-groups";
import { subscribeDataChange } from "@/lib/live-data";
import { PageHeader } from "@/app/pageHeaderContext";
import { Match, getArenaPlayersPromise, getArenaSafePromise } from "@/app/api";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { BackButton } from "@/components/back-button";
import { ErrorAlert } from "@/components/error-alert";
import { PageContainer } from "@/components/page-container";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ArenaPlayersGroups, type ArenaRankPeriod } from "@/components/arena-players-table";
import { ScoreLeadersTab } from "@/components/score-leaders-tab";
import { ClubSelect } from "@/components/club-select";
import { usePlayers } from "@/app/players/PlayersContext";
import { useClubs } from "@/app/clubsContext";
import { useMe } from "@/app/meContext";
import { useTenantScope } from "@/app/tenantScopeContext";
import { ArenaMedalsTab } from "./arena-medals-tab";
import { ArenaFeedTab } from "./arena-feed-tab";
import { useArenaFeed, type ArenaMatchFilters } from "./use-arena-feed";
import { Edit2 } from "lucide-react";

// Ids travel in the query (?id=<ARENA_ID>) on both routes that render this
// component: a path segment per id cannot be statically exported. Without an
// id the page renders the current tenant's main arena (ADR-36).
const ARENA_TABS_PLAYERS_MATCHES = ["players", "feed", "medals", "leaders"] as const;
const ARENA_TABS_NO_LEADERS = ["players", "feed", "medals"] as const;

const LEADER_TAB_LABEL = "Очки победителей";

function parseTab(value: string | null, hasLeaders: boolean): string {
  const tabs = hasLeaders ? ARENA_TABS_PLAYERS_MATCHES : ARENA_TABS_NO_LEADERS;
  return (tabs as readonly string[]).includes(value ?? "") ? (value as string) : "players";
}

/**
 * The arena view (players / feed / medals / leaders tabs), rendered by both
 * `/` (the main page) and `/arenas/view?id=…`. All view state — the arena id,
 * the active tab, the match filters — lives in the query string via
 * useUrlQuery: shareable, refresh-stable, and restored by Back/Forward
 * (ADR-25). On the main page the rendered arena is the current tenant's main
 * arena (ADR-36) and the feed tab is the tenant's community feed; while no
 * tenant has resolved yet the view waits (the scope shows its prompt).
 */
export function ArenaView() {
  const params = useUrlQuery();
  const { tenant, ready } = useTenantScope();
  const explicitId = toBase58ID(params.get("id") ?? "");
  const baseId = explicitId ?? tenant?.main_arena_id ?? null;
  const effectiveId = explicitId ?? baseId;

  const { data, loading, error, invalidate } = useAsyncResource(async () => {
    if (effectiveId == null) {
      return null;
    }
    const arena = await getArenaSafePromise(effectiveId);
    if (arena == null) {
      return { notFound: true as const };
    }
    const players = await getArenaPlayersPromise(arena.id);
    return { notFound: false as const, arena, players };
  }, [effectiveId]);

  // Live refresh (ADR-36 phase 6): data-change signals — a queued arena
  // recalculation, matches or players recorded elsewhere — refetch the arena
  // (the stale mark drives the spinner) and the standings.
  useEffect(() => {
    return subscribeDataChange((batch) => {
      if (batch.arenas || batch.matches || batch.players) invalidate();
    });
  }, [invalidate]);

  const notFound = data?.notFound === true;
  const arena = notFound ? null : data?.arena ?? null;
  const players = useMemo(() => (notFound ? [] : data?.players ?? []), [data, notFound]);
  const recalculating = arena?.stale_at != null;
  // The id-less view without a resolved tenant: the scope shows its chooser
  // dialog; if it was dismissed, say what's missing instead of spinning.
  const needsTenant = effectiveId == null && ready && tenant == null;

  // Match filters, derived from the URL so Back/Forward restore them. Written
  // with "replace" in handleFiltersChange: each refinement overwrites the
  // current history entry instead of stacking one.
  const filters: ArenaMatchFilters = useMemo(
    () => ({
      playerId: toBase58ID(params.get("player") ?? "") ?? undefined,
      clubId: toBase58ID(params.get("club") ?? "") ?? undefined,
      gameId: toBase58ID(params.get("game") ?? "") ?? undefined,
    }),
    [params],
  );

  // The feed tab. The tenant-mode main page renders the tenant's community
  // feed (membership-scoped, ADR-36); an explicit arena loads that arena's
  // own feed.
  const tenantFeed = explicitId == null && tenant != null;
  const feed = useArenaFeed(
    { arenaId: effectiveId, tenantId: tenantFeed ? tenant.id : null },
    filters,
  );

  // Players tab: period for the change indicators, club filter. The filter
  // only narrows the list — ranks stay the server-computed global ones, and
  // the change indicators keep comparing global rank to global history.
  const [period, setPeriod] = useLocalStorage<ArenaRankPeriod>("arena-players-period", "day_ago");
  const [clubId, setClubId] = useState<Base58ID | null>(null);
  const { clubs } = useClubs();
  const displayedPlayers = useMemo(() => {
    if (clubId == null) return players;
    if (clubId === NO_CLUB_ID) {
      const allClubPlayerIds = new Set(clubs.flatMap((c) => c.player_ids));
      return players.filter((p) => !allClubPlayerIds.has(p.player_id));
    }
    const clubPlayerIds = new Set(clubs.find((c) => c.id === clubId)?.player_ids ?? []);
    return players.filter((p) => clubPlayerIds.has(p.player_id));
  }, [players, clubId, clubs]);

  // The leaders tab (score winners) only makes sense for a single-game arena.
  const singleGameId =
    arena?.game_id ?? (arena && arena.filter?.game_ids.length === 1 ? arena.filter.game_ids[0] : null);
  const hasLeaders = singleGameId != null;

  // The edit form is for user-created arenas only: auto-managed ones are
  // system-owned (the API rejects edits) — a tenant main arena (ADR-36)
  // included.
  const { canEdit } = useMe();
  const canEditArena =
    canEdit && arena != null && arena.tenant_id == null && arena.game_id == null && arena.tournament_id == null;

  // The active tab is a URL parameter ("push": Back/Forward walk through
  // tabs). A value the current arena does not offer — e.g. a carried-over
  // ?tab=leaders on a multi-game arena — falls back to "Игроки".
  const tab = parseTab(params.get("tab"), hasLeaders);

  function handleFiltersChange(next: ArenaMatchFilters) {
    setUrlQuery((params) => {
      if (next.playerId) params.set("player", next.playerId);
      else params.delete("player");
      if (next.clubId) params.set("club", next.clubId);
      else params.delete("club");
      if (next.gameId) params.set("game", next.gameId);
      else params.delete("game");
    });
  }

  function setTab(value: string) {
    setUrlQuery((params) => params.set("tab", value), "push");
    if (value === "leaders" && feed.hasMore) {
      void feed.loadAll();
    }
  }

  // The game filter passed to the offline queue: an explicit filter wins,
  // otherwise a single-game arena implies its game.
  const pendingGameId = filters.gameId ?? singleGameId ?? undefined;

  return (
    <PageContainer width="narrow">
      {explicitId != null && <BackButton href="/arenas" />}
      <div className="space-y-4">
        <PageHeader
          title={arena?.name ?? tenant?.name ?? "Сообщество"}
          icon={arena?.camp ? <Tent className="h-6 w-6 shrink-0" /> : undefined}
          action={
            <div className="flex items-center gap-2">
              {canEditArena && (
                <Button asChild size="sm" variant="outline" aria-label="Редактировать арену">
                  <Link href={`/arenas/edit?id=${arena.id}`}>
                    <Edit2 className="h-4 w-4" />
                  </Link>
                </Button>
              )}
              <Button asChild size="sm">
                {/* The creation hub creates under the tenant in its URL (ADR-36). */}
                <Link href={tenant ? `/new?tenant=${tenant.id}` : "/new"}>Добавить</Link>
              </Button>
            </div>
          }
        />
        {recalculating && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-info" />
            Арена пересчитывается — рейтинг скоро обновится.
          </p>
        )}

        {error && <ErrorAlert message={error} />}
        {needsTenant && (
          <p className="text-muted-foreground">
            Выберите сообщество — его главная арена откроется на этой странице.
          </p>
        )}
        {loading && !needsTenant && (
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        )}

        {notFound && !loading && (
          <div className="space-y-3">
            <p className="text-muted-foreground">
              Арена не найдена — возможно, она была удалена.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" size="sm" onClick={invalidate}>
                Повторить
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/arenas">Все арены</Link>
              </Button>
            </div>
          </div>
        )}

        {arena && (
          <Tabs value={tab} onValueChange={setTab}>
            {hasLeaders ? (
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="players" className="px-1 text-xs">Игроки</TabsTrigger>
                <TabsTrigger value="feed" className="px-1 text-xs">Лента</TabsTrigger>
                <TabsTrigger value="medals" className="px-1 text-xs">Медали</TabsTrigger>
                <TabsTrigger value="leaders" className="px-1 text-xs">{LEADER_TAB_LABEL}</TabsTrigger>
              </TabsList>
            ) : (
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="players" className="px-1 text-xs">Игроки</TabsTrigger>
                <TabsTrigger value="feed" className="px-1 text-xs">Лента</TabsTrigger>
                <TabsTrigger value="medals" className="px-1 text-xs">Медали</TabsTrigger>
              </TabsList>
            )}

            <TabsContent value="players" className="space-y-4">
              <ClubSelect value={clubId} onChange={setClubId} />
              <div className="flex gap-2 items-center">
                <button
                  type="button"
                  onClick={() => setPeriod("day_ago")}
                  className={`px-3 py-1 rounded text-sm whitespace-nowrap ${period === "day_ago" ? "font-medium" : "text-info underline decoration-dashed"}`}
                >
                  за день
                </button>
                <button
                  type="button"
                  onClick={() => setPeriod("week_ago")}
                  className={`px-3 py-1 rounded text-sm whitespace-nowrap ${period === "week_ago" ? "font-medium" : "text-info underline decoration-dashed"}`}
                >
                  за неделю
                </button>
              </div>
              <ArenaPlayersGroups
                players={displayedPlayers}
                arena={arena}
                period={period}
              />
            </TabsContent>

            <TabsContent value="feed" className="space-y-2">
              <ArenaFeedTab
                arena={arena}
                events={feed.events}
                loading={feed.loading}
                loadingMore={feed.loadingMore}
                hasMore={feed.hasMore}
                filters={filters}
                onFiltersChange={handleFiltersChange}
                onLoadMore={feed.loadMore}
                isTenantFeed={tenantFeed}
                pendingGameId={pendingGameId}
              />
            </TabsContent>

            <TabsContent value="medals" className="space-y-4">
              <ArenaMedalsTab players={players} loading={loading} />
            </TabsContent>

            {hasLeaders && (
              <TabsContent value="leaders" className="space-y-4">
                <ArenaLeadersTab matches={feed.allMatches} loading={feed.loading} />
              </TabsContent>
            )}
          </Tabs>
        )}
      </div>
    </PageContainer>
  );
}

/**
 * Leaders tab over the accumulated arena matches: match scores are keyed by
 * player id, so names come from the shared players context.
 */
function ArenaLeadersTab({ matches, loading }: { matches: Match[]; loading: boolean }) {
  const { playerMap, playerDisplayName } = usePlayers();

  const mapped = matches.map((m) => ({
    players: Object.entries(m.score).map(([pid, s]) => {
      const player = playerMap.get(pid);
      return { name: player ? playerDisplayName(player) : pid, score: s.score };
    }),
  }));

  return <ScoreLeadersTab matches={mapped} loading={loading} />;
}
