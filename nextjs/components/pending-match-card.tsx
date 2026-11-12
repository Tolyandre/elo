"use client";

import React from "react";
import { MatchEntity, withLocalSettlement } from "@/lib/offline/match-entity";
import type { PendingMatch } from "@/lib/offline/types";
import { useOpNameHelpers } from "@/hooks/useOpNameHelpers";
import { useLocalRatings } from "@/app/offline/ratings/LocalRatingsContext";
import { MatchCard } from "@/components/match-card";

export { PendingSyncBadge } from "@/components/pending-sync-badge";

// Card for a match created offline and not yet synced — a thin adapter over
// the unified MatchCard: the queued shape converts through MatchEntity and
// the dashed border + status chip mark the unsynced state. The settlement
// columns fill from the local replay when one exists (ADR-38) — provisional
// values the server refines at sync; the scope is the tenant captured on the
// queued item (the same one the sync will submit it under). When `clickable`,
// it opens the match detail page where edit and delete actions live (delete
// is the escape hatch when the server rejects the item after reconnecting).
// `children` renders extra content inside the card — the /offline queue adds
// the op's field-level change list there; `actions` renders the footer
// buttons (their clicks must not trigger the card's own navigation).
export function PendingMatchCard({
    match,
    clickable = false,
    children,
    actions,
}: {
    match: PendingMatch;
    clickable?: boolean;
    children?: React.ReactNode;
    actions?: React.ReactNode;
}) {
    const helpers = useOpNameHelpers();
    const { getMatchSettlement } = useLocalRatings();
    const entity = MatchEntity.resolve(match.clientId, { pending: match });
    if (!entity) return null;

    const effective = withLocalSettlement(
        entity.effective(helpers),
        getMatchSettlement(match.clientId, match.tenantId ?? null),
    );

    return (
        <MatchCard
            match={effective}
            pending
            syncStatus={match.status}
            syncError={match.error}
            clickable={clickable}
            actions={actions}
        >
            {children}
        </MatchCard>
    );
}
