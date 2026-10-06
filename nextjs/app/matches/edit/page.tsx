"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toBase58ID } from "@/lib/id";
import { PageHeader } from "@/app/pageHeaderContext";
import { PageContainer } from "@/components/page-container";
import { LoadingRows } from "@/components/loading-rows";
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

import { getCalculator, type CalculatorAdapter, type CalculatorState } from "@/components/calculators/registry";

export default function MatchEditPage() {
    return (
        <Suspense>
            <MatchEditPageWrapped />
        </Suspense>
    );
}

function MatchEditPageWrapped() {
    const router = useRouter();
    const { pendingMatches, ready, updatePendingMatch } = useOffline();
    const { matches, loading: matchesLoading, invalidate: invalidateMatches } = useMatches();
    const { invalidate: invalidatePlayers } = usePlayers();
    const me = useMe();
    const searchParams = useSearchParams();
    const id = toBase58ID(searchParams.get("id") ?? "");

    // Editing needs a target; a bare /matches/edit falls back to the add hub.
    useEffect(() => {
        if (!id) router.replace("/new");
    }, [id, router]);

    // Offline (pending) target — wait for the store to hydrate before deciding.
    // Pending matches may now be calculator-backed (calculator_data is queued
    // offline), so a calculator-backed pending match routes to the calculator
    // editor instead of the generic form.
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
    // True while the detail fetch is in flight for a non-calculator saved match
    // (the calculator path is gated on calculator_data below).
    const fetchLoading = needsDetail && !editSaved && !fetchError;

    if (!id) return null;

    // ── Calculator-backed pending match: dispatch to the calculator editor. ───
    // Saves go through updatePendingMatch (carrying the recomputed
    // calculator_data) instead of updateMatchPromise.
    if (editPending?.calculatorKind) {
        const kind = editPending.calculatorKind;
        return (
            <CalculatorEdit
                kind={kind}
                storage={(editPending.calculatorData ?? {}) as Record<string, unknown>}
                readOnly={!me.canEdit}
                onSaved={() => router.push(`/matches/view?id=${editPending.clientId}`)}
                save={(state, adapter) =>
                    updatePendingMatch(editPending.clientId, {
                        gameId: editPending.gameId,
                        score: adapter.scoreFromState(state),
                        createdAt: editPending.createdAt,
                        campArenaIds: editPending.campArenaIds ?? [],
                        calculatorKind: kind,
                        calculatorData: adapter.toStorage(state),
                    })
                }
            />
        );
    }

    // ── Calculator-backed saved match: dispatch to the calculator editor. ────
    // The calculator UI is the single source of truth for scores here — every
    // save recomputes the score map from the calculator state, so the score and
    // calculator_data can never drift apart. There is intentionally NO path to
    // the generic MatchForm for a calculator-backed match.
    if (editSaved?.calculator_kind) {
        // calculator_data is absent from the list response, so wait for the
        // detail fetch: rendering the editor with empty data would seed its
        // useState from empty storage and never recover once the fetch lands
        // (useState initializer runs once).
        const match = matchFromApi;
        const kind = match?.calculator_kind;
        if (!match?.calculator_data || !kind) {
            return (
                <PageContainer width="wide">
                    <LoadingRows />
                </PageContainer>
            );
        }
        return (
            <CalculatorEdit
                kind={kind}
                storage={(match.calculator_data ?? {}) as Record<string, unknown>}
                readOnly={!me.canEdit}
                onSaved={() => router.push(`/matches/view?id=${match.id}`)}
                save={async (state, adapter) => {
                    await updateMatchPromise(match.id, {
                        game_id: match.game_id,
                        score: adapter.scoreFromState(state),
                        // The calculator editor never edits the date: resubmit the raw
                        // server string verbatim (µs precision) — a Date round-trip
                        // would truncate it to milliseconds.
                        date: match.dateISO ?? (match.date ? match.date.toISOString() : new Date().toISOString()),
                        calculator_kind: kind,
                        calculator_data: adapter.toStorage(state) as Record<string, never>,
                    });
                    invalidateMatches();
                    invalidatePlayers();
                }}
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
        <PageContainer width="form">
            <PageHeader title={title} />
            <MatchFormAuthAlerts />
            {isSaved && !editSaved && fetchError ? (
                <Alert variant="destructive">
                    <AlertCircleIcon />
                    <AlertDescription>Ошибка: {fetchError}</AlertDescription>
                </Alert>
            ) : (isSaved && !editSaved && (fetchLoading || matchesLoading)) || (!ready && !!id) ? (
                <LoadingRows />
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
        </PageContainer>
    );
}

// CalculatorEdit renders the calculator editor shared by the saved-match and
// offline-pending dispatches above. The rendering is identical for both; only
// the persist call differs, which the caller supplies as `save`. The calculator
// UI is the single source of truth for scores — every save recomputes the score
// map from the calculator state, so score and calculator_data can never drift
// apart. Read-only users can view but cannot save.
function CalculatorEdit({
    kind,
    storage,
    readOnly,
    save,
    onSaved,
}: {
    kind: string;
    storage: Record<string, unknown>;
    readOnly: boolean;
    save: (state: CalculatorState, adapter: CalculatorAdapter) => Promise<void> | void;
    onSaved: () => void;
}) {
    const adapter = getCalculator(kind);
    const [state, setState] = useState<CalculatorState | null>(null);
    const [saving, setSaving] = useState(false);

    async function handleSave() {
        if (!adapter || state === null) return;
        setSaving(true);
        try {
            await save(state, adapter);
            toast.success("Партия обновлена");
            onSaved();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    }

    const title = adapter?.editTitle ?? "Редактирование партии";

    return (
        <PageContainer width="wide">
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

            {adapter ? (
                <adapter.History
                    storage={storage}
                    readOnly={readOnly}
                    onStateChange={setState}
                />
            ) : (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                        Неизвестный тип калькулятора: {kind}
                    </AlertDescription>
                </Alert>
            )}

            {!readOnly && adapter && (
                <Button className="w-full" disabled={saving} onClick={handleSave}>
                    {saving ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Сохранение…</>) : "Сохранить изменения"}
                </Button>
            )}
        </PageContainer>
    );
}
