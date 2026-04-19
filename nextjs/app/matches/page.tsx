"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useMatches } from "./MatchesContext";
import { PlayerCombobox } from "@/components/player-combobox";
import { GameCombobox } from "@/components/game-combobox";
import { ClubSelect } from "@/components/club-select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel, FieldContent, FieldGroup, FieldTitle } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/app/pageHeaderContext";
import { MatchCard } from "@/components/match-card";
import { MarketCard } from "@/components/market-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useMe } from "../meContext";
import { getMarketsByMatchIdPromise, Match, Market } from "../api";

function MatchWithMarkets({ match, roundToInteger }: { match: Match; roundToInteger: boolean }) {
  const [relatedMarkets, setRelatedMarkets] = React.useState<Market[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!match.has_markets) return;
    getMarketsByMatchIdPromise(match.id)
      .then((data) => setRelatedMarkets(data ?? []))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Ошибка загрузки ставок"));
  }, [match.id, match.has_markets]);

  return (
    <div>
      <MatchCard match={match} roundToInteger={roundToInteger} clickable />
      {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
      {relatedMarkets.length > 0 && (
        <div className="space-y-3 mt-3">
          {relatedMarkets.map((market) => (
            <Link key={market.id} href={`/market?id=${market.id}`}>
              <MarketCard market={market} className="hover:bg-accent transition-colors cursor-pointer" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MatchesPage() {
  return (
    <Suspense>
      <MatchesPageWrapped />
    </Suspense>
  );
}

function MatchesPageWrapped() {
  const { roundToInteger, setRoundToInteger, selectedClubId, setSelectedClubId } = useMe();
  const { matches, loading, loadingMore, error, hasMore, filters, setFilters, loadMore } = useMatches();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const sentinelRef = React.useRef<HTMLDivElement>(null);

  // Sync filters from URL on mount
  React.useEffect(() => {
    const p = searchParams.get("player") ?? undefined;
    const g = searchParams.get("game") ?? undefined;
    const clubParam = searchParams.get("club");
    // URL param takes precedence and overwrites the saved setting
    const clubId = clubParam !== null ? (clubParam === "" ? null : clubParam) : selectedClubId;
    if (clubParam !== null) {
      setSelectedClubId(clubParam === "" ? null : clubParam);
    }
    setFilters({ playerId: p, gameId: g, clubId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only on mount — subsequent changes go through handlers

  // Infinite scroll: observe sentinel
  React.useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          loadMore();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loadMore]);

  function updateQueryParam(key: string, value: string | undefined) {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    if (value == null) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    const query = params.toString();
    const url = query ? `${pathname}?${query}` : pathname;
    router.replace(url, { scroll: false });
  }

  function handlePlayerChange(id?: string) {
    setFilters({ ...filters, playerId: id });
    updateQueryParam("player", id);
  }

  function handleGameChange(id?: string) {
    setFilters({ ...filters, gameId: id });
    updateQueryParam("game", id);
  }

  function handleClubChange(id: string | null) {
    setFilters({ ...filters, clubId: id });
    setSelectedClubId(id);
    updateQueryParam("club", id ?? undefined);
  }

  return (
    <main className="max-w-sm mx-auto space-y-6">
      <PageHeader
        title="Партии"
        action={<Button asChild size="sm"><Link href="/add-match">Добавить партию</Link></Button>}
      />

      {error && <p className="text-red-500 text-center">Ошибка: {error}</p>}

      <div className="space-y-4">
        <Card>
          <CardContent>
            <FieldGroup>

              <Field>
                <FieldLabel className="sr-only">Клуб</FieldLabel>
                <FieldContent>
                  <ClubSelect value={filters.clubId ?? null} onChange={handleClubChange} />
                </FieldContent>
              </Field>

              <Field>
                <FieldLabel className="sr-only">Игрок</FieldLabel>
                <FieldContent>
                  <PlayerCombobox value={filters.playerId} onChange={handlePlayerChange} />
                </FieldContent>
              </Field>

              <Field>
                <FieldLabel className="sr-only">Игра</FieldLabel>
                <FieldContent>
                  <GameCombobox value={filters.gameId} onChange={handleGameChange} />
                </FieldContent>
              </Field>

              <Field orientation="horizontal">
                <FieldTitle>Округлять до целого</FieldTitle>
                <Switch id="round-to-integer" checked={roundToInteger} onCheckedChange={setRoundToInteger} />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        {loading ? (
          <>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-xl" />
            ))}
          </>
        ) : (
          <>
            {matches.map((m) => (
              <MatchWithMarkets key={m.id} match={m} roundToInteger={roundToInteger} />
            ))}
          </>
        )}

        {/* Infinite scroll sentinel */}
        <div ref={sentinelRef} className="flex justify-center py-4">
          {loadingMore && <Spinner className="size-6" />}
        </div>
      </div>
    </main>
  );
}
