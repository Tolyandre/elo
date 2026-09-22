"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMe } from "@/app/meContext";
import { useOffline } from "@/app/offline/OfflineContext";
import { useCampSelection } from "@/hooks/useCampSelection";
import { useTableSession, waitForSyncedMatch } from "@/hooks/useTableSession";
import { useTableDeepLink } from "@/hooks/useTableDeepLink";
import type { TableGameState } from "@/app/api";
import { tableGameByTable, type TableMatchPayload } from "@/components/tables/registry";
import { deleteTablePromise } from "@/app/api";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/app/pageHeaderContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthWarning } from "@/components/auth-warning";
import { TableStatusBanner } from "@/components/tables/table-status-banner";
import { TakeoverButton } from "@/components/tables/takeover-button";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

// ─── The unified live-table page (ADR-16) ────────────────────────────────────
//
// One page serves every game: the game is resolved from the bound table's
// game_id and rendered through the game-app registry. The shell owns
// everything shared — the session (host / connected player / viewer), the
// deep-link binding, SSE-driven state, the header chrome (takeover, delete),
// the save flow and the camp selection — and hands the game view a typed
// harness (TableGameViewProps).

function ConnectingCard() {
    return (
        <Card>
            <CardContent className="py-8 flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Подключение к столу...</span>
            </CardContent>
        </Card>
    );
}

function EmptyStateCard() {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Нет активного стола</CardTitle>
                <CardDescription>
                    Создайте новый стол, выбрав игру и участников, или откройте
                    запущенный стол из лобби «Сейчас играют» на главной.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Button asChild className="w-full">
                    <Link href="/matches/new?tab=table">Создать стол</Link>
                </Button>
            </CardContent>
        </Card>
    );
}

/** A table created by an older client, whose participants were picked in-app. */
function LegacySetupCard() {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Стол создан в старой версии</CardTitle>
                <CardDescription>
                    Участники теперь выбираются при создании стола. Создайте новый
                    стол и выберите участников там.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Button asChild className="w-full">
                    <Link href="/matches/new?tab=table">Создать новый стол</Link>
                </Button>
            </CardContent>
        </Card>
    );
}

function UnknownGameCard() {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Игра этого стола недоступна</CardTitle>
                <CardDescription>
                    Возможно, приложение устарело — обновите страницу.
                </CardDescription>
            </CardHeader>
        </Card>
    );
}

