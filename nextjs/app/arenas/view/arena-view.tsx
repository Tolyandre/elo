"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { GLOBAL_ARENA_ID, toBase58ID, type Base58ID } from "@/lib/id";
import { useUrlQuery, setUrlQuery } from "@/lib/url-state";
import { NO_CLUB_ID } from "@/lib/player-groups";
import { PageHeader } from "@/app/pageHeaderContext";
import { Arena, Match, getArenaPlayersPromise, getArenaSafePromise, getArenasPromise } from "@/app/api";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { BackButton } from "@/components/back-button";
import { ErrorAlert } from "@/components/error-alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ArenaPlayersGroups, computeDisplayRanks, type ArenaRankPeriod } from "@/components/arena-players-table";
import { ScoreLeadersTab } from "@/components/score-leaders-tab";
import { ClubSelect } from "@/components/club-select";
import { usePlayers } from "@/app/players/PlayersContext";
import { useClubs } from "@/app/clubsContext";
import { useMe } from "@/app/meContext";
import { ArenaMedalsTab } from "./arena-medals-tab";
import { ArenaMatchesTab } from "./arena-matches-tab";
import { useArenaMatches, type ArenaMatchFilters } from "./use-arena-matches";
import { Edit2 } from "lucide-react";

// Ids travel in the query (?id=<ARENA_ID>) on both routes that render this
// component: a path segment per id cannot be statically exported. Without an
// id the page renders the global arena — the main page of the app (ADR-25).
const ARENA_TABS_PLAYERS_MATCHES = ["players", "matches", "medals", "leaders"] as const;
const ARENA_TABS_NO_LEADERS = ["players", "matches", "medals"] as const;

const LEADER_TAB_LABEL = "Очки победителей";

function parseTab(value: string | null, hasLeaders: boolean): string {
  const tabs = hasLeaders ? ARENA_TABS_PLAYERS_MATCHES : ARENA_TABS_NO_LEADERS;
  return (tabs as readonly string[]).includes(value ?? "") ? (value as string) : "players";
}

/**
 * The arena view (players / matches / medals / leaders tabs), rendered by both
 * `/` (the main page — the global arena) and `/arenas/view?id=…`. All view
 * state — the arena id, the active tab, the match filters — lives in the query
 * string via useUrlQuery: shareable, refresh-stable, and restored by
 * Back/Forward (ADR-25).
 */
