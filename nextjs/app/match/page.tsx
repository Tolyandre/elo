"use client";

import React, { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useMatches } from "../matches/MatchesContext";
import { usePlayers } from "../players/PlayersContext";
import { Match, updateMatchPromise } from "../api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Edit2, ArrowLeft, X } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { PlayerCombobox } from "@/components/player-combobox";
import { GameCombobox } from "@/components/game-combobox";
import { MatchCard } from "@/components/match-card";

export default function MatchPage() {
  return (
    <Suspense>
      <MatchPageWrapped />
    </Suspense>
  );
}

function MatchPageWrapped() {
  const searchParams = useSearchParams();
  const matchId = searchParams.get("id");
  const { matches, loading, error, invalidate } = useMatches();

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
        {(
          <EditMatchDialog match={match} onSuccess={() => {
            invalidate();
            toast.success("Партия обновлена");
          }} />
        )}
      </div>

      <MatchCard match={match} />
    </main>
  );
}

function EditMatchDialog({ match, onSuccess }: { match: Match; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [selectedGameId, setSelectedGameId] = useState<string | undefined>(undefined);
  const [playerScores, setPlayerScores] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [selectedPlayerToAdd, setSelectedPlayerToAdd] = useState<string | undefined>(undefined);
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

      setSelectedGameId(match.game_id);

      const scores: Record<string, string> = {};
      Object.entries(match.score).forEach(([playerId, data]) => {
        scores[playerId] = data.score.toString();
      });
      setPlayerScores(scores);
      setError("");
      setSelectedPlayerToAdd(undefined);
    }
  }, [open, match]);

  // Automatically add player when selected
  useEffect(() => {
    if (!selectedPlayerToAdd) return;

    if (playerScores[selectedPlayerToAdd]) {
      setError("Игрок уже добавлен в партию");
      setSelectedPlayerToAdd(undefined);
      return;
    }

    setPlayerScores((prev) => ({
      ...prev,
      [selectedPlayerToAdd]: "0",
    }));
    setSelectedPlayerToAdd(undefined);
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlayerToAdd]);

  const handleRemovePlayer = (playerId: string) => {
    const currentPlayers = Object.keys(playerScores);
    if (currentPlayers.length <= 2) {
      setError("В партии должно быть минимум 2 игрока");
      return;
    }

    const newScores = { ...playerScores };
    delete newScores[playerId];
    setPlayerScores(newScores);
    setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!date) {
      setError("Дата обязательна");
      return;
    }

    if (!selectedGameId) {
      setError("Игра обязательна");
      return;
    }

    if (Object.keys(playerScores).length < 2) {
      setError("В партии должно быть минимум 2 игрока");
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
        game_id: selectedGameId,
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

  // Get available players to add (not already in the match)
  const availablePlayersToAdd = allPlayers.filter(
    (p) => !playerScores[p.id]
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Edit2 className="mr-2 h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
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

            <div className="flex items-center gap-4">
              <label htmlFor="date" className="text-sm font-medium w-24 flex-shrink-0">
                Дата и время
              </label>
              <input
                id="date"
                type="datetime-local"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="flex h-10 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                required
              />
            </div>

            <div className="flex items-center gap-4">
              <label htmlFor="game" className="text-sm font-medium w-24 flex-shrink-0">
                Игра
              </label>
              <div className="flex-1">
                <GameCombobox value={selectedGameId} onChange={setSelectedGameId} />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {Object.keys(playerScores).length} игроков
                </span>
              </div>

              {Object.entries(playerScores).map(([playerId, score]) => {
                const player = allPlayers.find((p) => p.id === playerId);
                return (
                  <div key={playerId} className="flex items-center gap-2">
                    <label htmlFor={`score-${playerId}`} className="flex-1 text-sm font-medium min-w-0">
                      <span className="truncate block">{player?.name || `Игрок ${playerId}`}</span>
                    </label>
                    <input
                      id={`score-${playerId}`}
                      type="number"
                      step="0.1"
                      value={score}
                      onChange={(e) =>
                        setPlayerScores((prev) => ({ ...prev, [playerId]: e.target.value }))
                      }
                      className="flex h-10 w-28 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      required
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemovePlayer(playerId)}
                      disabled={Object.keys(playerScores).length <= 2}
                      className="h-10 w-10"
                      title="Удалить игрока"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}

              {availablePlayersToAdd.length > 0 && (
                <div className="pt-2 border-t">
                  <div className="flex items-center gap-4">
                    <label className="text-sm font-medium w-32 flex-shrink-0">
                      Добавить игрока
                    </label>
                    <div className="flex-1">
                      <PlayerCombobox
                        value={selectedPlayerToAdd}
                        onChange={setSelectedPlayerToAdd}
                      />
                    </div>
                  </div>
                </div>
              )}
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
