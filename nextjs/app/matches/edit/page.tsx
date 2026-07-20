"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/app/pageHeaderContext";
import { useMatches } from "../MatchesContext";
import { useOffline } from "../../offline/OfflineContext";
import { useMe } from "@/app/meContext";
import { usePlayers } from "@/app/players/PlayersContext";
import { Match, getMatchByIdPromise, updateMatchPromise } from "../../api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, AlertCircleIcon, Loader2 } from "lucide-react";
import { MatchForm, MatchFormAuthAlerts } from "../MatchForm";
import { AuthWarning } from "@/components/auth-warning";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

import { SkullKingHistory, skullKingScoreFromState, skullKingToStorage } from "./skull-king-history";
import { IawwHistory, iawwScoreFromState, iawwToStorage } from "./iaww-history";
import type { SkullKingStorage } from "@/components/calculators/skull-king/storage";
import type { IAWWStorage } from "@/components/calculators/iaww/storage";
import type { GameState as SKGameState } from "@/components/calculators/skull-king";
import type { GameState as IawwGameState } from "@/components/calculators/iaww/scoring";

export default function MatchEditPage() {
    return (
        <Suspense>
            <MatchEditPageWrapped />
        </Suspense>
    );
}

function MatchEditPageWrapped() {
    const router = useRouter();
    const { pendingMatches, ready } = useOffline();
    const { matches, loading: matchesLoading, invalidate: invalidateMatches } = useMatches();
    const { invalidate: invalidatePlayers } = usePlayers();
    const me = useMe();
    const searchParams = useSearchParams();
    const id = searchParams.get("id");

    // Editing needs a target; a bare /matches/edit is the dedicated "new match" route.
    useEffect(() => {
        if (!id) router.replace("/matches/new");
    }, [id, router]);

    // Offline (pending) target — wait for the store to hydrate before deciding.
    // Pending matches are never calculator-backed (calculator_data is not queued
    // offline — see ADR-09), so the pending path always uses MatchForm.
    const editPending = ready ? pendingMatches.find((m) => m.clientId === id) : undefined;
    const isSaved = !!id && ready && !editPending;

    // If the pending match we're editing gets synced (removed) mid-edit, the same
    // UUID now exists on the server, so fall through to the saved-match path below
    // rather than dead-ending the form.

    // Saved target — context first, then API. For calculator-backed matches we
    // always need the API detail fetch (calculator_data is omitted from the list
    // response to keep payloads small), so the short-circuit on matchFromContext
    // only applies to the generic-form path.
    const matchFromContext = isSaved ? matches.find((m) => m.id === id) ?? null : null;
    const [matchFromApi, setMatchFromApi] = useState<Match | null>(null);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const fetchedRef = useRef(false);

    // If the list context already told us this is a calculator-backed match, we
    // must fetch detail (calculator_data is missing from the list response).
    const needsDetail = isSaved && (!!matchFromContext?.calculator_kind || !matchFromContext);

    useEffect(() => {
        if (!needsDetail || fetchedRef.current) return;
        // For the generic-form path, matchFromContext already has everything we
        // need — skip the fetch.
        if (matchFromContext && !matchFromContext.calculator_kind) return;
        fetchedRef.current = true;
        getMatchByIdPromise(id)
            .then(setMatchFromApi)
            .catch((e) => setFetchError(e.message ?? "Неизвестная ошибка"));
    }, [needsDetail, matchFromContext, id]);

    const editSaved = matchFromApi ?? matchFromContext ?? undefined;
    // We need calculator_data (absent from the list response) before we can
    // render the calculator editor — so for calculator-backed matches we wait
    // for the detail fetch to resolve. Rendering CalculatorEdit with empty data
    // would seed its useState from empty storage and never recover once the
    // fetch lands (useState initializer runs once).
    const calculatorReady = !!editSaved?.calculator_kind && !!matchFromApi?.calculator_data;
    // True while the detail fetch is in flight for a non-calculator saved match
    // (the calculator path is gated by calculatorReady above).
    const fetchLoading = needsDetail && !editSaved && !fetchError;

    if (!id) return null;

    // ── Calculator-backed saved match: dispatch to the calculator editor. ────
    // The calculator UI is the single source of truth for scores here — every
    // save recomputes the score map from the calculator state, so the score and
    // calculator_data can never drift apart. There is intentionally NO path to
    // the generic MatchForm for a calculator-backed match.
    if (editSaved?.calculator_kind) {
        if (!calculatorReady) {
            return (
                <main className="max-w-sm mx-auto p-4">
                    <p className="text-center">Загрузка…</p>
                </main>
            );
        }
        return (
            <CalculatorEdit
                match={matchFromApi}
                readOnly={!me.canEdit}
                onSaved={() => router.push(`/matches/view?id=${matchFromApi.id}`)}
                invalidateMatches={invalidateMatches}
                invalidatePlayers={invalidatePlayers}
            />
        );
    }

    // ── Generic-form path: pending offline match, or a saved match without ────
    // calculator_data, or a brand-new match.

    const title = editSaved
        ? "Редактирование партии"
        : editPending
            ? "Редактирование несохранённой партии"
            : "Результат партии";

    return (
        <main className="max-w-sm mx-auto p-4">
            <PageHeader title={title} />
            <MatchFormAuthAlerts />
            {isSaved && !editSaved && fetchError ? (
                <Alert variant="destructive">
                    <AlertCircleIcon />
                    <AlertDescription>Ошибка: {fetchError}</AlertDescription>
                </Alert>
            ) : (isSaved && !editSaved && (fetchLoading || matchesLoading)) || (!ready && !!id) ? (
                <p className="text-center">Загрузка...</p>
            ) : (
                // When ?id= points to a pending match that no longer exists (already
                // synced or deleted), editPending is undefined and we fall back to the
                // normal "add a new match" form instead of a dead-end error.
                <MatchForm
                    key={editPending?.clientId ?? (editSaved ? `saved:${editSaved.id}` : "new")}
                    editPending={editPending}
                    editSaved={editSaved}
                />
            )}
        </main>
    );
}

