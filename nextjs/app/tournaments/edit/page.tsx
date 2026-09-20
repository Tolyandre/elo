"use client";

import Link from "next/link";
import { useState } from "react";
import { toBase58ID, type Base58ID } from "@/lib/id";
import { useUrlQuery } from "@/lib/url-state";
import { getTournamentBracketPromise, getTournamentPromise } from "@/app/api";import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useMe } from "@/app/meContext";
import { AdminPageTabs } from "@/components/admin/admin-page-tabs";
import { BackButton } from "@/components/back-button";
import { ErrorAlert } from "@/components/error-alert";
import { LoginLink } from "@/components/login-link";
import { Skeleton } from "@/components/ui/skeleton";
import { tournamentStatusLabel } from "../labels";
import { RegistrationEditor } from "./registration-editor";
import { ShapePicker } from "./shape-picker";
import { RunningEditor } from "./running-editor";
import { CancelButton } from "./cancel-button";

/**
 * The organizer administration page (ADR-26 §UI): during registration —
 * config + the bracket shape picker; while running — slot adjustments,
 * rulings and attach/detach; the audit feed lives on the «Журнал» tab
 * (shared AdminPageTabs, entity type "tournament").
 */
export default function TournamentEditPage() {
    const params = useUrlQuery();
    const id = toBase58ID(params.get("id") ?? "");
    const { canEdit, loading: meLoading } = useMe();

    if (!id) {
        return (
            <main className="max-w-sm mx-auto space-y-4">
                <BackButton href="/arenas?tab=tournaments" label="Назад к турнирам" />
                <p className="text-muted-foreground">Турнир не найден — проверьте ссылку.</p>
            </main>
        );
    }

    return (
        <main className="max-w-sm mx-auto space-y-4">
            <BackButton href="/arenas?tab=tournaments" label="Назад к турнирам" />
            {!meLoading && !canEdit && (
                <div className="space-y-2">
                    <ErrorAlert message="Управлять турниром могут только редакторы" />
                    <LoginLink />
                </div>
            )}
            {canEdit && <TournamentEditLoaded tournamentId={id} />}
        </main>
    );
}

function TournamentEditLoaded({ tournamentId }: { tournamentId: Base58ID }) {
    const { data, loading, error, invalidate } = useAsyncResource(async () => {
        const tournament = await getTournamentPromise(tournamentId);
        const bracket = await getTournamentBracketPromise(tournamentId);
        return { tournament, bracket };
    }, [tournamentId]);

    // The registration editor's draft vs the saved tournament: while it holds
    // unsaved changes, the shape picker must not start — a plan computed from
    // the saved state would silently drop the draft (e.g. a new participant).
    const [unsavedConfig, setUnsavedConfig] = useState(false);

    if (error) return <ErrorAlert message={error} />;
    if (loading || !data) {
        return (
            <div className="space-y-2">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-48 w-full rounded-xl" />
            </div>
        );
    }

    const { tournament, bracket } = data;

    return (
        <AdminPageTabs entityType="tournament" entityId={tournamentId} mainLabel="Турнир">
            <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    {tournament.name} · {tournamentStatusLabel(tournament.status)} ·{" "}
                    <Link href={`/tournaments/view?id=${tournament.id}`} className="underline">
                        страница турнира
                    </Link>
                </p>
                {tournament.status === "registration" && (
                    <>
                        <RegistrationEditor
                            tournament={tournament}
                            onSaved={invalidate}
                            onUnsavedChange={setUnsavedConfig}
                        />
                        <ShapePicker tournament={tournament} unsavedChanges={unsavedConfig} onStarted={invalidate} />
                        <CancelButton tournament={tournament} onDone={invalidate} />
                    </>
                )}
                {tournament.status === "running" && (
                    <>
                        <RunningEditor tournament={tournament} bracket={bracket} invalidate={invalidate} />
                        <CancelButton tournament={tournament} onDone={invalidate} />
                    </>
                )}
                {(tournament.status === "completed" || tournament.status === "cancelled") && (
                    <p className="text-sm text-muted-foreground">
                        Турнир {tournament.status === "completed" ? "завершён" : "отменён"} — конфигурация
                        доступна только для чтения.
                    </p>
                )}
            </div>
        </AdminPageTabs>
    );
}
