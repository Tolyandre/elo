"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/app/pageHeaderContext";
import { Arena, getArenasPromise, parseArenaSettings } from "@/app/api";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { ErrorAlert } from "@/components/error-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy } from "lucide-react";

const LEAGUE_TITLES: Record<string, string> = {
  elite: "высшая лига",
  amateur: "любители",
  newbie: "новички",
};

function arenaSubtitle(arena: Arena): string {
  if (arena.game_id) return "арена игры";
  if (arena.tournament_id) return "арена турнира";
  if (arena.filter.game_ids.length > 0 || arena.filter.tag_ids.length > 0) return "серия игр";
  return "все партии";
}

function leagueBadges(arena: Arena): string {
  const { leagues } = parseArenaSettings(arena.settings);
  if (leagues.length === 0) return "без лиг";
  return leagues.map((l) => LEAGUE_TITLES[l.kind] ?? l.kind).join(" · ");
}

function ArenasContent() {
  const { data: arenas, loading, error } = useAsyncResource(() => getArenasPromise(), []);

  return (
    <>
      <PageHeader title="Арены" />
      <p className="text-sm text-muted-foreground">
        Арена — соревновательный режим, который учитывает только избранные партии
        и ведёт независимый рейтинг игроков.
      </p>

      {error && <ErrorAlert message={error} />}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      )}

      {arenas && (
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
              <CardContent className="text-sm text-muted-foreground space-y-1">
                <p>
                  {arenaSubtitle(arena)}
                  {arena.matches_count != null && <> · партий: {arena.matches_count}</>}
                  {arena.stale_at && <> · обновляется…</>}
                </p>
                <p>{leagueBadges(arena)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export default function ArenasPage() {
  return (
    <main className="max-w-sm mx-auto space-y-6">
      <Suspense fallback={<p>Загрузка...</p>}>
        <ArenasContent />
      </Suspense>
    </main>
  );
}
