"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toBase58ID } from "@/lib/id";
import { PageHeader } from "@/app/pageHeaderContext";
import { PageContainer } from "@/components/page-container";
import { Arena, getArenasPromise, getGamePromise, parseArenaSettings } from "@/app/api";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { BackButton } from "@/components/back-button";
import { ErrorAlert } from "@/components/error-alert";
import { GameImage } from "@/components/game-image";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy } from "lucide-react";

// We cannot use /games/<GAME_ID> path in exported application.
// So use query parameters instead /games/view?id=<GAME_ID>
//
// Since ADR-24 the page lists the arenas whose filter includes this game or
// its tags (the game's own arena and the tenants' main arenas included)
// instead of hosting the per-game rating tabs — the arena page owns ranking,
// matches, medals and score leaders now.

const LEAGUE_TITLES: Record<string, string> = {
  elite: "высшая лига",
  amateur: "любители",
  newbie: "новички",
};

function GameContent() {
  const searchParams = useSearchParams();
  const id = toBase58ID(searchParams.get("id") ?? "");

  const { data, loading, error } = useAsyncResource(async () => {
    if (!id) throw new Error("no id");
    const [game, arenas] = await Promise.all([getGamePromise(id), getArenasPromise({ game_id: id })]);
    return { game, arenas };
  }, [id]);

  if (!id) {
    return (
      <PageContainer width="narrow">
        <PageHeader title="Игра" />
        <p className="text-muted-foreground">Please provide a game id in the query string, e.g. ?id=GAME_ID</p>
      </PageContainer>
    );
  }

  const game = data?.game ?? null;
  const arenas = data?.arenas ?? [];
  const imageUrl = game?.image_url ?? game?.image_thumb_url ?? null;

  return (
    <PageContainer width="narrow">
      <BackButton href="/games" />
      <div className="space-y-4">
        <PageHeader title={game?.name ?? ""} />
        {imageUrl && (
          <GameImage src={imageUrl} alt={game?.name ?? ""} className="max-h-44 w-auto rounded-md border object-contain" />
        )}
        <p className="text-sm text-muted-foreground">Партий: {game?.total_matches ?? "…"}</p>

        {error && <ErrorAlert message={error} />}
        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        )}

        <h2 className="text-lg font-semibold pt-2">Арены</h2>
        {arenas.map((arena) => (
          <ArenaCard key={arena.id} arena={arena} />
        ))}
      </div>
    </PageContainer>
  );
}

function ArenaCard({ arena }: { arena: Arena }) {
  const { leagues } = parseArenaSettings(arena.settings);
  const leagueTitles = leagues.length > 0
    ? leagues.map((l) => LEAGUE_TITLES[l.kind] ?? l.kind).join(" · ")
    : "без лиг";
  return (
    <Link
      href={`/arenas/view?id=${arena.id}`}
      className="block rounded-xl border p-4 hover:bg-muted/50 transition-colors"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <Trophy className="h-4 w-4 text-muted-foreground" />
        {arena.name}
      </div>
      <div className="text-sm text-muted-foreground mt-1">
        {arena.game_id ? "арена игры" : arena.tournament_id ? "арена турнира" : "серия игр"}
        {arena.matches_count != null && <> · партий: {arena.matches_count}</>}
        {arena.stale_at && <> · обновляется…</>}
      </div>
      <div className="text-sm text-muted-foreground">{leagueTitles}</div>
    </Link>
  );
}

export default function GamePage() {
  return (
    <Suspense>
      <GameContent />
    </Suspense>
  );
}
