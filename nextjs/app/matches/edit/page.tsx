"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toBase58ID } from "@/lib/id";
import { PageHeader } from "@/app/pageHeaderContext";
import { PageContainer } from "@/components/page-container";
import { LoadingRows } from "@/components/loading-rows";
import { useMatches } from "../MatchesContext";
import { useTenantScope } from "../../tenantScopeContext";
import { useTenants } from "@/app/tenantsContext";
import { useOffline } from "../../offline/OfflineContext";
import { useMe } from "@/app/meContext";
import { Match, getMatchByIdPromise } from "../../api";
import { matchEditInputs } from "@/lib/offline/match-entity";
import { useOpNameHelpers } from "@/hooks/useOpNameHelpers";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, AlertCircleIcon, Loader2 } from "lucide-react";
import { ErrorAlert } from "@/components/error-alert";
import { TenantChooser } from "@/components/tenant-chooser";
import { TenantsLoadError } from "@/components/tenants-load-error";
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
    const { pendingMatches, ready, updatePendingMatch, offline, syncNow, queueMatchUpdate, ops } = useOffline();
    const { matches, loading: matchesLoading } = useMatches();
    const me = useMe();
    // The edit belongs to a community (ADR-36): reads scope the settlement
    // columns to its main arena and the update validates that the match
    // still belongs to its feed — a tenantless edit does not work.
    const { tenant, tenantId, ready: tenantReady } = useTenantScope();
    // The tenant object resolves from the tenants list; a list that never
    // loaded (offline, API down) must not read as a deleted community.
    const { error: tenantsError } = useTenants();
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
        if (!needsDetail || fetchedRef.current || !tenantId) return;
        // For the generic-form path, matchFromContext already has everything we
        // need — skip the fetch.
        if (matchFromContext && !matchFromContext.calculator_kind) return;
        fetchedRef.current = true;
        getMatchByIdPromise(id, tenantId)
            .then(setMatchFromApi)
            .catch((e) => setFetchError(e.message ?? "Неизвестная ошибка"));
    }, [needsDetail, matchFromContext, id, tenantId]);

    const editSaved = matchFromApi ?? matchFromContext ?? undefined;
    // True while the detail fetch is in flight for a non-calculator saved match
    // (the calculator path is gated on calculator_data below).
    const fetchLoading = needsDetail && !editSaved && !fetchError;

    // A queued edit of this saved match (ADR-37): the form prefills from the
    // op-overlaid state — the user's latest intent, not the stale server read
    // — while the merge base stays the originally observed server state, so a
    // re-edit accumulates into the same op. Hooks sit before the early returns.
    const helpers = useOpNameHelpers();
    const savedOp = useMemo(
        () => (ops ?? []).find((o) => o.kind === "match" && o.entityId === id) ?? null,
        [ops, id],
    );
    const editSavedView = useMemo(
        () => (editSaved ? matchEditInputs(editSaved, savedOp, helpers).view : undefined),
        [editSaved, savedOp, helpers],
    );
    // The calculator branch's merge base, frozen the moment the editor's data
    // becomes complete — the same rule as MatchForm's sessionBase: a sync
    // landing mid-edit (the queued op applying and dropping) or another
    // user's change must not move it, so the submit merge flags exactly the
    // fields altered server-side since the user last observed the match.
    const [calcBase, setCalcBase] = useState<Record<string, unknown> | null | undefined>(undefined);
    useEffect(() => {
        if (calcBase !== undefined || !matchFromApi || !editSavedView?.calculator_data) return;
        const server = matchFromApi;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- freeze-once: the base must be the state the editor opened with, not the latest re-render
        setCalcBase(savedOp?.base ?? {
            game_id: server.game_id,
            date: server.dateISO ?? (server.date ? server.date.toISOString() : ""),
            score: Object.fromEntries(
                Object.entries(server.score).map(([pid, s]) => [pid, s.score ?? 0]),
            ),
            camp_arena_ids: server.camps.map((c) => c.id),
            calculator_kind: server.calculator_kind,
            calculator_data: server.calculator_data ?? null,
        });
    }, [calcBase, matchFromApi, editSavedView, savedOp]);

    if (!id) return null;

    // Tenantless edits are off (ADR-36): wait for the scope, then either the
    // chooser (one click stores the choice) or an unknown-tenant error.
    if (!tenant || !tenantId) {
        return (
            <PageContainer width="form">
                <PageHeader title="Редактирование партии" />
            {!tenantReady ? (
                <LoadingRows />
            ) : tenantId ? (
                tenantsError ? (
                    // The list failed to load — the community may well exist.
                    <TenantsLoadError />
                ) : (
                    <ErrorAlert message="Сообщество не найдено — возможно, оно было удалено." />
                )
            ) : (
                <TenantChooser />
            )}
            </PageContainer>
        );
    }

    // ── Calculator-backed pending match: dispatch to the calculator editor. ───
    // Saves go through updatePendingMatch (carrying the recomputed
    // calculator_data) — a queued create re-syncs whole.
    if (editPending?.calculatorKind) {
        const kind = editPending.calculatorKind;
        return (
            <CalculatorEdit
                kind={kind}
                storage={(editPending.calculatorData ?? {}) as Record<string, unknown>}
                readOnly={!me.canEdit}
                onSaved={() => router.push(`/matches/view?id=${editPending.clientId}&tenant=${tenantId}`)}
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
    // the generic MatchForm for a calculator-backed match. A queued edit
    // overlays the server read: the editor seeds from the op's calculator_data
    // (the user's latest state) and the merge base stays the op's original
    // base, so a re-edit accumulates.
    if (editSavedView?.calculator_kind) {
        const kind = editSavedView.calculator_kind;
        // calculator_data is absent from the list response, so wait for the
        // detail fetch — and for the store to hydrate, so the frozen base
        // sees the queued op's base: rendering the editor with empty data
        // would seed its useState from empty storage and never recover once
        // the fetch lands (useState initializer runs once).
        const server = matchFromApi;
        if (!ready || !editSavedView.calculator_data || !server || calcBase === undefined) {
            return (
                <PageContainer width="wide">
                    <LoadingRows />
                </PageContainer>
            );
        }
        return (
            <CalculatorEdit
                kind={kind}
                storage={(editSavedView.calculator_data ?? {}) as Record<string, unknown>}
                readOnly={!me.canEdit}
                onSaved={() => router.push(`/matches/view?id=${editSavedView.id}&tenant=${tenantId}`)}
                save={(state, adapter) => {
                    // One path for online and offline alike (ADR-37 revised):
                    // the edit queues as an op and the sync three-way-merges
                    // it against a fresh server read — online it runs right
                    // away. calculator_data travels as one whole field; the
                    // score map recomputes from the same calculator state, so
                    // the two can never drift apart. The calculator editor
                    // never edits the date: the base keeps the raw server
                    // string verbatim (µs precision) and the patch omits it.
                    // The base was frozen when the session opened (calcBase).
                    queueMatchUpdate(editSavedView.id, tenantId, calcBase ?? {
                        game_id: server.game_id,
                        date: server.dateISO ?? (server.date ? server.date.toISOString() : ""),
                        score: Object.fromEntries(
                            Object.entries(server.score).map(([pid, s]) => [pid, s.score ?? 0]),
                        ),
                        camp_arena_ids: server.camps.map((c) => c.id),
                        calculator_kind: server.calculator_kind,
                        calculator_data: server.calculator_data ?? null,
                    }, {
                        calculator_kind: kind,
                        calculator_data: adapter.toStorage(state),
                        score: adapter.scoreFromState(state),
                    });
                    if (!offline) syncNow();
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
                    key={editPending?.clientId ?? (editSavedView ? `saved:${editSavedView.id}` : "new")}
                    editPending={editPending}
                    editSaved={editSavedView}
                    editSavedBase={savedOp?.base ?? null}
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
