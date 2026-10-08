"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUrlQuery, setUrlQuery } from "@/lib/url-state";
import { PageHeader } from "@/app/pageHeaderContext";
import { PageContainer } from "@/components/page-container";
import { ErrorAlert } from "@/components/error-alert";
import { LoadingRows } from "@/components/loading-rows";
import { useTenantScope } from "@/app/tenantScopeContext";
import { useTenants } from "@/app/tenantsContext";
import { TenantChooser } from "@/components/tenant-chooser";
import { TenantsLoadError } from "@/components/tenants-load-error";
import { MatchForm, MatchFormAuthAlerts } from "@/app/matches/MatchForm";
import { CreateTableForm } from "@/components/tables/create-table-form";
import { CreateMarketForm } from "@/components/markets/create-market-form";

// The hub for adding entities, one tab each: submit a finished match by hand
// («Партия»), create a live table for a game about to be played («Стол» — the
// game and the participants in seating order are picked upfront; the table
// itself opens on /matches/table) or open a betting market («Рынок» — the
// form carries its own admin alert).
//
// Everything created here belongs to a community (ADR-36): the feed shows a
// match only when its roster satisfies the tenant's openness rule and a
// market only when the tenant owns it — so a creation without a resolved
// tenant would silently land nowhere. The page therefore renders the forms
// only under a tenant; the scope writes ?tenant= back into the URL so links
// and refreshes keep it.
export default function NewEntityPage() {
    const params = useUrlQuery();
    const tabParam = params.get("tab");
    const tab = tabParam === "table" || tabParam === "market" ? tabParam : "match";
    const { tenant, tenantId, ready } = useTenantScope();
    // The tenant object resolves from the tenants list; when that list never
    // loaded (offline, API down) the id must not be reported as a deleted
    // community — offer a retry instead.
    const { error: tenantsError } = useTenants();

    return (
        <PageContainer width="form">
            <PageHeader title="Добавить" />
            {!ready ? (
                <LoadingRows count={3} />
            ) : tenantId != null && tenant == null ? (
                tenantsError ? (
                    // The list failed to load — the community may well exist.
                    <TenantsLoadError />
                ) : (
                    // A well-formed but unknown ?tenant= (removed community, stale link).
                    <ErrorAlert message="Сообщество не найдено — возможно, оно было удалено." />
                )
            ) : tenant == null ? (
                // No community chosen yet: the shared chooser, one click away
                // from storing the choice (ADR-36 phase 7).
                <TenantChooser />
            ) : (
                <>
                    {tab !== "market" && <MatchFormAuthAlerts />}
                    <Tabs value={tab} onValueChange={(v) => setUrlQuery((p) => p.set("tab", v))}>
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="match">Партия</TabsTrigger>
                            <TabsTrigger value="table">Стол</TabsTrigger>
                            <TabsTrigger value="market">Рынок</TabsTrigger>
                        </TabsList>
                        <TabsContent value="match" className="mt-4">
                            <MatchForm />
                        </TabsContent>
                        <TabsContent value="table" className="mt-4">
                            <CreateTableForm />
                        </TabsContent>
                        <TabsContent value="market" className="mt-4">
                            <CreateMarketForm />
                        </TabsContent>
                    </Tabs>
                </>
            )}
        </PageContainer>
    );
}
