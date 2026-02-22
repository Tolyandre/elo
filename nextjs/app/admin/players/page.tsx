"use client"
import React from "react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { patchPlayerPromise, deletePlayerPromise, createPlayerPromise, getMePromise, User } from "@/app/api";
import { usePlayers } from "@/app/players/PlayersContext";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export default function PlayersAdminPage() {
    const { players: playersFromContext, invalidate: invalidatePlayers } = usePlayers();
    const [me, setMe] = useState<User | undefined | null>(null);
    const [newName, setNewName] = useState<string>("");
    const [renameOpen, setRenameOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selectedName, setSelectedName] = useState<string>("");
    const [renameValue, setRenameValue] = useState<string>("");
    const [actionLoading, setActionLoading] = useState(false);

    // Sort players alphabetically for admin view
    const players = [...playersFromContext].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    useEffect(() => {
        let mounted = true;

        (async () => {
            const meRes = await getMePromise();
            if (!mounted) return;
            setMe(meRes === undefined ? null : meRes);
        })();

        return () => {
            mounted = false;
        };
    }, []);

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
        } catch (err) {
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
        } catch (err) {
            // toast shown by API helper
        } finally {
            setActionLoading(false);
        }
    }

    return (
        <main className="p-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between">
                <h1 className="text-2xl font-semibold mb-4">Управление игроками</h1>
                <div className="mt-2 sm:mt-0">
                    <Link href="/admin" className="text-sm text-blue-600">
                        Назад
                    </Link>
                </div>
            </div>

            {me === null && <p>Для редактирования необходимо авторизоваться.</p>}
            {me && !me.can_edit && <p>У вас нет прав для редактирования игроков.</p>}
            <p>Удаление возможно для игроков без партий.</p>

            <div className="mb-4 mt-4 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <input
                    className="border rounded p-2 flex-1"
                    placeholder="Имя нового игрока"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    disabled={!me || !me.can_edit}
                />
                <div className="w-full sm:w-auto">
                    <Button
                        onClick={async () => {
                            if (!newName || newName.trim() === "") return;
                            try {
                                await createPlayerPromise({ name: newName.trim() });
                                invalidatePlayers();
                                setNewName("");
                            } catch (err) {
                                // toast already shown
                            }
                        }}
                        disabled={!me || !me.can_edit}
                    >
                        Добавить
                    </Button>
                </div>
            </div>

            <section className="mt-6">
                <h2 className="text-lg font-medium mb-3">Список игроков</h2>
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
                                            <Link className="underline font-medium" href={`/matches?player=${player.id}`}>{player.name}</Link>
                                            <div className="text-sm text-muted-foreground">
                                                Рейтинг: {player.rank.now.elo.toFixed(0)}
                                                {player.rank.now.rank && ` (#{player.rank.now.rank})`}
                                            </div>
                                        </div>
                                        <div className="flex gap-2 ml-4">
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => openRename(player.id, player.name)}
                                                disabled={!me || !me.can_edit}
                                            >
                                                Rename
                                            </Button>
                                            <Button
                                                variant="destructive"
                                                size="sm"
                                                onClick={() => openDelete(player.id, player.name)}
                                                disabled={!me || !me.can_edit}
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
                                        <th className="text-left px-4 py-2">Рейтинг</th>
                                        <th className="text-left px-4 py-2">Ранг</th>
                                        <th className="text-left px-4 py-2">Действия</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {players.map((player) => (
                                        <tr key={player.id} className="align-top">
                                            <td className="px-4 py-2">
                                                <Link className="underline" href={`/matches?player=${player.id}`}>{player.name}</Link>
                                            </td>
                                            <td className="px-4 py-2">{player.rank.now.elo.toFixed(0)}</td>
                                            <td className="px-4 py-2">{player.rank.now.rank ? `#${player.rank.now.rank}` : "—"}</td>
                                            <td className="px-4 py-2">
                                                <div className="flex gap-2">
                                                    <Button
                                                        variant="secondary"
                                                        size="sm"
                                                        onClick={() => openRename(player.id, player.name)}
                                                        disabled={!me || !me.can_edit}
                                                    >
                                                        Rename
                                                    </Button>
                                                    <Button
                                                        variant="destructive"
                                                        size="sm"
                                                        onClick={() => openDelete(player.id, player.name)}
                                                        disabled={!me || !me.can_edit}
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
                        <DialogDescription>Вы уверены, что хотите удалить игрока "{selectedName}"? Это действие нельзя отменить.</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={actionLoading}>Отмена</Button>
                        <Button variant="destructive" onClick={confirmDelete} disabled={actionLoading}>
                            {actionLoading ? "Удаление..." : "Удалить"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </main>
    );
}
