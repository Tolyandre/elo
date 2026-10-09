"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toBase58ID } from "@/lib/id";
import type { Base58ID } from "@/lib/id";
import { toast } from "sonner";
import { useMatches } from "../MatchesContext";
import { useMe } from "../../meContext";
import { useTenantScope } from "../../tenantScopeContext";
import { TenantChooser } from "@/components/tenant-chooser";
import { useOffline } from "../../offline/OfflineContext";
import { Match, Market, getMatchByIdPromise, getMarketsByMatchIdPromise, matchSettled } from "../../api";
import { MarketCard } from "@/components/market-card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Edit2, Trash2, ClipboardEdit, Info } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/app/pageHeaderContext";
import { PageContainer } from "@/components/page-container";
import { LoadingRows } from "@/components/loading-rows";
import { MatchCard } from "@/components/match-card";
import { MatchAudit } from "@/components/audit/match-audit";
import { PendingMatchCard } from "@/components/pending-match-card";
import { BackButton } from "@/components/back-button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
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
  const id = toBase58ID(searchParams.get("id") ?? "");
  const { pendingMatches, ready } = useOffline();
  const { tenantId } = useTenantScope();

  if (!id) return <NotFound />;
  // Before the store hydrates we can't tell a pending match from a saved one, so
  // wait — otherwise a pending match would flash the saved-match fetch (and 404).
  if (!ready) {
    return (
      <PageContainer width="narrow">
        <LoadingRows />
      </PageContainer>
    );
  }
  if (pendingMatches.some((m) => m.clientId === id)) return <PendingMatchView clientId={id} />;
  // The detail read is tenant-scoped (ADR-36): keying the view on the tenant
  // remounts it on a switch, so the settlement columns and the membership note
  // always describe the community in force — nothing cross-tenant survives.
  return <SavedMatchView key={tenantId ?? "tenantless"} matchId={id} />;
}

function NotFound() {
  return (
    <PageContainer width="narrow">
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Партия не найдена</AlertDescription>
      </Alert>
      <BackButton href="/?tab=feed" />
    </PageContainer>
  );
}

function EditAction({ id, tenantId, disabled = false, viaCalculator = false }: { id: string; tenantId: Base58ID | null; disabled?: boolean; viaCalculator?: boolean }) {
  // Both calculator-backed and plain matches edit at /matches/edit; the edit
  // page dispatches to the calculator UI or the generic form based on
  // calculator_kind. The icon differs so the user can tell from the list/view
  // which editor will open. The edit is tenant-scoped (ADR-36), so the link
  // names the community explicitly.
  const Icon = viaCalculator ? ClipboardEdit : Edit2;
  const label = viaCalculator ? "Открыть в калькуляторе" : "Редактировать";
  const href = tenantId
    ? `/matches/edit?id=${encodeURIComponent(id)}&tenant=${tenantId}`
    : `/matches/edit?id=${encodeURIComponent(id)}`;
  if (disabled) {
    return (
      <Button variant="outline" disabled aria-label={label}>
        <Icon className="h-4 w-4" />
      </Button>
    );
  }
  return (
    <Button asChild variant="outline">
      <Link href={href} aria-label={label}>
        <Icon className="h-4 w-4" />
      </Link>
    </Button>
  );
}

