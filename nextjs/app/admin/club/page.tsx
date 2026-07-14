"use client"
import React, { Suspense, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/app/pageHeaderContext";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
    getClubPromise,
    patchClubPromise,
    deleteClubPromise,
    addClubMemberPromise,
    removeClubMemberPromise,
    apiErrorMessage,
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
import { ClubIcon } from "@/components/club-icon";
import { ClubIcons } from "@/components/player-name";

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

    const [iconLoading, setIconLoading] = useState(false);
    const [iconError, setIconError] = useState<string | null>(null);
    const iconInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!clubId) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- loading indicator before async fetch
        setLoading(true);
        getClubPromise(clubId)
            .then((data) => setClub(data))
            .finally(() => setLoading(false));
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

    async function saveIcon(iconSvg: string) {
        try {
            setIconError(null);
            setIconLoading(true);
            const updated = await patchClubPromise(clubId, { icon_svg: iconSvg });
            setClub((prev) => prev ? { ...prev, icon_svg: updated.icon_svg } : prev);
            invalidateClubs();
        } catch (e) {
            setIconError(apiErrorMessage(e, "Не удалось сохранить иконку"));
        } finally {
            setIconLoading(false);
        }
    }

    async function onPickIcon(file: File | undefined) {
        if (iconInputRef.current) iconInputRef.current.value = "";
        if (!file) return;
        if (file.size > 32 * 1024) {
            setIconError("Файл слишком большой (максимум 32 КБ).");
            return;
        }
        const text = await file.text();
        if (!text.includes("<svg")) {
            setIconError("Это не похоже на SVG-файл.");
            return;
        }
        await saveIcon(text);
    }

    async function toggleMember(playerId: string, isMember: boolean) {
        const key = playerId;
        try {
            setMemberLoading((p) => ({ ...p, [key]: true }));
            if (isMember) {
                await removeClubMemberPromise(clubId, playerId);
                setClub((prev) => prev ? { ...prev, player_ids: prev.player_ids.filter((id) => id !== playerId) } : prev);
            } else {
                await addClubMemberPromise(clubId, playerId);
                setClub((prev) => prev ? { ...prev, player_ids: [...prev.player_ids, playerId] } : prev);
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

    const memberSet = new Set(club.player_ids);
    const sortedPlayers = [...players].sort((a, b) =>
        playerDisplayName(a).localeCompare(playerDisplayName(b), undefined, { sensitivity: "base" })
    );

    return (
        <main className="p-4">
            <PageHeader title={clubDisplayName(club)} />
            <div className="mb-4">
                <Link href="/admin/clubs" className="text-sm text-blue-600">Назад</Link>
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

            <section className="mb-8">
                <h2 className="text-lg font-medium mb-3">Иконка клуба</h2>
                <div className="flex items-center gap-3 flex-wrap">
                    <span className="inline-flex h-12 w-12 items-center justify-center rounded border bg-muted/30">
                        {club.icon_svg
                            ? <ClubIcon club={club} className="h-8 w-8" />
                            : <span className="text-xs text-muted-foreground">нет</span>}
                    </span>
                    <input
                        ref={iconInputRef}
                        type="file"
                        accept=".svg,image/svg+xml"
                        className="hidden"
                        onChange={(e) => onPickIcon(e.target.files?.[0])}
                    />
                    <Button
                        variant="secondary"
                        onClick={() => iconInputRef.current?.click()}
                        disabled={!canEdit || iconLoading}
                    >
                        {iconLoading ? "Загрузка..." : "Загрузить SVG"}
                    </Button>
                    {club.icon_svg && (
                        <Button
                            variant="outline"
                            onClick={() => saveIcon("")}
                            disabled={!canEdit || iconLoading}
                        >
                            Убрать
                        </Button>
                    )}
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                    Только векторный формат (SVG), до 32 КБ. Иконка отображается перед названием клуба и перед именами его игроков.
                </p>
                {iconError && <p className="text-sm text-red-600 mt-1">{iconError}</p>}
            </section>

            <section>
                <h2 className="text-lg font-medium mb-3">
                    Игроки клуба ({club.player_ids.length})
                </h2>
                {sortedPlayers.length === 0 ? (
                    <p>Нет игроков</p>
                ) : (
                    <div className="space-y-1">
                        {sortedPlayers.map((player) => {
                            const isMember = memberSet.has(player.id);
                            const isLoading = !!memberLoading[player.id];
                            return (
                                <div key={player.id} className="flex items-center justify-between border rounded p-2">
                                    <span className={`flex items-center gap-1 ${isMember ? "font-medium" : "text-muted-foreground"}`}>
                                        <ClubIcons playerId={player.id} />
                                        {playerDisplayName(player)}
                                    </span>
                                    <Button
                                        variant={isMember ? "destructive" : "outline"}
                                        size="sm"
                                        onClick={() => toggleMember(player.id, isMember)}
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
