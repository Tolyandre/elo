"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useMatches } from "./MatchesContext";
import { PlayerCombobox } from "@/components/player-combobox";
import { GameCombobox } from "@/components/game-combobox";
import { Switch } from "@/components/ui/switch";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Field, FieldLabel, FieldContent, FieldGroup, FieldTitle } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { Match } from "../api";
import { RHFField } from "@/components/rhf-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal } from "lucide-react";

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
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    const p = searchParams.get("player") ?? undefined;
    const g = searchParams.get("game") ?? undefined;
    setSelectedPlayerId(p);
    setSelectedGameId(g);
  }, [searchParams]);

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

  function LoadingOrError() {
    const { loading, error } = useMatches();
    if (loading) return <p className="text-center">Загрузка партий…</p>;
    if (error) return <p className="text-red-500 text-center">Ошибка: {error}</p>;
    return null;
  }

  function MatchesList() {
    const { matches } = useMatches();
    if (!matches) return null; // ещё нет данных

    let filtered = selectedPlayerId
      ? matches.filter((m) => Object.prototype.hasOwnProperty.call(m.score, selectedPlayerId))
      : matches;

    if (selectedGameId) {
      filtered = filtered.filter((m) => m.game_id === selectedGameId);
    }

    return (
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

              <Alert variant="default" className="max-w-100">
                <Terminal />
                <AlertTitle>Фильтр временно не работает</AlertTitle>
                <AlertDescription>
                  Фильтр по играм заработает, когда партии будут перенесены в базу данных. Я работаю над этим. Спасибо за понимание!
                </AlertDescription>
              </Alert>

              <Field orientation="horizontal">
                <FieldTitle>Округлять до целого</FieldTitle>
                <Switch id="round-to-integer" checked={roundToInteger} onCheckedChange={setRoundToInteger} />
              </Field>
            </FieldGroup>

          </CardContent>
        </Card>

        {filtered.map((m) => (
          <MatchCard key={m.id} match={m} roundToInteger={roundToInteger} />
        ))}
      </div>
    );
  }

  function MatchCard({ match, roundToInteger }: { match: Match; roundToInteger: boolean }) {
    const players = Object.entries(match.score)
      .map(([name, data]) => ({
        name,
        eloPay: data.eloPay,
        eloEarn: data.eloEarn,
        score: data.score,
        eloChange: data.eloPay + data.eloEarn,
      }))
      .sort((a, b) => b.score - a.score);

    const ranks = players.map((v) => players.findIndex((p) => p.score === v.score) + 1);

    const totalEarn = players.map((p) => p.eloEarn).reduce((a, b) => a + b, 0) || 1;
    const totalPay = players.map((p) => p.eloPay).reduce((a, b) => a + b, 0) || 1;

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between w-full">
            <Link href={`/game?id=${match.game_id}`} className="underline">
              {match.game_name}
            </Link>
            {match.date && (
              <span className="text-muted-foreground text-sm">
                {`${match.date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`}
              </span>
            )}
          </CardTitle>
        </CardHeader>

        <CardContent>
          <ul className="space-y-2">
            {players.map((p, idx) => (
              <li key={p.name} className="flex items-center gap-4">

                <div className="gap-2 w-30">
                  <span className="font-semibold">{ranks[idx]}. </span>
                  <span>{p.name}</span>

                  <div className="relative h-2 bg-gray-200 rounded mt-1 overflow-hidden">

                    {/* Индикатор победных очков */}
                    <div
                      className="absolute top-0 h-1 bg-green-400"
                      style={{ width: `${(p.eloEarn / totalEarn) * 100}%` }}
                    />

                    {/* Индикатор вероятности победы (сколько очко вычитаем) */}
                    <div
                      className="absolute bottom-0 h-1 bg-red-400"
                      style={{ width: `${(p.eloPay / totalPay) * 100}%` }}
                    />
                  </div>
                </div>

                <div className="text-center w-15 text-3xl">{p.score}</div>

                <div className="text-right w-15">
                  <div
                    className={`font-semibold ${p.eloChange > 0 ? "text-green-600" : p.eloChange < 0 ? "text-red-600" : "text-gray-600"}`}
                  >
                    {p.eloChange >= 0 ? "+" : ""}
                    {p.eloChange.toFixed(roundToInteger ? 0 : 1)}
                  </div>
                  <div className="text-xs text-muted-foreground text-nowrap">
                    ({p.eloPay.toFixed(roundToInteger ? 0 : 1)} + {p.eloEarn.toFixed(roundToInteger ? 0 : 1)})
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    );
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

      <LoadingOrError />
      <MatchesList />
    </main>
  );
}