export function ArenaView() {
  const params = useUrlQuery();
  const explicitId = toBase58ID(params.get("id") ?? "");
  const id = explicitId ?? GLOBAL_ARENA_ID;
  const isGlobal = id === GLOBAL_ARENA_ID;

  // A missing arena (stale id in the URL, or the global arena absent from a
  // not-yet-migrated database) must not brick the main page: when the id-less
  // global arena 404s, self-heal by resolving the unconditional arena from
  // the list. An explicitly requested arena that is gone renders a friendly
  // not-found state instead of an error.
  const [overrideId, setOverrideId] = useState<Base58ID | null>(null);
  const effectiveId = explicitId ?? overrideId ?? id;

  const { data, loading, error, invalidate } = useAsyncResource(async () => {
    let arena = await getArenaSafePromise(effectiveId);
    if (arena == null && explicitId == null) {
      const list = await getArenasPromise();
      arena = list.find(isUnconditional) ?? null;
      if (arena != null) setOverrideId(arena.id);
    }
    if (arena == null) {
      return { notFound: true as const };
    }
    const players = await getArenaPlayersPromise(arena.id);
    return { notFound: false as const, arena, players };
  }, [effectiveId, explicitId]);

  const notFound = data?.notFound === true;
  const arena = notFound ? null : data?.arena ?? null;
  const players = useMemo(() => (notFound ? [] : data?.players ?? []), [data, notFound]);

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

  // Corrections settle only into the global arena (ADR-24), so its timeline —
  // the arena whose filter admits every match — is the only one that merges
  // them in.
  const isGlobalArena = arena != null && isUnconditional(arena);
  const timeline = useArenaMatches(effectiveId, filters, isGlobalArena);

  // Players tab: period for the change indicators, club filter with
  // client-side rank recompute (same as the /players page had).
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
  const leagues = useMemo(() => {
    const settings = arena ? parseArenaLeagues(arena) : [];
    return settings;
  }, [arena]);
  const displayRanks = useMemo(
    () => computeDisplayRanks(displayedPlayers, leagues),
    [displayedPlayers, leagues],
  );

  // The leaders tab (score winners) only makes sense for a single-game arena.
  const singleGameId =
    arena?.game_id ?? (arena && arena.filter.game_ids.length === 1 ? arena.filter.game_ids[0] : null);
  const hasLeaders = singleGameId != null;

  // The edit form is for user-created arenas only: auto-managed ones are
  // system-owned (the API rejects edits), and the global arena — the main
  // page — is permanent.
  const { canEdit } = useMe();
  const canEditArena =
    canEdit && !isGlobal && arena != null && arena.game_id == null && arena.tournament_id == null;

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
    if (value === "leaders" && timeline.hasMore) {
      void timeline.loadAll();
    }
  }

  // The game filter passed to the offline queue: an explicit filter wins,
  // otherwise a single-game arena implies its game.
  const pendingGameId = filters.gameId ?? singleGameId ?? undefined;

  return (
    <main className="max-w-sm mx-auto">
      {!isGlobal && <BackButton href="/arenas" label="Назад к аренам" />}
      <div className="space-y-4">
        <PageHeader
          title={arena?.name ?? "Главная"}
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
                <Link href="/matches/new">Добавить партию</Link>
              </Button>
            </div>
          }
        />
        {arena?.stale_at && (
          <p className="text-xs text-muted-foreground">Арена обновляется, данные могут отставать.</p>
        )}

        {error && <ErrorAlert message={error} />}
        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        )}

        {notFound && !loading && (
          <div className="space-y-3">
            <p className="text-muted-foreground">
              {isGlobal
                ? "Главная арена пока не создана — база данных, похоже, ещё не обновлена. Она появится после применения миграций."
                : "Арена не найдена — возможно, она была удалена."}
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
                <TabsTrigger value="matches" className="px-1 text-xs">Партии</TabsTrigger>
                <TabsTrigger value="medals" className="px-1 text-xs">Медали</TabsTrigger>
                <TabsTrigger value="leaders" className="px-1 text-xs">{LEADER_TAB_LABEL}</TabsTrigger>
              </TabsList>
            ) : (
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="players" className="px-1 text-xs">Игроки</TabsTrigger>
                <TabsTrigger value="matches" className="px-1 text-xs">Партии</TabsTrigger>
                <TabsTrigger value="medals" className="px-1 text-xs">Медали</TabsTrigger>
              </TabsList>
            )}

            <TabsContent value="players" className="space-y-4">
              <ClubSelect value={clubId} onChange={setClubId} />
              <div className="flex gap-2 items-center">
                <button
                  type="button"
                  onClick={() => setPeriod("day_ago")}
                  className={`px-3 py-1 rounded text-sm whitespace-nowrap ${period === "day_ago" ? "font-medium" : "text-blue-600 underline decoration-dashed"}`}
                >
                  за день
                </button>
                <button
                  type="button"
                  onClick={() => setPeriod("week_ago")}
                  className={`px-3 py-1 rounded text-sm whitespace-nowrap ${period === "week_ago" ? "font-medium" : "text-blue-600 underline decoration-dashed"}`}
                >
                  за неделю
                </button>
              </div>
              <ArenaPlayersGroups
                players={displayedPlayers}
                arena={arena}
                ranks={clubId == null ? undefined : displayRanks}
                period={period}
              />
            </TabsContent>

            <TabsContent value="matches" className="space-y-2">
              <ArenaMatchesTab
                arena={arena}
                items={timeline.items}
                loading={timeline.loading}
                loadingMore={timeline.loadingMore}
                hasMore={timeline.hasMore}
                filters={filters}
                onFiltersChange={handleFiltersChange}
                onLoadMore={timeline.loadMore}
                isGlobal={isGlobalArena}
                pendingGameId={pendingGameId}
              />
            </TabsContent>

            <TabsContent value="medals" className="space-y-4">
              <ArenaMedalsTab players={players} loading={loading} />
            </TabsContent>

            {hasLeaders && (
              <TabsContent value="leaders" className="space-y-4">
                <ArenaLeadersTab matches={timeline.allMatches} loading={timeline.loading} />
              </TabsContent>
            )}
          </Tabs>
        )}
      </div>
    </main>
  );
}

function parseArenaLeagues(arena: Arena): string[] {
  const settings = arena.settings as { leagues?: { kind: string }[] };
  return (settings.leagues ?? []).map((l) => l.kind);
}

function isUnconditional(arena: Arena): boolean {
  const f = arena.filter;
  return (
    f.game_ids.length === 0 &&
    f.tag_ids.length === 0 &&
    f.tournament_id == null &&
    f.date_from == null &&
    f.date_to == null
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
