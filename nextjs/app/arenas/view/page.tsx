"use client";

import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toBase58ID } from "@/lib/id";
import { PageHeader } from "@/app/pageHeaderContext";
import {
    Arena,
    getArenaPlayersPromise,
    getArenaPromise,
    getArenaMatchesPagePromise,
    Match,
    parseArenaSettings,
} from "@/app/api";
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

// We cannot use /arenas/<ARENA_ID> path in exported application.
// So use query parameters instead /arenas/view?id=<ARENA_ID>
const ARENA_TABS = ["players", "matches", "medals", "leaders"] as const;
type ArenaTab = (typeof ARENA_TABS)[number];

function parseTab(value: string | null): ArenaTab {
  return (ARENA_TABS as readonly string[]).includes(value ?? "") ? (value as ArenaTab) : "players";
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

  // Matches are shared by the Партии and Лидеры tabs: one cursor-paginated
  // loader. The cursor lives in a ref (not state) so loadMore reads it
  // without re-creating the callback.
  const [matches, setMatches] = useState<Match[]>([]);
  const nextCursorRef = useRef<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMatches, setLoadingMatches] = useState(false);

  // Load page 1 whenever the arena changes.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- reset loading before async fetch */
    setLoadingMatches(true);
    getArenaMatchesPagePromise({ id, limit: 30 })
      .then((page) => {
        if (cancelled) return;
        nextCursorRef.current = page.next;
        setMatches(page.items);
        setHasMore(page.next !== null);
      })
      .catch(() => {
        // toast shown by API helper
      })
      .finally(() => {
        if (!cancelled) setLoadingMatches(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  const loadMore = useCallback(() => {
    if (!id || loadingMatches) return;
    const cursor = nextCursorRef.current;
    if (!cursor) return;
    setLoadingMatches(true);
    getArenaMatchesPagePromise({ id, next: cursor, limit: 30 })
      .then((page) => {
        nextCursorRef.current = page.next;
        setHasMore(page.next !== null);
        setMatches((prev) => [...prev, ...page.items]);
      })
      .catch(() => {
        // toast shown by API helper
      })
      .finally(() => setLoadingMatches(false));
  }, [id, loadingMatches]);

  // The leaders tab needs the full match set: pull all remaining pages.
  const loadAllMatches = useCallback(async () => {
    if (!id) return;
    setLoadingMatches(true);
    try {
      let cursor = nextCursorRef.current;
      while (cursor) {
        const page = await getArenaMatchesPagePromise({ id, next: cursor, limit: 100 });
        nextCursorRef.current = page.next;
        setMatches((prev) => [...prev, ...page.items]);
        cursor = page.next;
      }
      setHasMore(false);
    } finally {
      setLoadingMatches(false);
    }
  }, [id]);

  function setTab(value: string) {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.set("tab", value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    if (value === "leaders" && hasMore && !loadingMatches) {
      void loadAllMatches();
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

  const leagues = arena ? parseLeagueKinds(arena) : [];

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
              <ArenaPlayersGroups players={players} leagues={leagues} />
            </TabsContent>

            <TabsContent value="matches" className="space-y-2">
              <ArenaMatchesTab
                matches={matches}
                loading={loadingMatches}
                hasMore={hasMore}
                onLoadMore={loadMore}
              />
            </TabsContent>

            <TabsContent value="medals" className="space-y-4">
              <ArenaMedalsTab players={players} loading={loading} />
            </TabsContent>

            <TabsContent value="leaders" className="space-y-4">
              <ArenaLeadersTab matches={matches} loading={loadingMatches} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </main>
  );
}

function parseLeagueKinds(arena: Arena): string[] {
  const { leagues } = parseArenaSettings(arena.settings);
  return leagues.map((l) => l.kind);
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
