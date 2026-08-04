"use client"
import React from "react";
import Link from "next/link";
import { PageHeader } from "@/app/pageHeaderContext";
import { useState } from "react";
import { patchGamePromise, deleteGamePromise, createGamePromise, isNetworkFailure } from "@/app/api";
import { LoginLink } from "@/components/login-link";
import { useGames } from "@/app/gamesContext";
import { useMe } from "@/app/meContext";
import { useOffline } from "@/app/offline/OfflineContext";
import { PendingEntityList } from "@/components/pending-entity-list";
import { ConfirmDialog, ConfirmDialogWithContent, useConfirmAction } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

type GameRow = { id: string; name: string };

export default function GamesAdminPage() {
    const { games: gamesFromContext, invalidate: invalidateGames } = useGames();
    const { isAuthenticated, canEdit, loading: meLoading } = useMe();
    const { pendingGames, offline, addPendingGame, updatePendingGame, deletePendingGame } = useOffline();
    const [newName, setNewName] = useState<string>("");
    const [adding, setAdding] = useState(false);
    const [renameTarget, setRenameTarget] = useState<GameRow | null>(null);
    const [renameValue, setRenameValue] = useState<string>("");

    const del = useConfirmAction(async (g: GameRow) => {
        await deleteGamePromise(g.id);
        invalidateGames();
    });

    // Sort games alphabetically for admin view
    const sortedGames = [...gamesFromContext].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    // Filter games by search term
    const games = newName.trim() !== ""
        ? sortedGames.filter(g => g.name.toLowerCase().includes(newName.toLowerCase()))
        : sortedGames;

    function openRename(row: GameRow) {
        setRenameTarget(row);
        setRenameValue(row.name);
    }

    async function confirmRename() {
        if (!renameTarget) return;
        const next = renameValue?.trim();
        if (!next || next === renameTarget.name) {
            setRenameTarget(null);
            return;
        }
        try {
            await patchGamePromise(renameTarget.id, { name: next });
            invalidateGames();
            setRenameTarget(null);
        } catch {
            // toast shown by API helper
        }
    }

    return (
        <main className="p-4">
                <PageHeader title="Управление играми" />
                <div className="mb-4">
                    <Link href="/admin" className="text-sm text-blue-600">Назад</Link>
                </div>

            {!meLoading && !isAuthenticated && (
                <div className="flex flex-col items-start gap-2">
                    <p>Для редактирования необходимо авторизоваться.</p>
                    <LoginLink />
                </div>
            )}
            {!meLoading && isAuthenticated && !canEdit && <p>У вас нет прав для редактирования игр.</p>}
            <p>Удаление возможно для игр без партий.</p>

            <div className="mb-4 mt-4 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <input
                    className="border rounded p-2 flex-1"
                    placeholder="Название игры"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                />
                <div className="w-full sm:w-auto">
                <Button
                    onClick={async () => {
                        if (adding || !newName || newName.trim() === "") return;
                        const name = newName.trim();
                        if (offline) {
                            addPendingGame(name);
                            setNewName("");
                            return;
                        }
                        setAdding(true);
                        try {
                            await createGamePromise({ name });
                            invalidateGames();
                            setNewName("");
                        } catch (e) {
                            if (isNetworkFailure(e)) {
                                // network died mid-request — queue the game offline instead
                                addPendingGame(name);
                                setNewName("");
                            }
                            // HTTP errors: toast already shown
                        } finally {
                            setAdding(false);
                        }
                    }}
                    disabled={!canEdit || adding}
                    aria-busy={adding}
                >
                    {adding && <Spinner className="size-4" />}
                    {offline ? "Добавить офлайн" : "Добавить"}
                </Button>
                </div>
            </div>

            <PendingEntityList
                title="Не сохранённые игры"
                items={pendingGames}
                canEdit={canEdit}
                onRename={updatePendingGame}
                onDelete={deletePendingGame}
            />

            <section className="mt-6">
                <h2 className="text-lg font-medium mb-3">
                    Список игр
                    {newName.trim() !== "" && (
                        <span className="text-sm font-normal text-muted-foreground ml-2">
                            (найдено: {games.length} из {sortedGames.length})
                        </span>
                    )}
                </h2>
                {games.length === 0 ? (
                    <p>Нет игр</p>
                ) : (
                    <>
                        {/* Mobile list */}
                        <div className="sm:hidden space-y-2 mb-4">
                            {games.map((game) => (
                                <div key={game.id} className="border rounded p-3">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <Link className="underline font-medium" href={`/matches?game=${game.id}`}>{game.name}</Link>
                                            <div className="text-sm text-muted-foreground">Партий: {game.total_matches}</div>
                                        </div>
                                        <div className="flex gap-2 ml-4">
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => openRename(game)}
                                                disabled={!canEdit}
                                            >
                                                Rename
                                            </Button>
                                            <Button
                                                variant="destructive"
                                                size="sm"
                                                onClick={() => del.trigger(game)}
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
                                        <th className="text-left px-4 py-2">Название</th>
                                        <th className="text-left px-4 py-2">Партий</th>
                                        <th className="text-left px-4 py-2">Действия</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {games.map((game) => (
                                        <tr key={game.id} className="align-top">
                                            <td className="px-4 py-2">
                                                <Link className="underline" href={`/matches?game=${game.id}`}>{game.name}</Link>
                                            </td>
                                            <td className="px-4 py-2">{game.total_matches}</td>
                                            <td className="px-4 py-2">
                                                <div className="flex gap-2">
                                                    <Button
                                                        variant="secondary"
                                                        size="sm"
                                                        onClick={() => openRename(game)}
                                                        disabled={!canEdit}
                                                    >
                                                        Rename
                                                    </Button>
                                                    <Button
                                                        variant="destructive"
                                                        size="sm"
                                                        onClick={() => del.trigger(game)}
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
            <ConfirmDialogWithContent
                open={renameTarget !== null}
                onOpenChange={(o) => { if (!o) setRenameTarget(null); }}
                title="Переименовать игру"
                description="Введите новое имя для игры."
                confirmText="Сохранить"
                onConfirm={confirmRename}
            >
                <div className="mt-2">
                    <input
                        className="w-full rounded border p-2"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        aria-label="New game name"
                    />
                </div>
            </ConfirmDialogWithContent>

            {/* Delete confirm dialog */}
            <ConfirmDialog
                open={del.open}
                onOpenChange={del.onOpenChange}
                title="Удалить игру"
                description={del.target ? <>Вы уверены, что хотите удалить игру «{del.target.name}»? Это действие нельзя отменить.</> : undefined}
                confirmText="Удалить"
                confirmVariant="destructive"
                loading={del.pending}
                onConfirm={del.confirm}
            />
        </main>
    );
}
