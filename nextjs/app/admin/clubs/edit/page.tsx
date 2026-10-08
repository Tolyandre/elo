"use client"
import React, { Suspense, useEffect, useState } from "react";
import { PageHeader } from "@/app/pageHeaderContext";
import { useSearchParams, useRouter } from "next/navigation";
import { Base58ID, toBase58ID } from "@/lib/id";
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
import { ClubMemberHistory } from "@/components/club-member-history";
import { AdminPageTabs } from "@/components/admin/admin-page-tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/page-container";
import { LoadingRows } from "@/components/loading-rows";
import { EmptyState } from "@/components/empty-state";
import { BackButton } from "@/components/back-button";
import { ClubIcons } from "@/components/player-name";
import { IconPicker } from "@/components/icon-picker";

export default function ClubAdminPage() {
    return (
        <Suspense fallback={<PageContainer width="form"><LoadingRows /></PageContainer>}>
            <ClubAdminContent />
        </Suspense>
    );
}

function ClubAdminContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const clubId = toBase58ID(searchParams.get("id") ?? "");
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
        await deleteClubPromise(clubId!);
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
            const updated = await patchClubPromise(clubId!, { name: renameValue.trim() });
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
            const updated = await patchClubPromise(clubId!, { icon });
            setClub((prev) => prev ? { ...prev, icon: updated.icon } : prev);
            invalidateClubs();
        } catch (e) {
            setIconError(apiErrorMessage(e, "Не удалось сохранить иконку"));
        } finally {
            setIconLoading(false);
        }
    }

    async function toggleMember(playerId: Base58ID, isMember: boolean) {
        const key = playerId;
        try {
            setMemberLoading((p) => ({ ...p, [key]: true }));
            if (isMember) {
                await removeClubMemberPromise(clubId!, playerId);
                setClub((prev) => prev ? { ...prev, player_ids: prev.player_ids.filter((id) => id !== playerId) } : prev);
            } else {
                await addClubMemberPromise(clubId!, playerId);
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
        return <PageContainer width="form"><EmptyState title="Не указан ID клуба." /></PageContainer>;
    }

    if (loading) {
        return <PageContainer width="form"><LoadingRows /></PageContainer>;
    }

    if (!club) {
        return <PageContainer width="form"><EmptyState title="Клуб не найден." /></PageContainer>;
    }

    const memberSet = new Set(club.player_ids);
    const sortedPlayers = [...players].sort((a, b) =>
        playerDisplayName(a).localeCompare(playerDisplayName(b), undefined, { sensitivity: "base" })
    );

    return (
        <PageContainer width="form">
            <PageHeader title={clubDisplayName(club)} />
            <BackButton href="/admin/clubs" />
            <p className="text-sm text-muted-foreground mb-4">
                Удаление клуба возможно только если в нём нет игроков.
            </p>

            <AdminPageTabs entityType="club" entityId={clubId} mainLabel="Клуб">

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
                <IconPicker
                    value={club.icon ?? null}
                    onChange={setIcon}
                    disabled={!canEdit || iconLoading}
                />
                <p className="text-sm text-muted-foreground mt-2">
                    Выберите одну из встроенных иконок. Иконка отображается перед названием клуба и перед именами его игроков.
                </p>
                {iconError && <p className="text-sm text-destructive mt-1">{iconError}</p>}
            </section>

            <section>
                <h2 className="text-lg font-medium mb-3">
                    Игроки клуба ({club.player_ids.length})
                </h2>
                {sortedPlayers.length === 0 ? (
                    <EmptyState title="Нет игроков" />
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

            <ClubMemberHistory clubId={clubId} revision={club.player_ids.join(",")} />
            </AdminPageTabs>

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
                    <Input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") confirmRename(); }}
                        aria-label="Новое название клуба"
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
        </PageContainer>
    );
}