// CalculatorEdit is the saved-match calculator editor. It re-opens the saved
// calculator state so the user can tweak the round/cell breakdown; saving
// recomputes score from the calculator state and PUTs both together. Read-only
// users can view but cannot save.
function CalculatorEdit({
    match,
    readOnly,
    onSaved,
    invalidateMatches,
    invalidatePlayers,
}: {
    match: Match;
    readOnly: boolean;
    onSaved: () => void;
    invalidateMatches: () => void;
    invalidatePlayers: () => void;
}) {
    const kind = match.calculator_kind!;
    const data = (match.calculator_data ?? {}) as Record<string, unknown>;
    const [skState, setSkState] = useState<SKGameState | null>(null);
    const [iawwState, setIawwState] = useState<IawwGameState | null>(null);
    const [saving, setSaving] = useState(false);

    async function handleSave() {
        setSaving(true);
        try {
            let score: Record<string, number>;
            let calcData: Record<string, never>;
            if (kind === "skull-king") {
                if (!skState) return;
                score = skullKingScoreFromState(skState);
                calcData = skullKingToStorage(skState) as unknown as Record<string, never>;
            } else if (kind === "iaww") {
                if (!iawwState) return;
                score = iawwScoreFromState(iawwState);
                calcData = iawwToStorage(iawwState) as unknown as Record<string, never>;
            } else {
                return;
            }
            await updateMatchPromise(match.id, {
                game_id: match.game_id,
                score,
                date: match.date ? match.date.toISOString() : new Date().toISOString(),
                calculator_kind: kind,
                calculator_data: calcData,
            });
            invalidateMatches();
            invalidatePlayers();
            toast.success("Партия обновлена");
            onSaved();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    }

    const title = kind === "skull-king"
        ? "Skull King — редактирование"
        : kind === "iaww"
            ? "Этот Безумный Мир — редактирование"
            : "Редактирование партии";

    return (
        <main className="max-w-5xl mx-auto p-3 sm:p-4 space-y-4">
            <AuthWarning />
            <PageHeader title={title} />
            {readOnly && (
                <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Только просмотр</AlertTitle>
                    <AlertDescription>
                        У вас нет прав на редактирование — изменения нельзя сохранить.
                    </AlertDescription>
                </Alert>
            )}

            {kind === "skull-king" && (
                <SkullKingHistory
                    storage={data as unknown as SkullKingStorage}
                    readOnly={readOnly}
                    onStateChange={setSkState}
                />
            )}
            {kind === "iaww" && (
                <IawwHistory
                    storage={data as unknown as IAWWStorage}
                    readOnly={readOnly}
                    onStateChange={setIawwState}
                />
            )}
            {kind !== "skull-king" && kind !== "iaww" && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                        Неизвестный тип калькулятора: {kind}
                    </AlertDescription>
                </Alert>
            )}

            {!readOnly && (kind === "skull-king" || kind === "iaww") && (
                <Button className="w-full" disabled={saving} onClick={handleSave}>
                    {saving ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Сохранение…</>) : "Сохранить изменения"}
                </Button>
            )}
        </main>
    );
}
