"use client";

import { PageHeader } from "@/app/pageHeaderContext";
import { MatchForm, MatchFormAuthAlerts } from "../MatchForm";

export default function NewMatchPage() {
    return (
        <main className="max-w-sm mx-auto p-4">
            <PageHeader title="Результат партии" />
            <MatchFormAuthAlerts />
            <MatchForm />
        </main>
    );
}
