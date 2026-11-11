"use client";

import React from "react";
import { MatchEntity } from "@/lib/offline/match-entity";
import type { PendingMatch } from "@/lib/offline/types";
import { useOpNameHelpers } from "@/hooks/useOpNameHelpers";
import { useSettlementPreview } from "@/hooks/useSettlementPreview";
import { MatchCard } from "@/components/match-card";

export { PendingSyncBadge } from "@/components/pending-sync-badge";

// Card for a match created offline and not yet synced — a thin adapter over
// the unified MatchCard: the queued shape converts through MatchEntity, the
// client-side Elo preview fills the delta column, and the dashed border +
// status chip mark the unsynced state. When `clickable`, it opens the match
// detail page where edit and delete actions live (delete is the escape hatch
// when the server rejects the item after reconnecting). `children` renders
// extra content inside the card — the /offline queue adds the op's
// field-level change list there; `actions` renders the footer buttons (their
// clicks must not trigger the card's own navigation).
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
    // A queued create settles only after the sync — preview the Elo now.
    // Coop matches never settle; they pass no score map.
    const preview = useSettlementPreview(match.mode === "coop" ? null : match.score, new Date(match.createdAt));

    const entity = MatchEntity.resolve(match.clientId, { pending: match });
    if (!entity) return null;

    return (
        <MatchCard
            match={entity.effective(helpers)}
            pending
            syncStatus={match.status}
            syncError={match.error}
            preview={preview}
            clickable={clickable}
            actions={actions}
        >
            {children}
        </MatchCard>
    );
}
