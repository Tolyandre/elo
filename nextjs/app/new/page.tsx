"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUrlQuery, setUrlQuery } from "@/lib/url-state";
import { PageHeader } from "@/app/pageHeaderContext";
import { PageContainer } from "@/components/page-container";
import { MatchForm, MatchFormAuthAlerts } from "@/app/matches/MatchForm";
import { CreateTableForm } from "@/components/tables/create-table-form";
import { CreateMarketForm } from "@/components/markets/create-market-form";

// The hub for adding entities, one tab each: submit a finished match by hand
// («Партия»), create a live table for a game about to be played («Стол» — the
// game and the participants in seating order are picked upfront; the table
// itself opens on /matches/table) or open a betting market («Рынок» — the
// form carries its own admin alert).
export default function NewEntityPage() {
    const params = useUrlQuery();
    const tabParam = params.get("tab");
    const tab = tabParam === "table" || tabParam === "market" ? tabParam : "match";

    return (
        <PageContainer width="form">
            <PageHeader title="Добавить" />
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
        </PageContainer>
    );
}
