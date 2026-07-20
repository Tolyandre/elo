"use client";

import React, { Suspense, useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useMatches } from "../MatchesContext";
import { useMe } from "../../meContext";
import { useOffline } from "../../offline/OfflineContext";
import { Match, Market, getMatchByIdPromise, getMarketsByMatchIdPromise } from "../../api";
import { MarketCard } from "@/components/market-card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Edit2, ArrowLeft, Trash2, ClipboardEdit } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/app/pageHeaderContext";
import { MatchCard } from "@/components/match-card";
import { PendingMatchCard } from "@/components/pending-match-card";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldTitle } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function MatchViewPage() {
  return (
    <Suspense>
      <MatchViewPageWrapped />
    </Suspense>
  );
}

function MatchViewPageWrapped() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const { pendingMatches, ready } = useOffline();

  if (!id) return <NotFound />;
  // Before the store hydrates we can't tell a pending match from a saved one, so
  // wait — otherwise a pending match would flash the saved-match fetch (and 404).
  if (!ready) {
    return (
      <main className="max-w-sm mx-auto p-4">
        <p className="text-center">Загрузка...</p>
      </main>
    );
  }
  if (pendingMatches.some((m) => m.clientId === id)) return <PendingMatchView clientId={id} />;
  return <SavedMatchView matchId={id} />;
}

function BackButton() {
  return (
    <div className="mb-4">
      <Button asChild variant="outline">
        <Link href="/matches">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Назад к партиям
        </Link>
      </Button>
    </div>
  );
}

function NotFound() {
  return (
    <main className="max-w-sm mx-auto p-4">
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

function EditAction({ id, disabled = false, viaCalculator = false }: { id: string; disabled?: boolean; viaCalculator?: boolean }) {
  // Both calculator-backed and plain matches edit at /matches/edit; the edit
  // page dispatches to the calculator UI or the generic form based on
  // calculator_kind. The icon differs so the user can tell from the list/view
  // which editor will open.
  const Icon = viaCalculator ? ClipboardEdit : Edit2;
  const label = viaCalculator ? "Открыть в калькуляторе" : "Редактировать";
  if (disabled) {
    return (
      <Button variant="outline" disabled aria-label={label}>
        <Icon className="h-4 w-4" />
      </Button>
    );
  }
  return (
    <Button asChild variant="outline">
      <Link href={`/matches/edit?id=${encodeURIComponent(id)}`} aria-label={label}>
        <Icon className="h-4 w-4" />
      </Link>
    </Button>
  );
}

function SavedMatchView({ matchId }: { matchId: string }) {
  const { matches, loading: contextLoading } = useMatches();
  const { roundToInteger, setRoundToInteger } = useMe();
  const [matchFromApi, setMatchFromApi] = useState<Match | null>(null);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = React.useRef(false);
  const [relatedMarkets, setRelatedMarkets] = useState<Market[]>([]);

  const matchFromContext = matches.find((m) => m.id === matchId) ?? null;

  // Fetch from API only once context is done loading and match still not found
  useEffect(() => {
    if (matchFromContext || fetchedRef.current || contextLoading) return;
    fetchedRef.current = true;
    setFetchLoading(true);
    getMatchByIdPromise(matchId)
      .then(setMatchFromApi)
      .catch((e) => setError(e.message ?? "Неизвестная ошибка"))
      .finally(() => setFetchLoading(false));
  }, [matchId, matchFromContext, contextLoading]);

  const match = matchFromApi ?? matchFromContext;
  const loading = (contextLoading && !matchFromContext) || fetchLoading;

  useEffect(() => {
    getMarketsByMatchIdPromise(matchId)
      .then((data) => setRelatedMarkets(data ?? []))
      .catch(() => {});
  }, [matchId]);

  if (loading) {
    return (
      <main className="max-w-sm mx-auto p-4">
        <p className="text-center">Загрузка...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="max-w-sm mx-auto p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Ошибка: {error}</AlertDescription>
        </Alert>
      </main>
    );
  }

  if (!match) return <NotFound />;

  return (
    <main className="max-w-sm mx-auto p-4 space-y-4">
      <BackButton />

      <PageHeader title="Просмотр партии" action={<EditAction id={match.id} viaCalculator={!!match.calculator_kind} />} />

      <Card>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldTitle>Округлять до целого</FieldTitle>
              <Switch id="round-to-integer" checked={roundToInteger} onCheckedChange={setRoundToInteger} />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <MatchCard match={match} roundToInteger={roundToInteger} />

      {relatedMarkets.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-muted-foreground">Связанные ставки</h2>
          {relatedMarkets.map((market) => (
            <Link key={market.id} href={`/market?id=${market.id}`}>
              <MarketCard market={market} className="hover:bg-accent transition-colors cursor-pointer" />
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

function PendingMatchView({ clientId }: { clientId: string }) {
  const { pendingMatches, ready, isSyncing, deletePendingMatch } = useOffline();
  const { canEdit } = useMe();
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const match = pendingMatches.find((m) => m.clientId === clientId);

  // `leavingRef` suppresses the redirect toast when the user themselves deletes.
  const leavingRef = useRef(false);

  // The match is no longer in the pending store while we're on its page — a sync
  // saved it to the server. Send the user to the list instead of a dead end.
  useEffect(() => {
    if (ready && !match && !leavingRef.current) {
      toast("Партия синхронизирована");
      router.replace("/matches");
    }
  }, [ready, match, router]);

  if (!ready || !match) {
    return (
      <main className="max-w-sm mx-auto p-4">
        <p className="text-center">Загрузка...</p>
      </main>
    );
  }

  if (!match) return <NotFound />;

  return (
    <main className="max-w-sm mx-auto p-4 space-y-4">
      <BackButton />

      <PageHeader
        title="Просмотр партии"
        action={canEdit ? <EditAction id={clientId} disabled={isSyncing} /> : undefined}
      />

      <PendingMatchCard match={match} />

      {canEdit && (
        <Button variant="destructive" disabled={isSyncing} onClick={() => setDeleteOpen(true)}>
          <Trash2 />
          Удалить
        </Button>
      )}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить несохранённую партию</DialogTitle>
            <DialogDescription>
              Партия ещё не отправлена на сервер и будет удалена с этого устройства без возможности восстановления.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Отмена</Button>
            <Button
              variant="destructive"
              disabled={isSyncing}
              onClick={() => {
                leavingRef.current = true;
                deletePendingMatch(clientId);
                setDeleteOpen(false);
                router.push("/matches");
              }}
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
