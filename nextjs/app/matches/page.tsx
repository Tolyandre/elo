"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useMatches } from "./MatchesContext";
import { PlayerCombobox } from "@/components/player-combobox";
import { GameCombobox } from "@/components/game-combobox";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel, FieldContent, FieldGroup, FieldTitle } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { MatchCard } from "@/components/match-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useMe } from "../meContext";

export default function MatchesPage() {
  return (
    <Suspense>
      <MatchesPageWrapped />
    </Suspense>
  );
}

function MatchesPageWrapped() {
  const { roundToInteger, setRoundToInteger } = useMe();
  const { matches, loading, loadingMore, error, hasMore, filters, setFilters, loadMore } = useMatches();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const sentinelRef = React.useRef<HTMLDivElement>(null);

  // Sync filters from URL on mount
  React.useEffect(() => {
    const p = searchParams.get("player") ?? undefined;
    const g = searchParams.get("game") ?? undefined;
    setFilters({ playerId: p, gameId: g });
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
    router.replace(url);
  }

  function handlePlayerChange(id?: string) {
    setFilters({ ...filters, playerId: id });
    updateQueryParam("player", id);
  }

  function handleGameChange(id?: string) {
    setFilters({ ...filters, gameId: id });
    updateQueryParam("game", id);
  }

  return (
    <main className="max-w-sm mx-auto">
      <div className="flex justify-center">
        <Button asChild>
          <Link href="/add-match">Добавить партию</Link>
        </Button>
      </div>
      <div className="flex items-center justify-between mt-8">
        <h1 className="text-2xl font-semibold mb-4 mx-auto">Партии</h1>
      </div>

      {error && <p className="text-red-500 text-center">Ошибка: {error}</p>}

      <div className="space-y-4">
        <Card>
          <CardContent>
            <FieldGroup>
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
              <MatchCard key={m.id} match={m} roundToInteger={roundToInteger} clickable />
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
