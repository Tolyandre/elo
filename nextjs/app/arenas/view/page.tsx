"use client";

import React, { Suspense, useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toBase58ID } from "@/lib/id";
import { PageHeader } from "@/app/pageHeaderContext";
import { Arena, Match, getArenaPlayersPromise, getArenaPromise } from "@/app/api";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { BackButton } from "@/components/back-button";
import { ErrorAlert } from "@/components/error-alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ArenaPlayersGroups } from "@/components/arena-players-table";
import { ScoreLeadersTab } from "@/components/score-leaders-tab";
import { usePlayers } from "@/app/players/PlayersContext";
import { ArenaMedalsTab } from "./arena-medals-tab";
import { ArenaMatchesTab } from "./arena-matches-tab";
import { useArenaMatches, type ArenaMatchFilters } from "./use-arena-matches";

// We cannot use /arenas/<ARENA_ID> path in exported application.
// So use query parameters instead /arenas/view?id=<ARENA_ID>
const ARENA_TABS = ["players", "matches", "medals", "leaders"] as const;
type ArenaTab = (typeof ARENA_TABS)[number];

function parseTab(value: string | null): ArenaTab {
  return (ARENA_TABS as readonly string[]).includes(value ?? "") ? (value as ArenaTab) : "players";
}

/**
 * Corrections settle only into the global arena (ADR-24), so its timeline —
 * the arena whose filter admits every match — is the only one that merges
 * them in.
 */
function isGlobalArena(arena: Arena): boolean {
  const f = arena.filter;
  return (
    f.game_ids.length === 0 &&
    f.tag_ids.length === 0 &&
    f.tournament_id == null &&
    f.date_from == null &&
    f.date_to == null
  );
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
  const id = toBase58ID(idParam);

  const router = useRouter();
  const pathname = usePathname();
  const tab = parseTab(searchParams.get("tab"));

  const { data, loading, error } = useAsyncResource(async () => {
    if (!id) throw new Error("no id");
    const [arena, players] = await Promise.all([
      getArenaPromise(id),
      getArenaPlayersPromise(id),
    ]);
    return { arena, players };
  }, [id]);

  const arena = data?.arena ?? null;
  const players = data?.players ?? [];

  // Match filters, mirrored into the URL like on /matches. Read once per
  // arena on mount; subsequent changes go through handleFiltersChange.
  const [filters, setFilters] = useState<ArenaMatchFilters>({});
  React.useEffect(() => {
    if (!arena) return;
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- initialize from URL once per arena */
    setFilters({
      playerId: toBase58ID(searchParams.get("player") ?? "") ?? undefined,
      clubId: toBase58ID(searchParams.get("club") ?? "") ?? undefined,
      gameId: toBase58ID(searchParams.get("game") ?? "") ?? undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read URL once per arena
  }, [arena?.id]);

  const includeCorrections = arena != null && isGlobalArena(arena);
  const timeline = useArenaMatches(id, filters, includeCorrections);

  const updateFilterParam = useCallback(
    (key: string, value: string | undefined) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      if (value == null) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, pathname, router],
  );

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

  if (!id) {
    return (
      <main className="space-y-8 max-w-sm mx-auto">
        <PageHeader title="Арена" />
        <p className="text-gray-600">Please provide an arena id in the query string, e.g. ?id=ARENA_ID</p>
      </main>
    );
  }

  return (
    <main className="max-w-sm mx-auto">
      <BackButton href="/arenas" label="Назад к аренам" />
      <div className="space-y-4">
        <PageHeader title={arena?.name ?? ""} />
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

        {arena && (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="players" className="px-1 text-xs">Игроки</TabsTrigger>
              <TabsTrigger value="matches" className="px-1 text-xs">Партии</TabsTrigger>
              <TabsTrigger value="medals" className="px-1 text-xs">Медали</TabsTrigger>
              <TabsTrigger value="leaders" className="px-1 text-xs">Лидеры</TabsTrigger>
            </TabsList>

            <TabsContent value="players" className="space-y-4">
              <ArenaPlayersGroups players={players} arena={arena} />
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
              />
            </TabsContent>

            <TabsContent value="medals" className="space-y-4">
              <ArenaMedalsTab players={players} loading={loading} />
            </TabsContent>

            <TabsContent value="leaders" className="space-y-4">
              <ArenaLeadersTab matches={timeline.matches} loading={timeline.loading} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </main>
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
