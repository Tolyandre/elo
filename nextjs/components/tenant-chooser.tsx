"use client";

import { Users } from "lucide-react";
import { useTenantScope } from "@/app/tenantScopeContext";
import { useTenants } from "@/app/tenantsContext";
import { TenantIcon } from "@/components/tenant-icon";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { LoadingRows } from "@/components/loading-rows";

/**
 * The one "no community chosen" surface (ADR-36 phase 7): every
 * tenant-dependent page renders it in place of its content when the tenant
 * scope resolves to nothing. No silent defaults — the resolution chain stops
 * at the URL param and the stored choice, and this banner is where a fresh
 * visit lands. Clicking a tenant stores the choice and carries ?tenant= into
 * the URL, so deep-linkable pages keep it on refresh and sharing.
 */
export function TenantChooser() {
    const { tenants, loading } = useTenants();
    const { setTenant } = useTenantScope();

    return (
        <EmptyState icon={Users} title="Выберите сообщество">
            {loading ? (
                <LoadingRows count={2} />
            ) : (
                <div className="flex min-w-56 flex-col gap-2 pt-1">
                    {tenants.map((t) => (
                        <Button key={t.id} variant="outline" onClick={() => setTenant(t.id)}>
                            <TenantIcon icon={t.icon} className="mr-1" />
                            {t.name}
                        </Button>
                    ))}
                </div>
            )}
        </EmptyState>
    );
}
