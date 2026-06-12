"use client";

import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CloudOff } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

type PendingEntity = {
    clientId: string;
    name: string;
    status: "pending" | "syncing" | "error";
    error?: string;
};

// Admin-page list of offline-created players/games awaiting sync, with rename
// and delete (the escape hatch when the server rejects the item).
export function PendingEntityList({
    title,
    items,
    canEdit,
    onRename,
    onDelete,
}: {
    title: string;
    items: PendingEntity[];
    canEdit: boolean;
    onRename: (clientId: string, name: string) => void;
    onDelete: (clientId: string) => void;
}) {
    const [renameId, setRenameId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [deleteId, setDeleteId] = useState<string | null>(null);

    if (items.length === 0) return null;

    const deleteItem = items.find((i) => i.clientId === deleteId);

    return (
        <section className="mt-6">
            <h2 className="text-lg font-medium mb-3">{title}</h2>
            <div className="space-y-2">
                {items.map((item) => (
                    <div key={item.clientId} className="border border-dashed rounded p-3">
                        <div className="flex justify-between items-center gap-2 flex-wrap">
                            <div className="min-w-0">
                                <div className="font-medium truncate">{item.name}</div>
                                {item.status === "error" ? (
                                    <Badge variant="destructive">
                                        <CloudOff />
                                        ошибка: {item.error}
                                    </Badge>
                                ) : (
                                    <Badge variant="secondary">
                                        <CloudOff />
                                        не синхронизировано
                                    </Badge>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={!canEdit}
                                    onClick={() => {
                                        setRenameId(item.clientId);
                                        setRenameValue(item.name);
                                    }}
                                >
                                    Rename
                                </Button>
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    disabled={!canEdit}
                                    onClick={() => setDeleteId(item.clientId)}
                                >
                                    Delete
                                </Button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <Dialog open={renameId !== null} onOpenChange={(open) => !open && setRenameId(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Переименовать</DialogTitle>
                        <DialogDescription>Запись ещё не синхронизирована — изменение сохранится локально.</DialogDescription>
                    </DialogHeader>
                    <div className="mt-2">
                        <input
                            className="w-full rounded border p-2"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            aria-label="New name"
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRenameId(null)}>Отмена</Button>
                        <Button
                            onClick={() => {
                                if (renameId && renameValue.trim()) onRename(renameId, renameValue.trim());
                                setRenameId(null);
                            }}
                        >
                            Сохранить
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Удалить</DialogTitle>
                        <DialogDescription>
                            «{deleteItem?.name}» ещё не отправлено на сервер и будет удалено с этого устройства.
                            Партии, ссылающиеся на эту запись, не смогут синхронизироваться.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteId(null)}>Отмена</Button>
                        <Button
                            variant="destructive"
                            onClick={() => {
                                if (deleteId) onDelete(deleteId);
                                setDeleteId(null);
                            }}
                        >
                            Удалить
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </section>
    );
}
