"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUrlQuery, setUrlQuery } from "@/lib/url-state";
import { PageHeader } from "@/app/pageHeaderContext";
import { MatchForm, MatchFormAuthAlerts } from "../MatchForm";
import { CreateTableForm } from "@/components/tables/create-table-form";

// Two ways to record a game here, one tab each: submit a finished match by
// hand («Партия») or create a live table for a game about to be played
// («Стол» — the game and the participants in seating order are picked
// upfront; the table itself opens on /matches/table).
export default function NewMatchPage() {
    const params = useUrlQuery();
    const tab = params.get("tab") === "table" ? "table" : "match";

    return (
        <main className="max-w-sm mx-auto p-4 space-y-6">
            <PageHeader title="Добавить партию" />
            <MatchFormAuthAlerts />
            <Tabs value={tab} onValueChange={(v) => setUrlQuery((p) => p.set("tab", v))}>
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="match">Партия</TabsTrigger>
                    <TabsTrigger value="table">Стол</TabsTrigger>
                </TabsList>
                <TabsContent value="match" className="mt-4">
                    <MatchForm />
                </TabsContent>
                <TabsContent value="table" className="mt-4">
                    <CreateTableForm />
                </TabsContent>
            </Tabs>
        </main>
    );
}
