"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import { useGames } from "@/app/gamesContext";
import { useOpNameHelpers } from "@/hooks/useOpNameHelpers";
import { useSettlementPreview } from "@/hooks/useSettlementPreview";
import { opChangeRows } from "@/lib/offline/op-display";
import { MatchEntity } from "@/lib/offline/match-entity";
import type { PendingOp } from "@/lib/offline/types";
import { PendingSyncBadge } from "@/components/pending-sync-badge";
import { MatchCard } from "@/components/match-card";
import { GameCard } from "@/components/game-card";
import { DiffRow } from "@/components/audit/diff";

/**
 * What an offline edit op changes, in the audit details style: struck-through
 * old value → emphasized new one, per field. Renders nothing when the patch
 * carries no visible change (e.g. after conflict resolution took the server's
 * values).
 */
export function OpChanges({ op }: { op: PendingOp }) {
    const helpers = useOpNameHelpers();

    const rows = opChangeRows(op.kind, op.base ?? {}, op.patch ?? {}, helpers);
    if (rows.length === 0) return null;

    return (
        <dl className="space-y-1.5 text-sm">
            {rows.map((row, i) => {
                if (row.kind === "value") {
                    return <DiffRow key={i} label={row.label} from={row.from} to={row.to} />;
                }
                if (row.kind === "collection") {
                    // Same +/− listing as the audit «Состав» row: who joined, who left.
                    const parts = [
                        ...row.added.map((n) => `+${n}`),
                        ...row.removed.map((n) => `−${n}`),
                    ].join(", ");
                    return (
                        <div key={i} className="flex flex-wrap gap-x-2">
                            <dt className="text-muted-foreground">{row.label}:</dt>
                            <dd>{parts}</dd>
                        </div>
                    );
                }
                if (row.kind === "opaque") {
                    // The calculator state: no meaningful before/after to show.
                    return (
                        <div key={i} className="flex flex-wrap gap-x-2">
                            <dt className="text-muted-foreground">{row.label}:</dt>
                            <dd className="font-medium">изменены</dd>
                        </div>
                    );
                }
                // Score rows read like the audit match diff: sign-free values, the
                // join/leave note as muted text after the number.
                return (
                    <div key={i} className="flex flex-wrap gap-x-2">
                        <dt className="text-muted-foreground">{row.label}:</dt>
                        <dd>
                            {row.change === "added" && (
                                <span>{row.to} <span className="text-muted-foreground">(добавлен)</span></span>
                            )}
                            {row.change === "removed" && (
                                <span>{row.from} <span className="text-muted-foreground">(удалён)</span></span>
                            )}
                            {row.change === "changed" && (
                                <span>
                                    <span className="text-muted-foreground line-through">{row.from}</span>
                                    {" → "}
                                    <span className="font-medium">{row.to}</span>
                                </span>
                            )}
                        </dd>
                    </div>
                );
            })}
        </dl>
    );
}

/**
 * The entity an op touches, as a card: the unified match card for match edits
 * (display state = the op's merged fields, Elo preview included), the
 * box-art game card for game edits, a name row for player renames — with the
 * change list and the action buttons inside. Only for update ops (deletes
 * keep the compact row).
 */
export function OpEntityCard({ op, actions }: { op: PendingOp; actions?: ReactNode }) {
    const { games } = useGames();

    if (op.kind === "match") {
        if (op.op !== "update") return null;
        return <OpMatchCard op={op} actions={actions} />;
    }

    const statusBadge = <PendingSyncBadge status={op.status} error={op.error} />;

    if (op.kind === "game") {
        const merged = { ...op.base, ...op.patch };
        const thumb = games.find((g) => g.id === op.entityId)?.image_thumb_url ?? null;
        return (
            <div className="border border-dashed rounded p-3 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                    <GameCard
                        game={{
                            name: "",
                            alias: (merged.alias ?? null) as string | null,
                            name_ru: (merged.name_ru ?? null) as string | null,
                            name_en: (merged.name_en ?? null) as string | null,
                        }}
                        thumbUrl={thumb}
                        className="min-w-0"
                    />
                    {statusBadge}
                </div>
                <OpChanges op={op} />
                {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
            </div>
        );
    }

    const name = String(op.patch?.name ?? op.base?.name ?? "");
    return (
        <div className="border border-dashed rounded p-3 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="font-medium truncate min-w-0">{name}</div>
                {statusBadge}
            </div>
            <OpChanges op={op} />
            {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
    );
}

/**
 * The match-edit op as a unified match card: the display state is the op's
 * merged fields (the same `MatchEntity.effective` the match view page and the
 * feed show), with the client-side Elo preview and the change list inside.
 * Its own component so the hooks stay unconditional.
 */
function OpMatchCard({ op, actions }: { op: PendingOp; actions?: ReactNode }) {
    const helpers = useOpNameHelpers();
    const view = useMemo(
        () => MatchEntity.resolve(op.entityId, { op })?.effective(helpers) ?? null,
        [op, helpers],
    );
    const previewScores = useMemo(
        () =>
            view && view.mode !== "coop"
                ? Object.fromEntries(Object.entries(view.score).map(([pid, s]) => [pid, s.score]))
                : null,
        [view],
    );
    const preview = useSettlementPreview(previewScores, view?.date ?? null);
    if (!view) return null;
    return (
        <MatchCard
            match={view}
            pending
            syncStatus={op.status}
            syncError={op.error}
            preview={preview}
            clickable
            actions={actions}
        >
            <OpChanges op={op} />
        </MatchCard>
    );
}
