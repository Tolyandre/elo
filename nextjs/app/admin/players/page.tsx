"use client"
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { patchPlayerPromise, deletePlayerPromise, createPlayerPromise, createPlayerCorrectionPromise, listUsersPromise, isNetworkFailure, User } from "@/app/api";
import { PageHeader } from "@/app/pageHeaderContext";
import { usePlayers } from "@/app/players/PlayersContext";
import { LoginLink } from "@/components/login-link";
import { useMe } from "@/app/meContext";
import { useOffline } from "@/app/offline/OfflineContext";
import { PendingEntityList } from "@/components/pending-entity-list";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Edit2 } from "lucide-react";

export default function PlayersAdminPage() {
    const { players: playersFromContext, playerDisplayName, invalidate: invalidatePlayers } = usePlayers();
    const { isAuthenticated, canEdit } = useMe();
    const { pendingPlayers, isOnline, addPendingPlayer, updatePendingPlayer, deletePendingPlayer } = useOffline();
    const [newName, setNewName] = useState<string>("");
    const [renameOpen, setRenameOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [correctionOpen, setCorrectionOpen] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selectedName, setSelectedName] = useState<string>("");
    const [selectedRating, setSelectedRating] = useState<number>(0);
    const [renameValue, setRenameValue] = useState<string>("");
    const [correctionValue, setCorrectionValue] = useState<string>("");
    const [actionLoading, setActionLoading] = useState(false);
    const [userMap, setUserMap] = useState<Map<string, string>>(new Map());

    useEffect(() => {
        listUsersPromise().then((users: User[]) => {
            setUserMap(new Map(users.map(u => [u.id, u.name])));
        }).catch(() => {});
    }, []);

    // Sort players alphabetically for admin view
    const sortedPlayers = [...playersFromContext].sort((a, b) => playerDisplayName(a).localeCompare(playerDisplayName(b), undefined, { sensitivity: "base" }));

    // Filter players by search term
    const players = newName.trim() === ""
        ? sortedPlayers
        : sortedPlayers.filter(p => playerDisplayName(p).toLowerCase().includes(newName.toLowerCase()));

    function openRename(id: string, name: string) {
        setSelectedId(id);
        setSelectedName(name);
        setRenameValue(name);
        setRenameOpen(true);
    }

    async function confirmRename() {
        if (!selectedId) return;
        const newName = renameValue?.trim();
        if (!newName || newName === selectedName) {
            setRenameOpen(false);
            return;
        }
        try {
            setActionLoading(true);
            await patchPlayerPromise(selectedId, { name: newName });
            invalidatePlayers();
            setRenameOpen(false);
        } catch {
            // toast shown by API helper
        } finally {
            setActionLoading(false);
        }
    }

    function openDelete(id: string, name: string) {
        setSelectedId(id);
        setSelectedName(name);
        setDeleteOpen(true);
    }

    async function confirmDelete() {
        if (!selectedId) return;
        try {
            setActionLoading(true);
            await deletePlayerPromise(selectedId);
            invalidatePlayers();
            setDeleteOpen(false);
        } catch {
            // toast shown by API helper
        } finally {
            setActionLoading(false);
        }
    }

    function openCorrection(id: string, rating: number) {
        setSelectedId(id);
        setSelectedRating(Math.round(rating));
        setCorrectionValue("");
        setCorrectionOpen(true);
    }

    async function confirmCorrection() {
        if (!selectedId) return;
        const diff = parseInt(correctionValue, 10);
        if (isNaN(diff)) return;
        try {
            setActionLoading(true);
            await createPlayerCorrectionPromise(selectedId, diff);
            invalidatePlayers();
            setCorrectionOpen(false);
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

            {!isAuthenticated && (
                <div className="flex flex-col items-start gap-2">
                    <p>Для редактирования необходимо авторизоваться.</p>
                    <LoginLink />
                </div>
            )}
            {isAuthenticated && !canEdit && <p>У вас нет прав для редактирования игроков.</p>}
            <p>Удаление возможно для игроков без партий.</p>

            <div className="mb-4 mt-4 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <input
                    className="border rounded p-2 flex-1"
                    placeholder="Имя игрока"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                />
                <div className="w-full sm:w-auto">
                    <Button
                        onClick={async () => {
                            if (!newName || newName.trim() === "") return;
                            const name = newName.trim();
                            if (!isOnline) {
                                addPendingPlayer(name);
                                setNewName("");
                                return;
                            }
                            try {
                                await createPlayerPromise({ name });
                                invalidatePlayers();
                                setNewName("");
                            } catch (e) {
                                if (isNetworkFailure(e)) {
                                    // network died mid-request — queue the player offline instead
                                    addPendingPlayer(name);
                                    setNewName("");
                                }
                                // HTTP errors: toast already shown
                            }
                        }}
                        disabled={!canEdit}
                    >
                        {isOnline ? "Добавить" : "Добавить офлайн"}
                    </Button>
                </div>
            </div>

            <PendingEntityList
                title="Не синхронизированные игроки"
                items={pendingPlayers}
                canEdit={canEdit}
                onRename={updatePendingPlayer}
                onDelete={deletePendingPlayer}
            />

            <section className="mt-6">
                <h2 className="text-lg font-medium mb-3">
                    Список игроков
                    {newName.trim() !== "" && (
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
                                            <Link className="underline font-medium" href={`/matches?player=${player.id}`}>{playerDisplayName(player)}</Link>
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
                                                onClick={() => openDelete(player.id, player.name)}
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
                                                <Link className="underline" href={`/matches?player=${player.id}`}>{playerDisplayName(player)}</Link>
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
                                                        onClick={() => openDelete(player.id, player.name)}
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
            {/* Rename dialog */}
            <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Переименовать игрока</DialogTitle>
                        <DialogDescription>Введите новое имя для игрока.</DialogDescription>
                    </DialogHeader>
                    <div className="mt-2">
                        <input
                            className="w-full rounded border p-2"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            aria-label="New player name"
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRenameOpen(false)} disabled={actionLoading}>Отмена</Button>
                        <Button onClick={confirmRename} disabled={actionLoading}>
                            {actionLoading ? "Сохранение..." : "Сохранить"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete confirm dialog */}
            <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Удалить игрока</DialogTitle>
                        <DialogDescription>Вы уверены, что хотите удалить игрока «{selectedName}»? Это действие нельзя отменить.</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={actionLoading}>Отмена</Button>
                        <Button variant="destructive" onClick={confirmDelete} disabled={actionLoading}>
                            {actionLoading ? "Удаление..." : "Удалить"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Correction dialog */}
            <Dialog open={correctionOpen} onOpenChange={setCorrectionOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Корректировка рейтинга</DialogTitle>
                        <DialogDescription>Текущий рейтинг: {selectedRating}</DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-3 mt-2">
                        <Button
                            variant="outline"
                            onClick={() => setCorrectionValue(String(-selectedRating))}
                            disabled={actionLoading}
                        >
                            Обнулить (−{selectedRating})
                        </Button>
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
                        <Button variant="outline" onClick={() => setCorrectionOpen(false)} disabled={actionLoading}>Отмена</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </main>
    );
}
