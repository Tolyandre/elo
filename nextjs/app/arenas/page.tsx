"use client";

import { useMemo, useState } from "react";import Link from "next/link";
import type { Base58ID } from "@/lib/id";
import { useUrlQuery, setUrlQuery } from "@/lib/url-state";
import { PageHeader } from "@/app/pageHeaderContext";
import { Arena, getArenasPromise } from "@/app/api";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useMe } from "@/app/meContext";
import { useGames } from "@/app/gamesContext";
import { useMatches } from "@/app/matches/MatchesContext";
import { arenaMatchesCount, buildArenaGroups, type ArenaGroup } from "@/lib/arena-groups";
import { ErrorAlert } from "@/components/error-alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GameCombobox } from "@/components/game-combobox";

// The "tournaments" tab of ADR-24 is renamed to "camps" (ADR-27): it lists
// camp arenas — a camp is an arena flavor, not a tournament. Bracket
// tournament arenas (ADR-26) will return to a tournaments tab later.
const ARENAS_TABS = ["games", "camps"] as const;
type ArenasTab = (typeof ARENAS_TABS)[number];

function parseTab(value: string | null): ArenasTab {
  return (ARENAS_TABS as readonly string[]).includes(value ?? "") ? (value as ArenasTab) : "games";
}

export default function ArenasPage() {
  const { canEdit } = useMe();
  // The camps tab swaps the header action to «Создать кэмп».
  const params = useUrlQuery();
  const tab = parseTab(params.get("tab"));
  return (
    <main className="max-w-sm mx-auto space-y-6">
      <PageHeader
        title="Арены"
        action={canEdit ? (
          tab === "camps" ? (
            <Button asChild size="sm"><Link href="/arenas/new?kind=camp">Создать кэмп</Link></Button>
          ) : (
            <Button asChild size="sm"><Link href="/arenas/new">Новая арена</Link></Button>
          )
        ) : undefined}
      />
      <ArenasContent />
    </main>
  );
}

function ArenasContent() {
  // The active tab lives in the query string (ADR-25): derived from the URL
  // and switched through the History API. A same-route router.replace must
  // not be used — on the static export it drops the change (and can reload
  // the page), which left the tabs dead after a reload.
  const params = useUrlQuery();
  const tab = parseTab(params.get("tab"));

  // The games tab carries a game filter; the selection narrows the list to the
  // arenas related to that game (by game or by tag), camps and the global
  // arena excluded.
  const [gameId, setGameId] = useState<Base58ID | undefined>(undefined);
  // The open/ended split of the camps tab — "now" frozen at mount (a
  // re-render must not reshuffle the sections mid-visit).
  const [now] = useState(() => Date.now());

  const { games } = useGames();
  const { matches } = useMatches();
  const { playerId } = useMe();

  const { data: arenas, loading, error } = useAsyncResource(async () => {
    if (tab === "camps") {
      return getArenasPromise({ kind: "camps" });
    }
    if (gameId) {
      const all = await getArenasPromise({ game_id: gameId });
      // The by-game lookup also matches the global (unconditional) arena and
      // camp arenas — neither belongs to the games tab.
      return all.filter((a) => !isUnconditional(a) && !a.camp && a.tournament_id == null);
    }
    return getArenasPromise({ kind: "games" });
  }, [tab, gameId]);

  // Games tab layout: with a game selected — one flat list, most matches
  // first; otherwise the grouped layout of buildArenaGroups (tag arenas, then
  // recent/popular/other games as in the game search combobox).
  const groups: ArenaGroup[] = useMemo(() => {
    if (!arenas || tab === "camps") return [];
    if (gameId) {
      return [{ heading: "", arenas: [...arenas].sort((a, b) => arenaMatchesCount(b) - arenaMatchesCount(a)) }];
    }
    return buildArenaGroups(arenas, games, matches, playerId);
  }, [arenas, tab, gameId, games, matches, playerId]);

  // Camps tab layout: open camps (window end in the future) by start date,
  // newest first; then ended ones by end date, most recently finished first.
  // The window lives on the arena itself since ADR-27.
  const campSections = useMemo(() => {
    if (!arenas || tab !== "camps") return null;
    const open: { arena: Arena; start: number }[] = [];
    const ended: { arena: Arena; end: number }[] = [];
    for (const arena of arenas) {
      const start = arena.starts_at ? new Date(arena.starts_at).getTime() : 0;
      const end = arena.ends_at ? new Date(arena.ends_at).getTime() : 0;
      if (end > now) open.push({ arena, start });
      else ended.push({ arena, end });
    }
    open.sort((a, b) => b.start - a.start);
    ended.sort((a, b) => b.end - a.end);
    return { open: open.map((o) => o.arena), ended: ended.map((e) => e.arena) };
  }, [arenas, tab, now]);

  function setTab(value: string) {
    setUrlQuery((params) => params.set("tab", value), "push");
  }

  function handleGameChange(id?: typeof gameId) {
    setGameId(id);
  }

  return (
    <>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="games">По играм</TabsTrigger>
          <TabsTrigger value="camps">Кэмпы</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "games" && (
        <GameCombobox value={gameId as never} onChange={handleGameChange} />
      )}

      {error && <ErrorAlert message={error} />}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      )}

      {tab === "games" && (
        <>
          {arenas && arenas.length === 0 && (
            <p className="text-sm text-muted-foreground">Нет арен</p>
          )}
          {groups.map((group) => (
            <Card key={group.heading || "__all__"} className="gap-2">
              {group.heading && (
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground">{group.heading}</CardTitle>
                </CardHeader>
              )}
              <CardContent className="divide-y">
                {group.arenas.map((arena) => (
                  <ArenaItem key={arena.id} arena={arena} />
                ))}
              </CardContent>
            </Card>
          ))}
        </>
      )}

      {tab === "camps" && campSections && (
        <>
          {campSections.open.length === 0 && campSections.ended.length === 0 && (
            <p className="text-sm text-muted-foreground">Нет кэмпов</p>
          )}
          {campSections.open.length > 0 && (
            <Card className="gap-2">
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">Открытые</CardTitle>
              </CardHeader>
              <CardContent className="divide-y">
                {campSections.open.map((arena) => (
                  <ArenaItem key={arena.id} arena={arena} />
                ))}
              </CardContent>
            </Card>
          )}
          {campSections.ended.length > 0 && (
            <Card className="gap-2">
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">Завершённые</CardTitle>
              </CardHeader>
              <CardContent className="divide-y">
                {campSections.ended.map((arena) => (
                  <ArenaItem key={arena.id} arena={arena} />
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </>
  );
}

/**
 * A plain single-row list item inside a section card: the arena's name
 * (wrapping only when too long) and its matches count.
 */
function ArenaItem({ arena }: { arena: Arena }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
      <Link href={`/arenas/view?id=${arena.id}`} className="font-medium underline min-w-0">
        {arena.name}
      </Link>
      <span className="text-sm text-muted-foreground shrink-0 whitespace-nowrap">
        {arena.matches_count != null && <>Партий: {arena.matches_count}</>}
        {arena.stale_at && <> · обновляется…</>}
      </span>
    </div>
  );
}

function isUnconditional(arena: Arena): boolean {
  const f = arena.filter;
  return (
    !arena.camp &&
    f != null &&
    f.game_ids.length === 0 &&
    f.tag_ids.length === 0 &&
    f.date_from == null &&
    f.date_to == null
  );
}
