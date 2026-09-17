"use client";

import { PageHeader } from "@/app/pageHeaderContext";

/**
 * Placeholder until ADR-26 fills the page with bracket tournaments. Camps
 * (the old camp tournaments) live on the arenas page now (ADR-27), so the
 * list is intentionally empty.
 */
export default function TournamentsPage() {
    return (
        <main className="max-w-sm mx-auto space-y-6">
            <PageHeader title="Турниры" />
            <p className="text-muted-foreground">Турниров пока нет</p>
        </main>
    );
}