function SavedMatchView({ matchId }: { matchId: Base58ID }) {
  const { matches, loading: contextLoading } = useMatches();
  const { roundToInteger, setRoundToInteger } = useMe();
  // The rating columns come from the current tenant's main arena (ADR-36);
  // the matches context is tenant-scoped the same way, so both sources agree.
  // The view is keyed on the tenant (MatchViewPageWrapped), so a switch starts
  // here from scratch — the settlement columns are never reused across
  // communities.
  const { ready: scopeReady, tenantId, tenant } = useTenantScope();
  const [matchFromApi, setMatchFromApi] = useState<Match | null>(null);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [relatedMarkets, setRelatedMarkets] = useState<Market[]>([]);

  const matchFromContext = matches.find((m) => m.id === matchId) ?? null;

  // Fetch from API only once the context is done loading (it waits for the
  // tenant scope and refetches on a switch), the match is still not found in
  // it, and the tenant is resolved — the detail read is tenant-required
  // (ADR-36 phase 5). The context covers matches on its fetched pages; the
  // detail fills in for everything beyond them (deep links, older matches).
  useEffect(() => {
    if (matchFromContext || contextLoading || !tenantId) return;
    let cancelled = false;
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- reset loading/error before the async fetch (same pattern as MatchesContext) */
    setFetchLoading(true);
    setError(null);
    getMatchByIdPromise(matchId, tenantId)
      .then((m) => {
        if (!cancelled) setMatchFromApi(m);
      })
      .catch((e) => setError(e.message ?? "Неизвестная ошибка"))
      .finally(() => {
        if (!cancelled) setFetchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [matchId, matchFromContext, contextLoading, tenantId]);

  // Related markets are tenant-scoped (ADR-36): only the markets the current
  // community owns. The fetch follows the tenant switch like the settlement
  // columns; a failure just keeps the auxiliary section hidden.
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    getMarketsByMatchIdPromise(matchId, tenantId)
      .then((data) => {
        if (!cancelled) setRelatedMarkets(data ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [matchId, tenantId]);

  const match = matchFromApi ?? matchFromContext;
  // The context data is only trustworthy once it has settled for the current
  // tenant: mid-refetch it still holds the previous community's settlement
  // columns, so the view waits it out instead of flashing foreign ratings.
  const loading = contextLoading || fetchLoading;

  // The detail read and the rating columns are tenant-scoped: with no
  // community chosen the chooser substitutes the content — the page never
  // defaults to one (ADR-36 phase 7). The matches context itself waits for
  // the scope, so scopeReady is what distinguishes "no tenant" from loading.
  if (!scopeReady) {
    return (
      <PageContainer width="narrow">
        <LoadingRows />
      </PageContainer>
    );
  }
  if (!tenantId && !matchFromContext) {
    return (
      <PageContainer width="narrow">
        <div className="py-8">
          <TenantChooser />
        </div>
      </PageContainer>
    );
  }

  if (loading) {
    return (
      <PageContainer width="narrow">
        <LoadingRows />
      </PageContainer>
    );
  }

  // A failed detail read is fatal only while the context cannot stand in for
  // the match — the feed may still deliver it after the network came back.
  if (error && !match) {
    return (
      <PageContainer width="narrow">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Ошибка: {error}</AlertDescription>
        </Alert>
      </PageContainer>
    );
  }

  if (!match) return <NotFound />;

  // A competitive match the current community's main arena does not admit
  // (its openness rule, evaluated at the match date) has no settlement there:
  // the rating columns are null and the card hides them instead of showing
  // zeros that would suggest a played-out rating change.
  const settled = matchSettled(match);

  return (
    <PageContainer width="narrow">
      <BackButton href="/?tab=feed" />

      <PageHeader title="Просмотр партии" action={<EditAction id={match.id} tenantId={tenantId} viaCalculator={!!match.calculator_kind} />} />

      {match.mode !== "coop" && !settled && tenant && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>Партия не относится к сообществу «{tenant.name}»</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent>
          <div className="flex items-center justify-between">
            <Label htmlFor="round-to-integer">Округлять до целого</Label>
            <Switch id="round-to-integer" checked={roundToInteger} onCheckedChange={setRoundToInteger} />
          </div>
        </CardContent>
      </Card>

      <MatchCard match={match} roundToInteger={roundToInteger} />

      <MatchAudit matchId={match.id} />

      {relatedMarkets.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-muted-foreground">Связанные ставки</h2>
          {relatedMarkets.map((market) => (
            <Link key={market.id} href={`/markets/view?id=${market.id}`}>
              <MarketCard market={market} className="hover:bg-accent transition-colors cursor-pointer" />
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}

function PendingMatchView({ clientId }: { clientId: Base58ID }) {
  const { pendingMatches, ready, isSyncing, deletePendingMatch } = useOffline();
  const { canEdit } = useMe();
  const { tenantId } = useTenantScope();
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const match = pendingMatches.find((m) => m.clientId === clientId);

  // `leavingRef` suppresses the "synced" toast when the user themselves deletes.
  const leavingRef = useRef(false);

  // The match is no longer in the pending store while we're on its page — a
  // sync saved it to the server under the same id. Stay put: the dispatcher
  // above re-renders into SavedMatchView, which fetches and shows the Elo
  // change (the whole reason to keep the user on this page).
  useEffect(() => {
    if (ready && !match && !leavingRef.current) {
      toast("Партия синхронизирована");
    }
  }, [ready, match]);

  if (!ready || !match) {
    return (
      <PageContainer width="narrow">
        <LoadingRows />
      </PageContainer>
    );
  }

  if (!match) return <NotFound />;

  return (
    <PageContainer width="narrow">
      <BackButton href="/?tab=feed" />

      <PageHeader
        title="Просмотр партии"
        action={canEdit ? <EditAction id={clientId} tenantId={tenantId} disabled={isSyncing} viaCalculator={!!match.calculatorKind} /> : undefined}
      />

      <PendingMatchCard match={match} />

      {canEdit && (
        <Button variant="destructive" size="sm" disabled={isSyncing} onClick={() => setDeleteOpen(true)}>
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
    </PageContainer>
  );
}
