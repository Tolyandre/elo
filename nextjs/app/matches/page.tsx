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
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { MatchCard } from "@/components/match-card";

export default function MatchesPage() {
  return (
    <Suspense>
      <MatchesPageWrapped />
    </Suspense>
  );
}

function MatchesPageWrapped() {
  const [selectedPlayerId, setSelectedPlayerId] = React.useState<string | undefined>(undefined);
  const [selectedGameId, setSelectedGameId] = React.useState<string | undefined>(undefined);
  const [roundToInteger, setRoundToInteger] = useLocalStorage<boolean>("matches-round-to-integer", true);
  const { matches, loading, error } = useMatches();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    const p = searchParams.get("player") ?? undefined;
    const g = searchParams.get("game") ?? undefined;
    setSelectedPlayerId(p);
    setSelectedGameId(g);
  }, [searchParams]);

  const filteredMatches = React.useMemo(() => {
    if (!matches) return null;

    let result = matches;

    if (selectedPlayerId) {
      result = result.filter((m) => selectedPlayerId in m.score);
    }

    if (selectedGameId) {
      result = result.filter((m) => m.game_id === selectedGameId);
    }

    return result;
  }, [matches, selectedPlayerId, selectedGameId]);

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
    setSelectedPlayerId(id);
    updateQueryParam("player", id);
  }

  function handleGameChange(id?: string) {
    setSelectedGameId(id);
    updateQueryParam("game", id);
  }

  return (
    <main>
      <div className="flex  justify-center">
        <Button asChild>
          <Link href="/add-match">Добавить партию</Link>
        </Button>
      </div>
      <div className="flex items-center justify-center mt-8">
        <h1 className="text-2xl font-semibold">Партии</h1>
      </div>

      {loading && <p className="text-center">Загрузка партий…</p>}
      {error && <p className="text-red-500 text-center">Ошибка: {error}</p>}

      {filteredMatches && (
        <div className="space-y-4">
          <Card >
            <CardContent >

              <FieldGroup>
                <Field>
                  <FieldLabel className="sr-only">Игрок</FieldLabel>
                  <FieldContent>
                    <PlayerCombobox value={selectedPlayerId} onChange={handlePlayerChange} />
                  </FieldContent>
                </Field>

                <Field >
                  <FieldLabel className="sr-only">Игра</FieldLabel>
                  <FieldContent>
                    <GameCombobox value={selectedGameId} onChange={handleGameChange} />
                  </FieldContent>
                </Field>

                <Field orientation="horizontal">
                  <FieldTitle>Округлять до целого</FieldTitle>
                  <Switch id="round-to-integer" checked={roundToInteger} onCheckedChange={setRoundToInteger} />
                </Field>
              </FieldGroup>

            </CardContent>
          </Card>

          {filteredMatches.map((m) => (
            <MatchCard key={m.id} match={m} roundToInteger={roundToInteger} clickable />
          ))}
        </div>
      )}
    </main>
  );
}