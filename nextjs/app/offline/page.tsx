"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import type { Base58ID } from "@/lib/id";
import { useOffline } from "../offline/OfflineContext";
import { useMe } from "../meContext";
import { PendingMatchCard } from "@/components/pending-match-card";
import { PendingEntityList } from "@/components/pending-entity-list";
import { ConflictPanel } from "@/components/offline/conflict-panel";
import { PageHeader } from "@/app/pageHeaderContext";
import { PageContainer } from "@/components/page-container";
import { SectionHeader } from "@/components/section-header";
import { EmptyState } from "@/components/empty-state";
import { LoadingRows } from "@/components/loading-rows";
import { BackButton } from "@/components/back-button";
import { LoginLink } from "@/components/login-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    AlertCircle,
    CloudOff,
    Pencil,
    Eye,
    Trash2,
    SplitSquareHorizontal,
    AlertTriangle,
} from "lucide-react";

/**
 * The offline queue page (ADR-37): every pending item on this device with its
 * sync status, the sync errors, and field-level conflict resolution. Reached
 * through the header's crossed-cloud indicator; sync never opens merge
 * dialogs mid-UX — conflicted items wait here for a deliberate decision.
 */
export default function OfflineQueuePage() {
    return (
        <Suspense>
            <OfflineQueuePageWrapped />
        </Suspense>
    );
}

