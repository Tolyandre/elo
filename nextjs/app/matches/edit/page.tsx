"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/app/pageHeaderContext";
import { useRouter, useSearchParams } from "next/navigation";
import { useMatches } from "../MatchesContext";
import { useOffline } from "../../offline/OfflineContext";
import { Match, getMatchByIdPromise } from "../../api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircleIcon } from "lucide-react";
import { MatchForm, MatchFormAuthAlerts } from "../MatchForm";

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
    const { matches, loading: matchesLoading } = useMatches();
    const searchParams = useSearchParams();
    const id = searchParams.get("id");

    // Editing needs a target; a bare /matches/edit is the dedicated "new match" route.
    useEffect(() => {
        if (!id) router.replace("/matches/new");
    }, [id, router]);

    // Offline (pending) target — wait for the store to hydrate before deciding.
    const editPending = ready ? pendingMatches.find((m) => m.clientId === id) : undefined;
    const isSaved = !!id && ready && !editPending;

    // If the pending match we're editing gets synced (removed) mid-edit, the same
    // UUID now exists on the server, so fall through to the saved-match path below
    // rather than dead-ending the form.

    // Saved target — context first, then API (same pattern as the detail page).
    const matchFromContext = isSaved ? matches.find((m) => m.id === id) ?? null : null;
    const [matchFromApi, setMatchFromApi] = useState<Match | null>(null);
    const [fetchLoading, setFetchLoading] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const fetchedRef = useRef(false);
    useEffect(() => {
        if (!isSaved || matchFromContext || fetchedRef.current || matchesLoading) return;
        fetchedRef.current = true;
        setFetchLoading(true);
        getMatchByIdPromise(id)
            .then(setMatchFromApi)
            .catch((e) => setFetchError(e.message ?? "Неизвестная ошибка"))
            .finally(() => setFetchLoading(false));
    }, [isSaved, matchFromContext, matchesLoading, id]);
    const editSaved = matchFromApi ?? matchFromContext ?? undefined;

    if (!id) return null;

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
