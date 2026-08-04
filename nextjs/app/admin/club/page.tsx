"use client"
import React, { Suspense, useEffect, useState } from "react";
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
import { ConfirmDialog, ConfirmDialogWithContent, useConfirmAction } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { ClubIcons } from "@/components/player-name";
import { CLUB_ICONS, clubIconSrc, isValidClubIcon } from "@/lib/club-icons";
import { cn } from "@/lib/utils";

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

    const [memberLoading, setMemberLoading] = useState<Record<string, boolean>>({});

    const [iconLoading, setIconLoading] = useState(false);
    const [iconError, setIconError] = useState<string | null>(null);

    const del = useConfirmAction<boolean>(async () => {
        await deleteClubPromise(clubId);
        invalidateClubs();
        router.push("/admin/clubs");
    });

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

    async function setIcon(icon: string) {
        try {
            setIconError(null);
            setIconLoading(true);
            const updated = await patchClubPromise(clubId, { icon });
            setClub((prev) => prev ? { ...prev, icon: updated.icon } : prev);
            invalidateClubs();
        } catch (e) {
            setIconError(apiErrorMessage(e, "Не удалось сохранить иконку"));
        } finally {
            setIconLoading(false);
        }
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
                    onClick={() => del.trigger(true)}
                    disabled={!canEdit}
                >
                    Удалить клуб
                </Button>
            </div>

            <section className="mb-8">
                <h2 className="text-lg font-medium mb-3">Иконка клуба</h2>
                <div className="flex items-center gap-2 flex-wrap">
                    <button
                        type="button"
                        onClick={() => setIcon("")}
                        disabled={!canEdit || iconLoading}
                        className={cn(
                            "inline-flex h-12 w-12 items-center justify-center rounded border bg-muted/30 text-xs text-muted-foreground",
                            !isValidClubIcon(club.icon) && "ring-2 ring-blue-500 border-blue-500",
                        )}
                        title="Без иконки"
                    >
                        нет
                    </button>
                    {CLUB_ICONS.map(({ key, label }) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setIcon(key)}
                            disabled={!canEdit || iconLoading}
                            className={cn(
                                "inline-flex h-12 w-12 items-center justify-center rounded border bg-muted/30",
                                club.icon === key && "ring-2 ring-blue-500 border-blue-500",
                            )}
                            title={label}
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={clubIconSrc(key)} alt={label} className="h-8 w-8" />
                        </button>
                    ))}
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                    Выберите одну из встроенных иконок. Иконка отображается перед названием клуба и перед именами его игроков.
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
            <ConfirmDialogWithContent
                open={renameOpen}
                onOpenChange={setRenameOpen}
                title="Переименовать клуб"
                description="Введите новое название клуба."
                confirmText="Сохранить"
                loading={renameLoading}
                onConfirm={confirmRename}
            >
                <div className="mt-2">
                    <input
                        className="w-full rounded border p-2"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") confirmRename(); }}
                        aria-label="New club name"
                    />
                </div>
            </ConfirmDialogWithContent>

            {/* Delete confirm dialog */}
            <ConfirmDialog
                open={del.open}
                onOpenChange={del.onOpenChange}
                title="Удалить клуб"
                description={club ? <>Вы уверены, что хотите удалить клуб &quot;{club.name}&quot;?</> : undefined}
                confirmText="Удалить"
                confirmVariant="destructive"
                loading={del.pending}
                onConfirm={del.confirm}
            />
        </main>
    );
}