function OfflineQueuePageWrapped() {
    const {
        pendingMatches,
        pendingPlayers,
        pendingGames,
        ops,
        pendingCount,
        errorCount,
        conflictCount,
        ready,
        offline,
        isOnline,
        apiReachable,
        dataFromCache,
        isSyncing,
        authRequired,
        syncNow,
        resolvePendingConflict,
        resolveOpConflict,
        deleteOp,
        deletePendingMatch,
        updatePendingPlayer,
        deletePendingPlayer,
        updatePendingGame,
        deletePendingGame,
    } = useOffline();
    const { isAuthenticated, canEdit, loading: meLoading } = useMe();

    const [deleteMatchId, setDeleteMatchId] = useState<Base58ID | null>(null);

    // Same signals the header indicator uses (ADR-16): crossed cloud when
    // offline or when reads come from the cache between pings.
    const staleReads = !offline && dataFromCache;
    const apiDown = isOnline && apiReachable === false;

    const conflictMatches = pendingMatches.filter((m) => m.status === "conflict");
    const conflictPlayers = pendingPlayers.filter((p) => p.status === "conflict");
    const conflictGames = pendingGames.filter((g) => g.status === "conflict");
    // Ops (ADR-37 phase 7): conflicted updates resolve through the same
    // per-field panel; a conflicted delete asks for an explicit «удалить
    // всё равно». The rest render in the «Изменения» section.
    const conflictUpdateOps = ops.filter((o) => o.status === "conflict" && o.op === "update");
    const conflictDeleteOps = ops.filter((o) => o.status === "conflict" && o.op === "delete");
    const plainOps = ops.filter((o) => o.status !== "conflict");
    const hasConflicts = conflictCount > 0;
    // Conflicted items render in the Конфликты section with their resolution
    // panels; the regular lists show only the rest.
    const plainMatches = pendingMatches.filter((m) => m.status !== "conflict");

    const canMutate = isAuthenticated && canEdit;

    const opTitle = (op: (typeof ops)[number]): string => {
        const name = ((op.patch?.name ?? op.base?.name) as string | undefined) ?? op.entityId;
        const verb = op.op === "delete" ? "Удаление" : "Изменение";
        if (op.kind === "player") return `${verb} игрока «${name}»`;
        if (op.kind === "game") return `${verb} игры «${name}»`;
        return `${verb} партии`;
    };

    if (!ready) {
        return (
            <PageContainer width="wide">
                <LoadingRows />
            </PageContainer>
        );
    }

    return (
        <PageContainer width="wide">
            <BackButton href="/" />
            <PageHeader
                title="Офлайн-очередь"
                icon={<CloudOff className="h-6 w-6 shrink-0" />}
                action={
                    !offline && pendingCount > 0 && canMutate ? (
                        <Button size="sm" onClick={syncNow} disabled={isSyncing}>
                            {isSyncing ? "Сохранение..." : "Сохранить на сервере"}
                        </Button>
                    ) : undefined
                }
            />

            {!isOnline && (
                <Alert className="mb-4">
                    <CloudOff className="h-4 w-4" />
                    <AlertDescription>Нет сети. Вы видите кэшированные данные.</AlertDescription>
                </Alert>
            )}
            {apiDown && (
                <Alert className="mb-4">
                    <CloudOff className="h-4 w-4" />
                    <AlertDescription>Сервер API недоступен. Вы видите кэшированные данные.</AlertDescription>
                </Alert>
            )}
            {staleReads && (
                <Alert className="mb-4">
                    <CloudOff className="h-4 w-4" />
                    <AlertDescription>
                        Медленное соединение — данные загружены из кэша и могут быть устаревшими.
                    </AlertDescription>
                </Alert>
            )}
            {authRequired && (
                <Alert className="mb-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>Сессия истекла — войдите снова, чтобы сохранить на сервере.</AlertDescription>
                </Alert>
            )}

            {pendingCount === 0 ? (
                <EmptyState icon={CloudOff} title="Очередь пуста — все данные сохранены">
                    <p className="text-sm text-muted-foreground">
                        Записи появляются здесь, когда партия, игрок или игра созданы без связи с сервером.
                    </p>
                </EmptyState>
            ) : (
                <>
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                        <Badge variant="secondary">в очереди: {pendingCount}</Badge>
                        {errorCount > 0 && (
                            <Badge variant="destructive">с ошибками: {errorCount}</Badge>
                        )}
                        {hasConflicts && (
                            <Badge variant="destructive">
                                <SplitSquareHorizontal />
                                конфликтов: {conflictCount}
                            </Badge>
                        )}
                    </div>

                    {!meLoading && !isAuthenticated && (
                        <div className="flex flex-col items-start gap-2 mb-4">
                            <p className="text-sm">Для отправки на сервер необходимо авторизоваться.</p>
                            <LoginLink />
                        </div>
                    )}
                    {!meLoading && isAuthenticated && !canEdit && (
                        <p className="text-sm mb-4">У вас нет прав для отправки записей на сервер.</p>
                    )}

                    {hasConflicts && (
                        <section className="mb-8">
                            <SectionHeader className="mb-3">Конфликты</SectionHeader>
                            <Alert className="mb-3" variant="default">
                                <AlertTriangle className="h-4 w-4" />
                                <AlertDescription>
                                    Эти записи были изменены и на этом устройстве, и на сервере. Выберите
                                    значение для каждого поля — запись отправится после разрешения.
                                </AlertDescription>
                            </Alert>
                            {conflictMatches.map((m) => (
                                <div key={m.clientId} className="mb-3">
                                    <PendingMatchCard match={m} />
                                    <ConflictPanel
                                        fields={m.conflict ?? []}
                                        disabled={isSyncing || !canMutate}
                                        onResolve={(resolutions) =>
                                            resolvePendingConflict("match", m.clientId, resolutions)
                                        }
                                    />
                                </div>
                            ))}
                            {conflictPlayers.map((p) => (
                                <div key={p.clientId} className="mb-3 border border-dashed rounded p-3">
                                    <div className="font-medium">{p.name}</div>
                                    <ConflictPanel
                                        fields={p.conflict ?? []}
                                        disabled={isSyncing || !canMutate}
                                        onResolve={(resolutions) =>
                                            resolvePendingConflict("player", p.clientId, resolutions)
                                        }
                                    />
                                </div>
                            ))}
                            {conflictGames.map((g) => (
                                <div key={g.clientId} className="mb-3 border border-dashed rounded p-3">
                                    <div className="font-medium">{g.name}</div>
                                    <ConflictPanel
                                        fields={g.conflict ?? []}
                                        disabled={isSyncing || !canMutate}
                                        onResolve={(resolutions) =>
                                            resolvePendingConflict("game", g.clientId, resolutions)
                                        }
                                    />
                                </div>
                            ))}
                            {conflictUpdateOps.map((op) => (
                                <div key={op.entityId} className="mb-3 border border-dashed rounded p-3">
                                    <div className="font-medium">{opTitle(op)}</div>
                                    <ConflictPanel
                                        fields={op.conflict ?? []}
                                        disabled={isSyncing || !canMutate}
                                        onResolve={(resolutions) => resolveOpConflict(op.entityId, resolutions)}
                                    />
                                </div>
                            ))}
                            {conflictDeleteOps.map((op) => (
                                <div key={op.entityId} className="mb-3 border border-dashed rounded p-3 space-y-2">
                                    <div className="font-medium">{opTitle(op)}</div>
                                    {(op.conflict ?? []).map((f) => (
                                        <div key={f.field} className="text-sm">
                                            <span className="text-muted-foreground">На сервере изменилось — теперь: </span>
                                            <span className="font-medium">{f.theirs}</span>
                                        </div>
                                    ))}
                                    <div className="flex gap-2">
                                        <Button
                                            variant="destructive"
                                            size="xs"
                                            disabled={isSyncing || !canMutate}
                                            onClick={() =>
                                                resolveOpConflict(
                                                    op.entityId,
                                                    Object.fromEntries((op.conflict ?? []).map((f) => [f.field, f.theirs])),
                                                )
                                            }
                                        >
                                            Удалить всё равно
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="xs"
                                            disabled={isSyncing || !canMutate}
                                            onClick={() => deleteOp(op.entityId)}
                                        >
                                            Отменить удаление
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </section>
                    )}

                    {plainMatches.length > 0 && (
                        <section className="mb-8">
                            <SectionHeader className="mb-3">Партии</SectionHeader>
                            <div className="space-y-3">
                                {plainMatches.map((m) => (
                                    <div key={m.clientId}>
                                        <PendingMatchCard match={m} />
                                        {canMutate && (
                                            <div className="flex flex-wrap gap-2 mt-1">
                                                <Button variant="secondary" size="xs" asChild>
                                                    <Link
                                                        href={`/matches/edit?id=${encodeURIComponent(m.clientId)}`}
                                                    >
                                                        <Pencil />
                                                        Редактировать
                                                    </Link>
                                                </Button>
                                                <Button variant="secondary" size="xs" asChild>
                                                    <Link
                                                        href={`/matches/view?id=${encodeURIComponent(m.clientId)}`}
                                                    >
                                                        <Eye />
                                                        Просмотр
                                                    </Link>
                                                </Button>
                                                <Button
                                                    variant="destructive"
                                                    size="xs"
                                                    disabled={isSyncing}
                                                    onClick={() => setDeleteMatchId(m.clientId)}
                                                >
                                                    <Trash2 />
                                                    Удалить
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    {plainOps.length > 0 && (
                        <section className="mb-8">
                            <SectionHeader className="mb-3">Изменения</SectionHeader>
                            <div className="space-y-2">
                                {plainOps.map((op) => (
                                    <div key={op.entityId} className="border border-dashed rounded p-3">
                                        <div className="flex justify-between items-center gap-2 flex-wrap">
                                            <div className="min-w-0">
                                                <div className="font-medium truncate">{opTitle(op)}</div>
                                                {op.status === "error" ? (
                                                    <Badge variant="destructive">
                                                        <CloudOff />
                                                        ошибка: {op.error}
                                                    </Badge>
                                                ) : op.status === "syncing" ? (
                                                    <Badge variant="secondary">
                                                        <CloudOff />
                                                        отправляется…
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="secondary">
                                                        <CloudOff />
                                                        не сохранено
                                                    </Badge>
                                                )}
                                            </div>
                                            {canMutate && op.status !== "syncing" && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => deleteOp(op.entityId)}
                                                >
                                                    Отказаться
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    <PendingEntityList
                        title="Несохранённые игроки"
                        items={pendingPlayers
                            .filter((p) => p.status !== "conflict")
                            .map((p) => ({
                                clientId: p.clientId,
                                name: p.name,
                                status: p.status,
                                error: p.error,
                            }))}
                        canEdit={canMutate}
                        onRename={updatePendingPlayer}
                        onDelete={deletePendingPlayer}
                    />

                    <PendingEntityList
                        title="Несохранённые игры"
                        items={pendingGames
                            .filter((g) => g.status !== "conflict")
                            .map((g) => ({
                                clientId: g.clientId,
                                name: g.name,
                                status: g.status,
                                error: g.error,
                            }))}
                        canEdit={canMutate}
                        onRename={updatePendingGame}
                        onDelete={deletePendingGame}
                    />
                </>
            )}

            <Dialog open={deleteMatchId !== null} onOpenChange={(open) => !open && setDeleteMatchId(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Удалить несохранённую партию</DialogTitle>
                        <DialogDescription>
                            Партия ещё не отправлена на сервер и будет удалена с этого устройства без
                            возможности восстановления.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteMatchId(null)}>Отмена</Button>
                        <Button
                            variant="destructive"
                            disabled={isSyncing}
                            onClick={() => {
                                if (deleteMatchId) deletePendingMatch(deleteMatchId);
                                setDeleteMatchId(null);
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
