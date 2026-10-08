"use client"
import React, { useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/app/pageHeaderContext";
import { createTenantPromise } from "@/app/api";
import { useMe } from "@/app/meContext";
import { useTenants } from "@/app/tenantsContext";
import { useOffline } from "@/app/offline/OfflineContext";
import { AdminPageTabs } from "@/components/admin/admin-page-tabs";
import { TenantIcon } from "@/components/tenant-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/page-container";
import { EmptyState } from "@/components/empty-state";
import { BackButton } from "@/components/back-button";

export default function TenantsAdminPage() {
    const { canEdit } = useMe();
    const { offline } = useOffline();
    const { tenants, invalidate } = useTenants();
    const [newName, setNewName] = useState("");
    const [creating, setCreating] = useState(false);

    const sortedTenants = [...tenants].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    async function handleCreate() {
        if (!newName.trim() || creating) return;
        try {
            setCreating(true);
            await createTenantPromise({
                name: newName.trim(),
                // New tenants start open: the ADR-36 defaults for «Синие люди».
                arena_membership_mode: "any_member",
                tournaments_openness: "open",
            });
            setNewName("");
            invalidate();
        } catch {
            // toast shown by API helper
        } finally {
            setCreating(false);
        }
    }

    return (
        <PageContainer width="full">
            <PageHeader title="Управление сообществами" />
            <BackButton href="/admin" />

            <AdminPageTabs entityType="tenant" mainLabel="Сообщества">
            <div className="mb-6 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <Input
                    className="flex-1"
                    placeholder="Название сообщества"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
                    disabled={creating || offline}
                />
                <div className="w-full sm:w-auto">
                    <Button onClick={handleCreate} disabled={!canEdit || creating || !newName.trim() || offline}>
                        {creating ? "Создание..." : "Добавить"}
                    </Button>
                </div>
            </div>

            {sortedTenants.length === 0 && <EmptyState title="Нет сообществ" />}

            {sortedTenants.length > 0 && (
                <section>
                    <h2 className="text-lg font-medium mb-3">Список сообществ</h2>
                    <div className="space-y-2">
                        {sortedTenants.map((tenant) => (
                            <div key={tenant.id} className="border rounded p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                                <div className="flex-1 min-w-0">
                                    <Link href={`/?tenant=${tenant.id}`} className="font-medium underline inline-flex items-center gap-1.5 min-w-0">
                                        <TenantIcon icon={tenant.icon} />
                                        <span className="truncate">{tenant.name}</span>
                                    </Link>
                                </div>
                                <div className="w-full sm:w-auto">
                                    <Button asChild variant="outline" className="w-full sm:w-auto">
                                        <Link href={`/admin/tenants/edit?id=${tenant.id}`}>Настроить</Link>
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}
            </AdminPageTabs>
        </PageContainer>
    );
}
