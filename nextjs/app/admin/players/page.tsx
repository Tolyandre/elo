"use client"
import React, { useRef, useState } from "react";
import Link from "next/link";
import { patchPlayerPromise, deletePlayerPromise, createPlayerCorrectionPromise, listUsersPromise } from "@/app/api";
import { PageHeader } from "@/app/pageHeaderContext";
import { usePlayers } from "@/app/players/PlayersContext";
import { LoginLink } from "@/components/login-link";
import { useMe } from "@/app/meContext";
import { useOffline } from "@/app/offline/OfflineContext";
import { PendingEntityList } from "@/components/pending-entity-list";
import { ClubIcons } from "@/components/player-name";
import { AddPlayerForm, AddPlayerFormHandle } from "@/components/add-player-form";
import { ConfirmDialog, ConfirmDialogWithContent, useConfirmAction } from "@/components/confirm-dialog";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Edit2 } from "lucide-react";
import { useAsyncResource } from "@/hooks/useAsyncResource";

type DeleteTarget = { id: string; name: string };
type RenameTarget = { id: string; name: string };
type CorrectionTarget = { id: string; rating: number };

export default function PlayersAdminPage() {
    const { players: playersFromContext, playerDisplayName, invalidate: invalidatePlayers } = usePlayers();
    const { isAuthenticated, canEdit, loading: meLoading } = useMe();
    const { pendingPlayers, updatePendingPlayer, deletePendingPlayer } = useOffline();
    const [nameQuery, setNameQuery] = useState<string>("");
    const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
    const [renameValue, setRenameValue] = useState<string>("");
    const [correctionTarget, setCorrectionTarget] = useState<CorrectionTarget | null>(null);
    const [correctionValue, setCorrectionValue] = useState<string>("");
    const [actionLoading, setActionLoading] = useState(false);

    // The single name field doubles as a search filter over existing players
    // (so the user sees whether a player with that name already exists) and as
    // the prefill for the add-player confirmation dialog.
    const [addOpen, setAddOpen] = useState(false);
    const [adding, setAdding] = useState(false);
    const addFormRef = useRef<AddPlayerFormHandle>(null);

    function openAddDialog() {
        const trimmed = nameQuery.trim();
        if (!trimmed) return;
        setAddOpen(true);
    }

    async function confirmAdd() {
        if (adding) return;
        setAdding(true);
        try {
            const result = await addFormRef.current?.submit();
            if (result?.created) {
                setAddOpen(false);
                setNameQuery("");
            }
        } finally {
            setAdding(false);
        }
    }

    const { data: users } = useAsyncResource(listUsersPromise);
    const userMap = new Map((users ?? []).map(u => [u.id, u.name]));

    const del = useConfirmAction(async (p: DeleteTarget) => {
        await deletePlayerPromise(p.id);
        invalidatePlayers();
    });

    // Sort players alphabetically for admin view
    const sortedPlayers = [...playersFromContext].sort((a, b) => playerDisplayName(a).localeCompare(playerDisplayName(b), undefined, { sensitivity: "base" }));

    // Filter players by the name query (the same field used to add a player)
    const players = nameQuery.trim() === ""
        ? sortedPlayers
        : sortedPlayers.filter(p => playerDisplayName(p).toLowerCase().includes(nameQuery.toLowerCase()));

    function openRename(id: string, name: string) {
        setRenameTarget({ id, name });
        setRenameValue(name);
    }

    async function confirmRename() {
        if (!renameTarget) return;
        const next = renameValue?.trim();
        if (!next || next === renameTarget.name) {
            setRenameTarget(null);
            return;
        }
        try {
            setActionLoading(true);
            await patchPlayerPromise(renameTarget.id, { name: next });
            invalidatePlayers();
            setRenameTarget(null);
        } catch {
            // toast shown by API helper
        } finally {
            setActionLoading(false);
        }
    }

    function openCorrection(id: string, rating: number) {
        setCorrectionTarget({ id, rating: Math.round(rating) });
        setCorrectionValue("");
    }

    async function confirmCorrection() {
        if (!correctionTarget) return;
        const diff = parseInt(correctionValue, 10);
        if (isNaN(diff)) return;
        try {
            setActionLoading(true);
            await createPlayerCorrectionPromise(correctionTarget.id, diff);
            invalidatePlayers();
            setCorrectionTarget(null);
        } catch {
            // toast shown by API helper
        } finally {
            setActionLoading(false);
        }
    }

    return (
        <main className="p-4">
            <PageHeader title="Управление игроками" />
            <div className="mb-4">
                <Link href="/admin" className="text-sm text-blue-600">Назад</Link>
            </div>

            {!meLoading && !isAuthenticated && (
                <div className="flex flex-col items-start gap-2">
                    <p>Для редактирования необходимо авторизоваться.</p>
                    <LoginLink />
                </div>
            )}
            {!meLoading && isAuthenticated && !canEdit && <p>У вас нет прав для редактирования игроков.</p>}
            <p>Удаление возможно для игроков без партий.</p>

            <div className="mb-4 mt-4 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <input
                    className="border rounded p-2 flex-1"
                    placeholder="Имя игрока (поиск / добавление)"
                    value={nameQuery}
                    onChange={(e) => setNameQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); openAddDialog(); } }}
                    aria-label="Имя игрока"
                />
                <div className="w-full sm:w-auto">
                    <Button
                        onClick={openAddDialog}
                        disabled={!canEdit || !nameQuery.trim()}
                    >
                        Добавить
                    </Button>
                </div>
            </div>

            <PendingEntityList
                title="Не сохранённые игроки"
                items={pendingPlayers}
                canEdit={canEdit}
                onRename={updatePendingPlayer}
                onDelete={deletePendingPlayer}
            />

            <section className="mt-6">
                <h2 className="text-lg font-medium mb-3">
                    Список игроков
                    {nameQuery.trim() !== "" && (
                        <span className="text-sm font-normal text-muted-foreground ml-2">
                            (найдено: {players.length} из {sortedPlayers.length})
                        </span>
                    )}
                </h2>
                {players.length === 0 ? (
                    <p>Нет игроков</p>
                ) : (
                    <>
                        {/* Mobile list */}
                        <div className="sm:hidden space-y-2 mb-4">
                            {players.map((player) => (
                                <div key={player.id} className="border rounded p-3">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <span className="inline-flex items-center gap-1">
                                                <ClubIcons playerId={player.id} />
                                                <Link className="underline font-medium" href={`/matches?player=${player.id}`}>{playerDisplayName(player)}</Link>
                                            </span>
                                            <div className="text-sm text-muted-foreground flex items-center gap-1">
                                                Рейтинг: {Math.round(player.rank.now.rating)}
                                                {player.rank.now.rank && ` (#${player.rank.now.rank})`}
                                                <Button
                                                    variant="outline"
                                                    size="icon"
                                                    className="h-6 w-6 ml-1"
                                                    onClick={() => openCorrection(player.id, player.rank.now.rating)}
                                                    disabled={!canEdit}
                                                    aria-label="Корректировка рейтинга"
                                                >
                                                    <Edit2 className="h-3 w-3" />
                                                </Button>
                                            </div>
                                            {player.user_id && (
                                                <div className="text-xs text-muted-foreground">{userMap.get(player.user_id)}</div>
                                            )}
                                        </div>
                                        <div className="flex gap-2 ml-4">
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => openRename(player.id, player.name)}
                                                disabled={!canEdit}
                                            >
                                                Rename
                                            </Button>
                                            <Button
                                                variant="destructive"
                                                size="sm"
                                                onClick={() => del.trigger({ id: player.id, name: player.name })}
                                                disabled={!canEdit}
                                            >
                                                Delete
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Desktop / larger screens: table with horizontal scroll if needed */}
                        <div className="hidden sm:block overflow-x-auto">
                            <table className="min-w-full table-auto border-collapse mb-6">
                                <thead>
                                    <tr>
                                        <th className="text-left px-4 py-2">Имя</th>
                                        <th className="text-left px-4 py-2">Пользователь</th>
                                        <th className="text-left px-4 py-2">Рейтинг</th>
                                        <th className="text-left px-4 py-2">Ранг</th>
                                        <th className="text-left px-4 py-2">Действия</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {players.map((player) => (
                                        <tr key={player.id} className="align-top">
                                            <td className="px-4 py-2">
                                                <span className="inline-flex items-center gap-1">
                                                    <ClubIcons playerId={player.id} />
                                                    <Link className="underline" href={`/matches?player=${player.id}`}>{playerDisplayName(player)}</Link>
                                                </span>
                                            </td>
                                            <td className="px-4 py-2 text-sm text-muted-foreground">
                                                {player.user_id ? userMap.get(player.user_id) : ""}
                                            </td>
                                            <td className="px-4 py-2">
                                                <span className="flex items-center gap-1">
                                                    {Math.round(player.rank.now.rating)}
                                                    <Button
                                                        variant="outline"
                                                        size="icon"
                                                        className="h-6 w-6"
                                                        onClick={() => openCorrection(player.id, player.rank.now.rating)}
                                                        disabled={!canEdit}
                                                        aria-label="Корректировка рейтинга"
                                                    >
                                                        <Edit2 className="h-3 w-3" />
                                                    </Button>
                                                </span>
                                            </td>
                                            <td className="px-4 py-2">{player.rank.now.rank ? `#${player.rank.now.rank}` : "—"}</td>
                                            <td className="px-4 py-2">
                                                <div className="flex gap-2">
                                                    <Button
                                                        variant="secondary"
                                                        size="sm"
                                                        onClick={() => openRename(player.id, player.name)}
                                                        disabled={!canEdit}
                                                    >
                                                        Rename
                                                    </Button>
                                                    <Button
                                                        variant="destructive"
                                                        size="sm"
                                                        onClick={() => del.trigger({ id: player.id, name: player.name })}
                                                        disabled={!canEdit}
                                                    >
                                                        Delete
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </section>
            {/* Add player confirmation dialog: name pre-filled from the inline
                field, clubs selectable. Saving creates the player (online or
                queued offline with the chosen clubs). */}
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Новый игрок</DialogTitle>
                        <DialogDescription>
                            Проверьте имя и при необходимости выберите клубы.
                        </DialogDescription>
                    </DialogHeader>
                    <AddPlayerForm
                        ref={addFormRef}
                        hideSubmit
                        initialName={nameQuery}
                        autoFocus
                    />
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAddOpen(false)} disabled={adding}>
                            Отмена
                        </Button>
                        <Button onClick={confirmAdd} disabled={adding} aria-busy={adding}>
                            {adding && <Spinner className="size-4" />}
                            Сохранить
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Rename dialog */}
            <ConfirmDialogWithContent
                open={renameTarget !== null}
                onOpenChange={(o) => { if (!o) setRenameTarget(null); }}
                title="Переименовать игрока"
                description="Введите новое имя для игрока."
                confirmText="Сохранить"
                loading={actionLoading}
                onConfirm={confirmRename}
            >
                <div className="mt-2">
                    <input
                        className="w-full rounded border p-2"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        aria-label="New player name"
                    />
                </div>
            </ConfirmDialogWithContent>

            {/* Delete confirm dialog */}
            <ConfirmDialog
                open={del.open}
                onOpenChange={del.onOpenChange}
                title="Удалить игрока"
                description={del.target ? <>Вы уверены, что хотите удалить игрока «{del.target.name}»? Это действие нельзя отменить.</> : undefined}
                confirmText="Удалить"
                confirmVariant="destructive"
                loading={del.pending}
                onConfirm={del.confirm}
            />

            {/* Correction dialog */}
            <Dialog open={correctionTarget !== null} onOpenChange={(o) => { if (!o) setCorrectionTarget(null); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Корректировка рейтинга</DialogTitle>
                        {correctionTarget && (
                            <DialogDescription>Текущий рейтинг: {correctionTarget.rating}</DialogDescription>
                        )}
                    </DialogHeader>
                    <div className="flex flex-col gap-3 mt-2">
                        {correctionTarget && (
                            <Button
                                variant="outline"
                                onClick={() => setCorrectionValue(String(-correctionTarget.rating))}
                                disabled={actionLoading}
                            >
                                Обнулить (−{correctionTarget.rating})
                            </Button>
                        )}
                        <div className="flex gap-2 items-center">
                            <input
                                type="number"
                                step="1"
                                className="border rounded p-2 flex-1"
                                placeholder="Изменение рейтинга"
                                value={correctionValue}
                                onChange={(e) => setCorrectionValue(e.target.value)}
                                aria-label="Correction value"
                            />
                            <Button
                                variant="destructive"
                                onClick={confirmCorrection}
                                disabled={actionLoading || isNaN(parseInt(correctionValue, 10))}
                            >
                                {actionLoading ? "Применение..." : "Применить"}
                            </Button>
                        </div>
                    </div>
                    <DialogFooter className="mt-2">
                        <Button variant="outline" onClick={() => setCorrectionTarget(null)} disabled={actionLoading}>Отмена</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </main>
    );
}
