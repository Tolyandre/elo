"use client"
import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CloudOff, Users } from "lucide-react";
import { toBase58ID, type Base58ID } from "@/lib/id";
import {
    getArenaPromise,
    getTenantPromise,
    patchTenantPromise,
    setTenantClubsPromise,
    type ArenaSettings,
    type Tenant,
} from "@/app/api";
import { PageHeader } from "@/app/pageHeaderContext";
import { useMe } from "@/app/meContext";
import { useClubs } from "@/app/clubsContext";
import { useOffline } from "@/app/offline/OfflineContext";
import { PageContainer } from "@/components/page-container";
import { LoadingRows } from "@/components/loading-rows";
import { ErrorAlert } from "@/components/error-alert";
import { BackButton } from "@/components/back-button";
import { IconPicker } from "@/components/icon-picker";
import { TenantIcon } from "@/components/tenant-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { MultiSelect } from "@/components/vendor/multi-select";
import { ClubIcon } from "@/components/club-icon";
import {
    ArenaSettingsFields,
    ArenaSettingsValues,
    buildSettingsFromValues,
    initialSettingsValues,
    settingsValuesError,
} from "@/components/arena-settings-editor";
import { MEMBERSHIP_MODE_LABELS, TOURNAMENTS_OPENNESS_LABELS } from "../labels";

export default function TenantSettingsPage() {
    return (
        <Suspense fallback={<PageContainer width="form"><LoadingRows /></PageContainer>}>
            <TenantSettingsContent />
        </Suspense>
    );
}

function TenantSettingsContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const tenantId = toBase58ID(searchParams.get("id") ?? "");
    const { canEdit } = useMe();
    const { offline } = useOffline();
    const { clubs, clubDisplayName } = useClubs();

    const [tenant, setTenant] = useState<Tenant | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Form state: one save applies the tenant PATCH (name, icon, openness,
    // main-arena settings) and, when the composition changed, the clubs PUT.
    const [name, setName] = useState("");
    const [icon, setIcon] = useState("");
    const [membershipMode, setMembershipMode] = useState<Tenant["arena_membership_mode"]>("any_member");
    const [tournamentsOpenness, setTournamentsOpenness] = useState<Tenant["tournaments_openness"]>("open");
    const [clubIds, setClubIds] = useState<Base58ID[]>([]);
    const [originalClubIds, setOriginalClubIds] = useState<Base58ID[]>([]);
    const [settings, setSettings] = useState<ArenaSettingsValues | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!tenantId) return;
        let cancelled = false;
        /* eslint-disable-next-line react-hooks/set-state-in-effect -- loading indicator before async fetch */
        setLoading(true);
        setLoadError(null);
        (async () => {
            try {
                const tenant = await getTenantPromise(tenantId);
                if (cancelled) return;
                setTenant(tenant);
                setName(tenant.name);
                setIcon(tenant.icon ?? "");
                setMembershipMode(tenant.arena_membership_mode);
                setTournamentsOpenness(tenant.tournaments_openness);
                setClubIds(tenant.club_ids);
                setOriginalClubIds(tenant.club_ids);
                if (tenant.main_arena_id) {
                    const arena = await getArenaPromise(tenant.main_arena_id);
                    if (cancelled) return;
                    setSettings(initialSettingsValues(arena.settings, { withLeagues: true }));
                } else {
                    setSettings(initialSettingsValues(null, { withLeagues: true }));
                }
            } catch (e) {
                if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [tenantId]);

    // Every club is a candidate; the ones owned by another tenant are shown
    // but disabled. The dropdown carries each club's icon.
    const clubOptions = useMemo(
        () => [...clubs]
            .sort((a, b) => clubDisplayName(a).localeCompare(clubDisplayName(b), undefined, { sensitivity: "base" }))
            .map((c) => ({
                value: c.id,
                label: clubDisplayName(c),
                disabled: !!c.tenant_id && !!tenant && c.tenant_id !== tenant.id,
                icon: () => <ClubIcon club={c} />,
            })),
        [clubs, clubDisplayName, tenant],
    );

    const canSubmit = !submitting && canEdit && !offline && !!settings;

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!canSubmit || !tenant || !settings) return;
        if (!name.trim()) {
            setError("Укажите название сообщества");
            return;
        }
        const settingsError = settingsValuesError(settings);
        if (settingsError) {
            setError(settingsError);
            return;
        }
        setError("");
        setSubmitting(true);
        try {
            const doc: ArenaSettings = buildSettingsFromValues(settings);
            await patchTenantPromise(tenant.id, {
                name: name.trim(),
                icon,
                arena_membership_mode: membershipMode,
                tournaments_openness: tournamentsOpenness,
                settings: doc,
            });
            const sameClubs =
                clubIds.length === originalClubIds.length &&
                clubIds.every((id) => originalClubIds.includes(id));
            if (!sameClubs) {
                await setTenantClubsPromise(tenant.id, clubIds);
            }
            toast.success("Настройки сообщества сохранены — арена пересчитывается в фоне");
            router.push("/admin/tenants");
        } catch (err) {
            // The API helper already shows a toast; surface the message inline
            // too (e.g. the duplicate-name validation).
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSubmitting(false);
        }
    }

    if (!tenantId) {
        return (
            <PageContainer width="form">
                <PageHeader title="Настройки сообщества" />
                <BackButton href="/admin/tenants" />
                <p className="text-muted-foreground">Сообщество не указано</p>
            </PageContainer>
        );
    }

    if (loading) {
        return (
            <PageContainer width="form">
                <PageHeader title="Настройки сообщества" />
                <BackButton href="/admin/tenants" />
                <LoadingRows />
            </PageContainer>
        );
    }

    if (loadError || !tenant) {
        return (
            <PageContainer width="form">
                <PageHeader title="Настройки сообщества" />
                <BackButton href="/admin/tenants" />
                <ErrorAlert message={loadError ?? "Сообщество не найдено"} />
            </PageContainer>
        );
    }

    return (
        <PageContainer width="form">
            <PageHeader
                title={`Сообщество «${tenant.name}»`}
                icon={tenant.icon ? <TenantIcon icon={tenant.icon} className="h-6 w-6" /> : undefined}
            />
            <BackButton href="/admin/tenants" />

            <form onSubmit={handleSubmit} className="space-y-4">
                {offline && (
                    <Alert variant="destructive">
                        <CloudOff />
                        <AlertTitle>Нет связи с сервером — настройки недоступны</AlertTitle>
                        <AlertDescription>Попробуйте снова, когда соединение восстановится.</AlertDescription>
                    </Alert>
                )}

                <Card>
                    <CardHeader>
                        <CardTitle>Иконка</CardTitle>
                        <CardDescription>
                            Отображается перед названием сообщества — в меню и в списке сообществ.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <IconPicker value={icon} onChange={setIcon} disabled={!canEdit} />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Название</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1.5">
                        <Input
                            id="tenantName"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            disabled={!canEdit}
                        />
                        <p className="text-xs text-muted-foreground">
                            Должно быть уникальным. Главная арена называется по сообществу и переименовывается вместе с ним.
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Открытость</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-col sm:flex-row gap-4">
                            <div className="flex-1 space-y-1.5">
                                <label className="block text-sm" htmlFor="tenantMembershipMode">Какие партии идут в общий рейтинг:</label>
                                <Select
                                    value={membershipMode}
                                    onValueChange={(v) => setMembershipMode(v as Tenant["arena_membership_mode"])}
                                    disabled={!canEdit}
                                >
                                    <SelectTrigger id="tenantMembershipMode" className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="any_member">{MEMBERSHIP_MODE_LABELS.any_member}</SelectItem>
                                        <SelectItem value="members_only">{MEMBERSHIP_MODE_LABELS.members_only}</SelectItem>
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    Смена правила пересчитывает рейтинг сообщества с самого начала.
                                </p>
                            </div>
                            <div className="flex-1 space-y-1.5">
                                <label className="block text-sm" htmlFor="tenantOpenness">Турниры:</label>
                                <Select
                                    value={tournamentsOpenness}
                                    onValueChange={(v) => setTournamentsOpenness(v as Tenant["tournaments_openness"])}
                                    disabled={!canEdit}
                                >
                                    <SelectTrigger id="tenantOpenness" className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="members_only">{TOURNAMENTS_OPENNESS_LABELS.members_only}</SelectItem>
                                        <SelectItem value="open">{TOURNAMENTS_OPENNESS_LABELS.open}</SelectItem>
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    Кто может регистрироваться в турнирах сообщества.
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-1.5"><Users className="size-4" /> Клубы сообщества</CardTitle>
                        <CardDescription>
                            Принадлежность сообществу задаётся клубами: участник сообщества — активный участник любого из них.
                            Изменение состава пересчитывает рейтинг сообщества. Затемнённые клубы уже принадлежат другому сообществу.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <MultiSelect
                            options={clubOptions}
                            placeholder="Клубы сообщества"
                            searchPlaceholder="Искать клуб..."
                            hideSelectAll={true}
                            onValueChange={(ids: string[]) => setClubIds(ids as Base58ID[])}
                            defaultValue={clubIds}
                        />
                    </CardContent>
                </Card>

                {settings && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Главная арена</CardTitle>
                            <CardDescription>
                                Смена стартового рейтинга или лиг пересчитывает рейтинг сообщества с самого
                                начала — в фоне, уже после сохранения.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ArenaSettingsFields
                                values={settings}
                                onChange={setSettings}
                                disabled={!canEdit}
                                idPrefix="tenantArena"
                            />
                        </CardContent>
                    </Card>
                )}

                {error && <div className="text-destructive text-sm">{error}</div>}

                <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={!canSubmit}>
                        {submitting ? "Сохранение..." : "Сохранить изменения"}
                    </Button>
                </div>
            </form>
        </PageContainer>
    );
}