export function TablePage() {
    const me = useMe();
    const router = useRouter();
    const { submitMatch } = useOffline();

    // Table session (ADR-15/ADR-16), server-only: no local game-state
    // persistence — a reload resumes from the SSE connect snapshot.
    const {
        hydrated,
        session,
        gameState,
        table,
        connectedPlayerIds,
        setSession,
        resetTableSession,
        joinTable,
        takeoverHosting,
        syncHostState,
        submitInput,
        savedMatchId,
        closed,
        connected,
    } = useTableSession({ me: { id: me.id, playerId: me.playerId } });

    // URL bindings (ADR-18): ?id=<id> is the sticky shareable binding — a
    // stored session on that table resumes as-is, otherwise the table is
    // joined (or watched read-only by a visitor who cannot join). No param
    // resumes a stored session, else the empty state.
    useTableDeepLink({
        hydrated,
        session,
        me: { isAuthenticated: me.isAuthenticated, playerId: me.playerId },
        setSession,
        joinTable,
        resetTableSession,
    });

    // ADR-15: only a stored host session renders as host. A connected player
    // stays connected until they leave the table; losing the session can no
    // longer silently promote them.
    const isHost = session?.isHost ?? false;
    const myPlayerIndex = session?.myPlayerIndex ?? null;

    // Host mutation flags (buttons disable + show a spinner).
    const [isSyncing, setIsSyncing] = useState(false);
    const [isTransitioning, setIsTransitioning] = useState(false);

    // Connected player: when the host saves the match, the server broadcasts a
    // "saved" event carrying the new match id. Redirect to that match's view
    // page and tear down the local session. The host handles its own redirect
    // in saveMatch, so this effect is a no-op for the host.
    useEffect(() => {
        if (!savedMatchId || session?.isHost !== false) return;
        resetTableSession();
        router.push(`/matches/view?id=${savedMatchId}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [savedMatchId]);

    // The host closed the table without saving: connected players go back to
    // the matches lobby (rejoining happens from there). The hook already
    // toasted and cleared the session.
    useEffect(() => {
        if (!closed || session?.isHost !== false) return;
        router.push("/?tab=matches");
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [closed]);

    // Fire-and-forget host mutation with the syncing flag (cell edits, tab
    // switches and similar UI state).
    const setGameState = useCallback((updater: (prev: TableGameState) => TableGameState) => {
        void (async () => {
            setIsSyncing(true);
            try {
                await syncHostState(updater);
            } finally {
                setIsSyncing(false);
            }
        })();
    }, [syncHostState]);

    // Async phase transition: applies the updater locally and awaits the
    // versioned server sync (with one automatic conflict merge + retry).
    const doPhaseTransition = useCallback(async (updater: (prev: TableGameState) => TableGameState) => {
        setIsTransitioning(true);
        try {
            await syncHostState(updater);
        } finally {
            setIsTransitioning(false);
        }
    }, [syncHostState]);

    // Claim hosting (edit permission; idempotent for the account that already
    // hosts — the second-device host scenario).
    const [isTakingOver, setIsTakingOver] = useState(false);
    async function handleTakeover() {
        setIsTakingOver(true);
        try {
            await takeoverHosting();
            toast.success("Вы ведущий");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        } finally {
            setIsTakingOver(false);
        }
    }

    // Host: confirm + delete the server table, then return to the matches
    // lobby (rejoining happens from there; new tables are created from
    // /matches/new).
    const [isResetting, setIsResetting] = useState(false);
    const [resetDialogOpen, setResetDialogOpen] = useState(false);
    async function closeTable() {
        if (session?.isHost && session.tableId) {
            setIsResetting(true);
            try { await deleteTablePromise(session.tableId); }
            catch { /* ignore */ }
            finally { setIsResetting(false); }
        }
        resetTableSession();
        setSaveError("");
        router.push("/?tab=matches");
    }

    // Camp selection for the saved match (ADR-27): default-checked by
    // participation, freely toggleable by the host.
    const campDate = useMemo(() => new Date(), []);
    const campPlayerIds = useMemo(() => gameState?.players.map((p) => p.id) ?? [], [gameState]);
    const campSelection = useCampSelection(campPlayerIds, campDate);

    // Save flow (host): queue the match through the offline-sync engine, wait
    // until it exists server-side (DeleteTable broadcasts its id to the
    // connected players, who open the saved match right away), then tear the
    // table down and open the saved match.
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState("");
    const entry = table ? tableGameByTable(table) : undefined;
    const saveMatch = useCallback(async (payload: TableMatchPayload) => {
        if (!entry || !table || !session?.tableId) return;
        setSaving(true);
        setSaveError("");
        try {
            const result = await submitMatch({
                game_id: table.game_id,
                score: payload.score,
                camp_arena_ids: campSelection.idsToSubmit(),
                calculator_kind: entry.calculatorKind,
                calculator_data: payload.calculatorData,
            });
            if (await waitForSyncedMatch(result.id)) {
                try { await deleteTablePromise(session.tableId, result.id); } catch { /* ignore */ }
            }
            resetTableSession();
            router.push(`/matches/view?id=${result.id}`);
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable per bound table; campSelection toggles live in its own state
    }, [entry, table, session?.tableId, submitMatch, campSelection.idsToSubmit, resetTableSession, router]);

    // ── Render dispatch ──────────────────────────────────────────────────────

    // Until localStorage hydration completes — or until the bound session's
    // first server snapshot arrives — the mode and game are unknown; show a
    // placeholder instead of flashing the wrong UI.
    const connecting = !hydrated || (!!session && (table === null || table.id !== session.tableId));
    const legacySetup = gameState?.phase === "setup";

    let body: ReactNode;
    if (connecting) {
        body = <ConnectingCard />;
    } else if (!session) {
        body = <EmptyStateCard />;
    } else if (legacySetup) {
        body = <LegacySetupCard />;
    } else if (!entry || !gameState) {
        body = <UnknownGameCard />;
    } else {
        const Extras = entry.headerExtras;
        body = (
            <>
                <PageHeader
                    title={entry.title}
                    action={
                        <div className="flex items-center gap-2">
                            {Extras && <Extras />}
                            {!isHost && me.canEdit && (
                                <TakeoverButton busy={isTakingOver} onConfirm={handleTakeover} />
                            )}
                            {isHost && (
                                <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="destructive" size="sm">Удалить стол</Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Удалить стол?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Результаты текущей партии будут удалены. Новый стол создаётся
                                                на странице добавления партии, вкладка «Стол».
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel disabled={isResetting}>Отмена</AlertDialogCancel>
                                            <AlertDialogAction
                                                variant="destructive"
                                                disabled={isResetting}
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    closeTable().then(() => setResetDialogOpen(false));
                                                }}
                                            >
                                                {isResetting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Удалить"}
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            )}
                        </div>
                    }
                />
                {/* Only the host can save; a connected player can't, so the auth
                    warning is irrelevant for them. */}
                {isHost && <AuthWarning table />}
                {/* Connection status */}
                <TableStatusBanner connected={connected} />
                <entry.view
                    gameState={gameState}
                    table={table}
                    isHost={isHost}
                    myPlayerIndex={myPlayerIndex}
                    connectedPlayerIds={connectedPlayerIds}
                    sseConnected={connected}
                    isSyncing={isSyncing}
                    isTransitioning={isTransitioning}
                    syncHostState={syncHostState}
                    doPhaseTransition={doPhaseTransition}
                    setGameState={setGameState}
                    submitInput={submitInput}
                    campSelection={campSelection}
                    me={{ isAuthenticated: me.isAuthenticated, playerId: me.playerId, id: me.id, canEdit: me.canEdit }}
                    saving={saving}
                    saveError={saveError}
                    saveMatch={saveMatch}
                />
            </>
        );
    }

    return (
        // Compact column only on narrow portrait phones; landscape phones and
        // tablets use the full shell width (the score table stretches with it).
        <main className="max-w-sm sm:max-w-5xl landscape:max-w-5xl mx-auto space-y-4 overflow-x-hidden">
            {body}
        </main>
    );
}
