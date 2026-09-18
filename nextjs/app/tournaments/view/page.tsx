"use client";

import { TournamentView } from "./tournament-view";

// Ids travel in the query (?id=…) because a path segment per id cannot be
// statically exported (ADR-25).
export default function TournamentViewPage() {
    return <TournamentView />;
}
