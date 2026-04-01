"use client"
import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
    getClubPromise,
    patchClubPromise,
    deleteClubPromise,
    addClubMemberPromise,
    removeClubMemberPromise,
    Club,
} from "@/app/api";
import { useClubs } from "@/app/clubsContext";
import { usePlayers } from "@/app/players/PlayersContext";
import { useMe } from "@/app/meContext";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export default function ClubAdminPage() {
    return (
        <Suspense fallback={<main className="p-4"><p>Загрузка...</p></main>}>
            <ClubAdminContent />
        </Suspense>
    );
}

function ClubAdminContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const clubId = searchParams.get("id") ?? "";
    const { canEdit } = useMe();
    const { players, playerDisplayName } = usePlayers();
    const { invalidate: invalidateClubs, clubDisplayName } = useClubs();

    const [club, setClub] = useState<Club | null>(null);
    const [loading, setLoading] = useState(true);

    const [renameOpen, setRenameOpen] = useState(false);
    const [renameValue, setRenameValue] = useState("");
    const [renameLoading, setRenameLoading] = useState(false);

    const [deleteOpen, setDeleteOpen] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);

    const [memberLoading, setMemberLoading] = useState<Record<string, boolean>>({});

    function loadClub() {
        if (!clubId) return;
        setLoading(true);
        getClubPromise(clubId)
            .then((data) => setClub(data))
            .finally(() => setLoading(false));
    }

    useEffect(() => {
        loadClub();
    }, [clubId]);

    async function confirmRename() {
        if (!club || !renameValue.trim() || renameValue.trim() === club.name) {
            setRenameOpen(false);
            return;
        }
        try {
            setRenameLoading(true);
            const updated = await patchClubPromise(clubId, { name: renameValue.trim() });
            setClub((prev) => prev ? { ...prev, name: updated.name } : prev);
            invalidateClubs();
            setRenameOpen(false);
        } catch {
            // toast shown by API helper
        } finally {
            setRenameLoading(false);
        }
    }

    async function confirmDelete() {
        try {
            setDeleteLoading(true);
            await deleteClubPromise(clubId);
            invalidateClubs();
            router.push("/admin/clubs");
        } catch {
            setDeleteLoading(false);
            setDeleteOpen(false);
        }
    }

    async function toggleMember(playerId: number, isMember: boolean) {
        const key = String(playerId);
        try {
            setMemberLoading((p) => ({ ...p, [key]: true }));
            if (isMember) {
                await removeClubMemberPromise(clubId, playerId);
                setClub((prev) => prev ? { ...prev, players: prev.players.filter((id) => id !== playerId) } : prev);
            } else {
                await addClubMemberPromise(clubId, playerId);
                setClub((prev) => prev ? { ...prev, players: [...prev.players, playerId] } : prev);
            }
            invalidateClubs();
        } catch {
            // toast shown by API helper
        } finally {
            setMemberLoading((p) => ({ ...p, [key]: false }));
        }
    }

    if (!clubId) {
        return <main className="p-4"><p>Не указан ID клуба.</p></main>;
    }

    if (loading) {
        return <main className="p-4"><p>Загрузка...</p></main>;
    }

    if (!club) {
        return <main className="p-4"><p>Клуб не найден.</p></main>;
    }

    const memberSet = new Set(club.players);
    const sortedPlayers = [...players].sort((a, b) =>
        playerDisplayName(a).localeCompare(playerDisplayName(b), undefined, { sensitivity: "base" })
    );

    return (
        <main className="p-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4">
                <h1 className="text-2xl font-semibold">{clubDisplayName(club)}</h1>
                <div className="mt-2 sm:mt-0">
                    <Link href="/admin/clubs" className="text-sm text-blue-600">
                        Назад
                    </Link>
                </div>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
                Удаление клуба возможно только если в нём нет игроков.
            </p>


            <div className="flex gap-2 mb-8">
                <Button
                    variant="secondary"
                    onClick={() => { setRenameValue(club.name); setRenameOpen(true); }}
                    disabled={!canEdit}
                >
                    Переименовать
                </Button>
                <Button
                    variant="destructive"
                    onClick={() => setDeleteOpen(true)}
                    disabled={!canEdit}
                >
                    Удалить клуб
                </Button>
            </div>

            <section>
                <h2 className="text-lg font-medium mb-3">
                    Игроки клуба ({club.players.length})
                </h2>
                {sortedPlayers.length === 0 ? (
                    <p>Нет игроков</p>
                ) : (
                    <div className="space-y-1">
                        {sortedPlayers.map((player) => {
                            const isMember = memberSet.has(Number(player.id));
                            const isLoading = !!memberLoading[player.id];
                            return (
                                <div key={player.id} className="flex items-center justify-between border rounded p-2">
                                    <span className={isMember ? "font-medium" : "text-muted-foreground"}>
                                        {playerDisplayName(player)}
                                    </span>
                                    <Button
                                        variant={isMember ? "destructive" : "outline"}
                                        size="sm"
                                        onClick={() => toggleMember(Number(player.id), isMember)}
                                        disabled={!canEdit || isLoading}
                                    >
                                        {isLoading ? "..." : isMember ? "Исключить" : "Добавить"}
                                    </Button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* Rename dialog */}
            <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Переименовать клуб</DialogTitle>
                        <DialogDescription>Введите новое название клуба.</DialogDescription>
                    </DialogHeader>
                    <div className="mt-2">
                        <input
                            className="w-full rounded border p-2"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") confirmRename(); }}
                            aria-label="New club name"
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRenameOpen(false)} disabled={renameLoading}>
                            Отмена
                        </Button>
                        <Button onClick={confirmRename} disabled={renameLoading}>
                            {renameLoading ? "Сохранение..." : "Сохранить"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete confirm dialog */}
            <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Удалить клуб</DialogTitle>
                        <DialogDescription>
                            Вы уверены, что хотите удалить клуб &quot;{club.name}&quot;?
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleteLoading}>
                            Отмена
                        </Button>
                        <Button variant="destructive" onClick={confirmDelete} disabled={deleteLoading}>
                            {deleteLoading ? "Удаление..." : "Удалить"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </main>
    );
}
