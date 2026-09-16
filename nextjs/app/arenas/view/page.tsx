"use client";

import React, { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { GLOBAL_ARENA_ID, toBase58ID, type Base58ID } from "@/lib/id";
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
import { ArenaMedalsTab } from "./arena-medals-tab";
import { ArenaMatchesTab } from "./arena-matches-tab";
import { useArenaMatches, type ArenaMatchFilters } from "./use-arena-matches";

// We cannot use /arenas/<ARENA_ID> path in exported application.
// So use query parameters instead /arenas/view?id=<ARENA_ID>. Without an id
// the page renders the global arena — the main page of the app.
const ARENA_TABS_PLAYERS_MATCHES = ["players", "matches", "medals", "leaders"] as const;
const ARENA_TABS_NO_LEADERS = ["players", "matches", "medals"] as const;

const LEADER_TAB_LABEL = "Очки победителей";

function parseTab(value: string | null, hasLeaders: boolean): string {
  const tabs = hasLeaders ? ARENA_TABS_PLAYERS_MATCHES : ARENA_TABS_NO_LEADERS;
  return (tabs as readonly string[]).includes(value ?? "") ? (value as string) : "players";
}

export default function ArenaViewPage() {
  return (
    <Suspense>
      <ArenaViewWrapped />
    </Suspense>
  );
}

function ArenaViewWrapped() {
  const searchParams = useSearchParams();
  const idParam = searchParams.get("id") ?? "";
  const explicitId = toBase58ID(idParam);
  const id = explicitId ?? GLOBAL_ARENA_ID;
  const isGlobal = id === GLOBAL_ARENA_ID;

  const router = useRouter();
  const pathname = usePathname();

  // A missing arena (stale id in the URL, or the global arena absent from a
  // not-yet-migrated database) must not brick the main page: when the id-less
  // global arena 404s, self-heal by resolving the unconditional arena from
  // the list. An explicitly requested arena that is gone renders a friendly
  // not-found state instead of an error.
  const [overrideId, setOverrideId] = useState<Base58ID | null>(null);
  const effectiveId = overrideId ?? id;

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

  // Match filters, mirrored into the URL like on /matches. Read once per
  // arena on mount; subsequent changes go through handleFiltersChange.
  const [filters, setFilters] = useState<ArenaMatchFilters>({});
  React.useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- initialize from URL once per arena */
    setFilters({
      playerId: toBase58ID(searchParams.get("player") ?? "") ?? undefined,
      clubId: toBase58ID(searchParams.get("club") ?? "") ?? undefined,
      gameId: toBase58ID(searchParams.get("game") ?? "") ?? undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read URL once per arena
  }, [effectiveId]);

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
  const tab = parseTab(searchParams.get("tab"), hasLeaders);

  function updateFilterParam(key: string, value: string | undefined) {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    if (value == null) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function handleFiltersChange(next: ArenaMatchFilters) {
    setFilters(next);
    updateFilterParam("player", next.playerId);
    updateFilterParam("club", next.clubId);
    updateFilterParam("game", next.gameId);
  }

  function setTab(value: string) {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.set("tab", value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
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
            <Button asChild size="sm">
              <Link href="/matches/new">Добавить партию</Link>
            </Button>
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
