"use client"
import React, { useState } from "react";
import Link from "next/link";
import { createClubPromise } from "@/app/api";
import { useMe } from "@/app/meContext";
import { useClubs } from "@/app/clubsContext";
import { Button } from "@/components/ui/button";

export default function ClubsAdminPage() {
    const { canEdit } = useMe();
    const { clubs, clubDisplayName, invalidate } = useClubs();
    const [newName, setNewName] = useState("");
    const [creating, setCreating] = useState(false);

    const sortedClubs = [...clubs].sort((a, b) => clubDisplayName(a).localeCompare(clubDisplayName(b), undefined, { sensitivity: "base" }));

    async function handleCreate() {
        if (!newName.trim()) return;
        try {
            setCreating(true);
            await createClubPromise({ name: newName.trim() });
            setNewName("");
            invalidate();
        } catch {
            // toast shown by API helper
        } finally {
            setCreating(false);
        }
    }

    return (
        <main className="p-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between">
                <h1 className="text-2xl font-semibold mb-4">Управление клубами</h1>
                <div className="mt-2 sm:mt-0">
                    <Link href="/admin" className="text-sm text-blue-600">
                        Назад
                    </Link>
                </div>
            </div>

            <div className="mb-6 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <input
                    className="border rounded p-2 flex-1"
                    placeholder="Название клуба"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
                    disabled={creating}
                />
                <div className="w-full sm:w-auto">
                    <Button onClick={handleCreate} disabled={!canEdit || creating || !newName.trim()}>
                        {creating ? "Создание..." : "Добавить"}
                    </Button>
                </div>
            </div>

            {sortedClubs.length === 0 && <p>Нет клубов</p>}

            {sortedClubs.length > 0 && (
                <section>
                    <h2 className="text-lg font-medium mb-3">Список клубов</h2>
                    <div className="space-y-2">
                        {sortedClubs.map((club) => (
                            <div key={club.id} className="border rounded p-3 flex items-center gap-2">
                                <Link href={`/admin/club?id=${club.id}`} className="font-medium underline">
                                    {clubDisplayName(club)}
                                </Link>
                                <span className="text-sm text-muted-foreground">
                                    ({club.players.length} {club.players.length === 1 ? "игрок" : "игроков"})
                                </span>
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </main>
    );
}
