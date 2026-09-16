"use client";

import { useState } from "react";
import Link from "next/link";
import type { Base58ID } from "@/lib/id";
import { useUrlQuery, setUrlQuery } from "@/lib/url-state";
import { PageHeader } from "@/app/pageHeaderContext";
import { Arena, getArenasPromise } from "@/app/api";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { ErrorAlert } from "@/components/error-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GameCombobox } from "@/components/game-combobox";
import { Trophy } from "lucide-react";

const ARENAS_TABS = ["games", "tournaments"] as const;
type ArenasTab = (typeof ARENAS_TABS)[number];

function parseTab(value: string | null): ArenasTab {
  return (ARENAS_TABS as readonly string[]).includes(value ?? "") ? (value as ArenasTab) : "games";
}

export default function ArenasPage() {
  return (
    <main className="max-w-sm mx-auto space-y-6">
      <PageHeader title="Арены" />
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
  // arenas related to that game (by game or by tag), tournament arenas excluded.
  const [gameId, setGameId] = useState<Base58ID | undefined>(undefined);

  const { data: arenas, loading, error } = useAsyncResource(async () => {
    if (tab === "tournaments") {
      return getArenasPromise({ kind: "tournaments" });
    }
    if (gameId) {
      const all = await getArenasPromise({ game_id: gameId });
      // The by-game lookup also matches the global (unconditional) arena and
      // tournament arenas — neither belongs to the games tab.
      return all.filter((a) => !isUnconditional(a) && a.tournament_id == null);
    }
    return getArenasPromise({ kind: "games" });
  }, [tab, gameId]);

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
          <TabsTrigger value="tournaments">Турниры</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "games" && (
        <GameCombobox value={gameId as never} onChange={handleGameChange} />
      )}

      {error && <ErrorAlert message={error} />}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      )}

      {arenas && arenas.length === 0 && (
        <p className="text-sm text-muted-foreground">Нет арен</p>
      )}

      {arenas && arenas.length > 0 && (
        <div className="space-y-2">
          {arenas.map((arena) => (
            <Card key={arena.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Trophy className="h-5 w-5 text-muted-foreground" />
                  <Link href={`/arenas/view?id=${arena.id}`} className="hover:underline">
                    {arena.name}
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p>
                  {arena.matches_count != null && <>Партий: {arena.matches_count}</>}
                  {arena.stale_at && <> · обновляется…</>}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
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
