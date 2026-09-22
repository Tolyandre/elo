"use client";

import { Suspense } from "react";
import { TablePage } from "@/components/tables/table-page";

// The unified live-table page (ADR-16): the game is never part of the URL —
// it is resolved from the bound table's game_id and rendered through the
// game-app registry (components/tables/registry.tsx). New tables are created
// on /matches/new (the «Стол» tab).
export default function MatchesTablePage() {
    // The ?id= deep-link binding reads the query string; a Suspense
    // boundary keeps the prerendered shell decoupled from client query state,
    // same as the other query-bound pages.
    return (
        <Suspense>
            <TablePage />
        </Suspense>
    );
}
