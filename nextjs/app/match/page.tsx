"use client";

import React, { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useMatches } from "../matches/MatchesContext";
import { usePlayers } from "../players/PlayersContext";
import { useMe } from "../meContext";
import { Match, updateMatchPromise } from "../api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Edit2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Field, FieldLabel, FieldContent } from "@/components/ui/field";
import { toast } from "sonner";

export default function MatchPage() {
  return (
    <Suspense>
      <MatchPageWrapped />
    </Suspense>
  );
}

function MatchPageWrapped() {
  const searchParams = useSearchParams();
  const matchId = searchParams.get("match_id");
  const { matches, loading, error, invalidate } = useMatches();
  const { players } = usePlayers();
  const { canEdit } = useMe();
  const router = useRouter();

  const match = matches?.find((m) => m.id.toString() === matchId);

  if (loading) {
    return (
      <main className="container mx-auto p-4">
        <p className="text-center">Загрузка...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="container mx-auto p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Ошибка: {error}</AlertDescription>
        </Alert>
      </main>
    );
  }

  if (!matchId || !match) {
    return (
      <main className="container mx-auto p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Партия не найдена</AlertDescription>
        </Alert>
        <div className="mt-4">
          <Button asChild variant="outline">
            <Link href="/matches">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Вернуться к списку партий
            </Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="container mx-auto p-4 max-w-2xl">
      <div className="mb-4">
        <Button asChild variant="outline">
          <Link href="/matches">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Назад к партиям
          </Link>
        </Button>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Просмотр партии</h1>
        {canEdit && (
          <EditMatchDialog match={match} onSuccess={() => {
            invalidate();
            toast.success("Партия обновлена");
          }} />
        )}
      </div>

      <MatchDetails match={match} />
    </main>
  );
}

function MatchDetails({ match }: { match: Match }) {
  const { players: playersFromContext = [] } = usePlayers();

  const players = Object.entries(match.score)
    .map(([playerId, data]) => {
      const ctxPlayer = playersFromContext.find((p) => p.id === playerId);
      const name = ctxPlayer?.name || "Unknown";
      return {
        name,
        playerId,
        eloPay: data.eloPay,
        eloEarn: data.eloEarn,
        score: data.score,
        eloChange: data.eloPay + data.eloEarn,
      };
    })
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
              {match.date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            </span>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent>
        <ul className="space-y-4">
          {players.map((p, idx) => (
            <li key={p.playerId} className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold">{ranks[idx]}.</span>
                  <span>{p.name}</span>
                </div>

                <div className="relative h-2 bg-gray-200 rounded overflow-hidden">
                  {/* Earned Elo indicator */}
                  <div
                    className="absolute top-0 h-1 bg-green-400"
                    style={{ width: `${(p.eloEarn / totalEarn) * 100}%` }}
                  />
                  {/* Paid Elo indicator */}
                  <div
                    className="absolute bottom-0 h-1 bg-red-400"
                    style={{ width: `${(Math.abs(p.eloPay) / Math.abs(totalPay)) * 100}%` }}
                  />
                </div>
              </div>

              <div className="text-center w-20 text-3xl font-semibold">{p.score}</div>

              <div className="text-right w-24">
                <div
                  className={`font-semibold text-lg ${
                    p.eloChange > 0 ? "text-green-600" : p.eloChange < 0 ? "text-red-600" : "text-gray-600"
                  }`}
                >
                  {p.eloChange >= 0 ? "+" : ""}
                  {p.eloChange.toFixed(1)}
                </div>
                <div className="text-xs text-muted-foreground text-nowrap">
                  ({p.eloPay.toFixed(1)} + {p.eloEarn.toFixed(1)})
                </div>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function EditMatchDialog({ match, onSuccess }: { match: Match; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [playerScores, setPlayerScores] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const { players: allPlayers } = usePlayers();

  useEffect(() => {
    if (open) {
      // Initialize form with current match data
      if (match.date) {
        // Format date to datetime-local format: YYYY-MM-DDTHH:mm
        const d = new Date(match.date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        setDate(`${year}-${month}-${day}T${hours}:${minutes}`);
      } else {
        setDate("");
      }

      const scores: Record<string, string> = {};
      Object.entries(match.score).forEach(([playerId, data]) => {
        scores[playerId] = data.score.toString();
      });
      setPlayerScores(scores);
      setError("");
    }
  }, [open, match]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!date) {
      setError("Дата обязательна");
      return;
    }

    // Validate all scores are numbers
    const scores: Record<string, number> = {};
    for (const [playerId, scoreStr] of Object.entries(playerScores)) {
      const score = parseFloat(scoreStr);
      if (isNaN(score)) {
        setError(`Некорректный счёт для игрока ${allPlayers.find(p => p.id === playerId)?.name || playerId}`);
        return;
      }
      scores[playerId] = score;
    }

    setSubmitting(true);
    try {
      await updateMatchPromise(match.id, {
        game_id: match.game_id,
        score: scores,
        date: new Date(date).toISOString(),
      });
      setOpen(false);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка при обновлении");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Edit2 className="mr-2 h-4 w-4" />
          Редактировать
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Редактировать партию</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Field>
              <FieldLabel htmlFor="date">Дата и время</FieldLabel>
              <FieldContent>
                <input
                  id="date"
                  type="datetime-local"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  required
                />
              </FieldContent>
            </Field>

            <div className="space-y-3">
              <h3 className="text-sm font-medium">Счета игроков</h3>
              {Object.entries(playerScores).map(([playerId, score]) => {
                const player = allPlayers.find((p) => p.id === playerId);
                return (
                  <Field key={playerId}>
                    <FieldLabel htmlFor={`score-${playerId}`}>
                      {player?.name || `Игрок ${playerId}`}
                    </FieldLabel>
                    <FieldContent>
                      <input
                        id={`score-${playerId}`}
                        type="number"
                        step="0.1"
                        value={score}
                        onChange={(e) =>
                          setPlayerScores((prev) => ({ ...prev, [playerId]: e.target.value }))
                        }
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        required
                      />
                    </FieldContent>
                  </Field>
                );
              })}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Отмена
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
