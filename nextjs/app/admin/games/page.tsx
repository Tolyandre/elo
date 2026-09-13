"use client"
import type { Base58ID } from "@/lib/id";
import React from "react";
import Link from "next/link";
import { PageHeader } from "@/app/pageHeaderContext";
import { useState } from "react";
import { patchGamePromise, deleteGamePromise, addGameTagPromise, removeGameTagPromise, Tag } from "@/app/api";
import { LoginLink } from "@/components/login-link";
import { useGames } from "@/app/gamesContext";
import { useTags } from "@/app/tagsContext";
import { useMe } from "@/app/meContext";
import { useOffline } from "@/app/offline/OfflineContext";
import { PendingEntityList } from "@/components/pending-entity-list";
import { ConfirmDialog, ConfirmDialogWithContent, useConfirmAction } from "@/components/confirm-dialog";
import { AdminPageTabs } from "@/components/admin/admin-page-tabs";
import { TagManagement } from "@/components/admin/tag-management";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/back-button";
import { cn } from "@/lib/utils";

type GameRow = {
    id: Base58ID;
    name: string;
    total_matches: number;
    tags: { id: Base58ID; name: string }[];
};

export default function GamesAdminPage() {
    const { games: gamesFromContext, invalidate: invalidateGames } = useGames();
    const { isAuthenticated, canEdit, loading: meLoading } = useMe();
    const { pendingGames, offline, addPendingGame, updatePendingGame, deletePendingGame } = useOffline();
    const [newName, setNewName] = useState<string>("");
    const [filterTagIds, setFilterTagIds] = useState<Set<Base58ID>>(new Set());
    const [renameTarget, setRenameTarget] = useState<GameRow | null>(null);
    const [renameValue, setRenameValue] = useState<string>("");

    const del = useConfirmAction(async (g: GameRow) => {
        await deleteGamePromise(g.id);
        invalidateGames();
    });

    // Sort games alphabetically for admin view
    const sortedGames = [...gamesFromContext].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    // Filter games by name text and/or by tag selection: selected tags are
    // OR-ed (a game matches when it carries any of them), then AND-ed with the
    // name filter.
    const search = newName.trim().toLowerCase();
    const games = sortedGames.filter(g =>
        (search === "" || g.name.toLowerCase().includes(search)) &&
        (filterTagIds.size === 0 || g.tags.some(t => filterTagIds.has(t.id)))
    );

    function toggleFilterTag(id: Base58ID) {
        setFilterTagIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

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
                <BackButton href="/admin" />

            <AdminPageTabs entityType={["game", "tag"]} mainLabel="Игры" extraTab={{ label: "Теги", content: <TagManagement /> }}>
            {!meLoading && !isAuthenticated && (
                <div className="flex flex-col items-start gap-2">
                    <p>Для редактирования необходимо авторизоваться.</p>
                    <LoginLink />
                </div>
            )}
            {!meLoading && isAuthenticated && !canEdit && <p>У вас нет прав для редактирования игр.</p>}
            <p>Удаление возможно для игр без партий. Нажмите на тег под игрой, чтобы присвоить или убрать его.</p>

            <div className="mb-4 mt-4 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <input
                    className="border rounded p-2 flex-1"
                    placeholder="Название игры"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                />
                <div className="w-full sm:w-auto">
                <Button
                    onClick={() => {
                        if (!newName || newName.trim() === "") return;
                        // Creates always queue (the clientId is the final server
                        // id); the sync flushes it within a round trip while online.
                        addPendingGame(newName.trim());
                        setNewName("");
                    }}
                    disabled={!canEdit}
                >
                    {offline ? "Добавить офлайн" : "Добавить"}
                </Button>
                </div>
            </div>

            <TagFilterRow selected={filterTagIds} onToggle={toggleFilterTag} />

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
                    {(newName.trim() !== "" || filterTagIds.size > 0) && (
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
                                    <GameTagChips game={game} />
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
                                        <th className="text-left px-4 py-2">Теги</th>
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
                                                <GameTagChips game={game} />
                                            </td>
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
            </AdminPageTabs>
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

/**
 * Tag vocabulary as filter chips under the search input: selected tags narrow
 * the game list to games carrying any of them. The chip count shows global
 * usage. A view control — available to everyone, no edit permission required.
 */
function TagFilterRow({ selected, onToggle }: { selected: Set<Base58ID>; onToggle: (id: Base58ID) => void }) {
    const { tags } = useTags();
    if (tags.length === 0) return null;
    const sortedTags = [...tags].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return (
        <div className="flex flex-wrap gap-1 items-center mb-4">
            {sortedTags.map((tag) => {
                const active = selected.has(tag.id);
                return (
                    <button
                        key={tag.id}
                        type="button"
                        onClick={() => onToggle(tag.id)}
                        className={cn(
                            "inline-flex items-center rounded-full border px-2 py-0.5 text-xs transition-colors",
                            active
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-transparent text-muted-foreground hover:bg-accent",
                        )}
                        aria-pressed={active}
                    >
                        {tag.name}
                        <span className="opacity-60">({tag.game_count})</span>
                    </button>
                );
            })}
        </div>
    );
}

/**
 * All tags of the vocabulary as toggle chips under one game: filled = attached,
 * outline = available. Clicking toggles the attachment immediately, so a game's
 * tags are switched without any dialog. Usage counts live on the filter chips.
 */
function GameTagChips({ game }: { game: GameRow }) {
    const { canEdit } = useMe();
    const { tags, invalidate: invalidateTags } = useTags();
    const { invalidate: invalidateGames } = useGames();
    const [busyIds, setBusyIds] = useState<Set<Base58ID>>(new Set());

    const attachedIds = new Set(game.tags.map((t) => t.id));
    const sortedTags = [...tags].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    async function toggleTag(tag: Tag) {
        const attached = attachedIds.has(tag.id);
        setBusyIds((prev) => new Set(prev).add(tag.id));
        try {
            if (attached) {
                await removeGameTagPromise(game.id, tag.id);
            } else {
                await addGameTagPromise(game.id, tag.id);
            }
            // Refresh both lists: the games list carries the new attachment,
            // the tag list the changed usage counts.
            invalidateGames();
            invalidateTags();
        } catch {
            // toast shown by API helper
        } finally {
            setBusyIds((prev) => {
                const next = new Set(prev);
                next.delete(tag.id);
                return next;
            });
        }
    }

    return (
        <div className="flex flex-wrap gap-1 items-center mt-2">
            {sortedTags.map((tag) => {
                const attached = attachedIds.has(tag.id);
                const busy = busyIds.has(tag.id);
                return (
                    <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        disabled={!canEdit || busy}
                        className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                            attached
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-transparent text-muted-foreground hover:bg-accent",
                            (!canEdit || busy) && "opacity-50 cursor-not-allowed",
                        )}
                        aria-pressed={attached}
                    >
                        {tag.name}
                    </button>
                );
            })}
        </div>
    );
}
