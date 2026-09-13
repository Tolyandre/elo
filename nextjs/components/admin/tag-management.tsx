"use client";

import { useState } from "react";
import { createTagPromise, deleteTagPromise, patchTagPromise, Tag } from "@/app/api";
import { useTags } from "@/app/tagsContext";
import { useMe } from "@/app/meContext";
import { ConfirmDialog, ConfirmDialogWithContent, useConfirmAction } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";

/**
 * Game-tag vocabulary management (the "Теги" tab of /admin/games): create,
 * rename, and delete tags. Deleting is allowed only for unused tags
 * (game_count === 0) — a tag carried by any game must be detached first, so
 * the games list stays the single place where tag usage changes.
 */
export function TagManagement() {
    const { canEdit } = useMe();
    const { tags, invalidate } = useTags();

    const [newName, setNewName] = useState("");
    const [creating, setCreating] = useState(false);
    const [renameTarget, setRenameTarget] = useState<Tag | null>(null);
    const [renameValue, setRenameValue] = useState<string>("");

    const del = useConfirmAction(async (tag: Tag) => {
        await deleteTagPromise(tag.id);
        invalidate();
    });

    const sortedTags = [...tags].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    async function handleCreate() {
        const name = newName.trim();
        if (!name) return;
        try {
            setCreating(true);
            await createTagPromise({ name });
            setNewName("");
            invalidate();
        } catch {
            // toast shown by API helper (e.g. duplicate name)
        } finally {
            setCreating(false);
        }
    }

    async function confirmRename() {
        if (!renameTarget) return;
        const next = renameValue.trim();
        if (!next || next === renameTarget.name) {
            setRenameTarget(null);
            return;
        }
        try {
            await patchTagPromise(renameTarget.id, { name: next });
            invalidate();
            setRenameTarget(null);
        } catch {
            // toast shown by API helper (e.g. duplicate name)
        }
    }

    return (
        <div className="mt-4">
            <p>Удалить можно только тег, который не присвоен ни одной игре. Переименование меняет тег у всех игр.</p>

            <div className="mb-6 mt-4 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <input
                    className="border rounded p-2 flex-1"
                    placeholder="Новый тег"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
                    disabled={!canEdit || creating}
                    aria-label="Название нового тега"
                />
                <div className="w-full sm:w-auto">
                    <Button onClick={() => handleCreate()} disabled={!canEdit || creating || !newName.trim()} aria-busy={creating}>
                        {creating ? "Создание..." : "Добавить"}
                    </Button>
                </div>
            </div>

            <section>
                <h2 className="text-lg font-medium mb-3">Список тегов</h2>
                {sortedTags.length === 0 ? (
                    <p>Теги ещё не созданы</p>
                ) : (
                    <div className="space-y-2">
                        {sortedTags.map((tag) => {
                            const unused = tag.game_count === 0;
                            return (
                                <div key={tag.id} className="border rounded p-3 flex justify-between items-center gap-2 flex-wrap">
                                    <div className="min-w-0">
                                        <span className="font-medium">{tag.name}</span>
                                        <span className="text-sm text-muted-foreground ml-2">
                                            ({tag.game_count} {tag.game_count === 1 ? "игра" : "игр"})
                                        </span>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            disabled={!canEdit}
                                            onClick={() => {
                                                setRenameTarget(tag);
                                                setRenameValue(tag.name);
                                            }}
                                        >
                                            Rename
                                        </Button>
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            disabled={!canEdit || !unused}
                                            onClick={() => del.trigger(tag)}
                                            title={unused ? undefined : "Сначала уберите тег у всех игр"}
                                        >
                                            Delete
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            <ConfirmDialogWithContent
                open={renameTarget !== null}
                onOpenChange={(o) => { if (!o) setRenameTarget(null); }}
                title="Переименовать тег"
                description="Тег изменится у всех игр, где он выбран."
                confirmText="Сохранить"
                onConfirm={confirmRename}
            >
                <div className="mt-2">
                    <input
                        className="w-full rounded border p-2"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        aria-label="Новое имя тега"
                    />
                </div>
            </ConfirmDialogWithContent>

            <ConfirmDialog
                open={del.open}
                onOpenChange={del.onOpenChange}
                title="Удалить тег"
                description={del.target ? <>Вы уверены, что хотите удалить тег «{del.target.name}»? Это действие нельзя отменить.</> : undefined}
                confirmText="Удалить"
                confirmVariant="destructive"
                loading={del.pending}
                onConfirm={del.confirm}
            />
        </div>
    );
}
