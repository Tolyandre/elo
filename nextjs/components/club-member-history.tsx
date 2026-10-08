"use client";

import { UserMinus, UserPlus } from "lucide-react";
import type { Base58ID } from "@/lib/id";
import { listClubMemberHistoryPromise, type ClubMemberStint } from "@/app/api";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { ErrorAlert } from "@/components/error-alert";
import { LoadingRows } from "@/components/loading-rows";
import { EmptyState } from "@/components/empty-state";
import { formatDateTime } from "@/lib/datetime";

/**
 * The club's membership stint history (ADR-36), styled like audit entries:
 * one row per stint — who joined, when, and whether/when they left. This is
 * the raw material of tenant membership, kept readable for the club admin.
 * `revision` re-fetches after membership changes (the parent passes something
 * that changes with every add/remove).
 */
export function ClubMemberHistory({ clubId, revision }: { clubId: Base58ID; revision: string }) {
    const { data: stints, loading, error } = useAsyncResource(
        () => listClubMemberHistoryPromise(clubId),
        [clubId, revision],
    );

    return (
        <section className="mb-8">
            <h2 className="text-lg font-medium mb-3">История участников</h2>
            {loading && <LoadingRows count={3} />}
            {error && <ErrorAlert message={error} />}
            {stints && stints.length === 0 && <EmptyState title="Пока никто не состоял в клубе" />}
            {stints && stints.length > 0 && (
                <div className="space-y-0">
                    {stints.map((stint, i) => (
                        <StintRow key={`${stint.player_id}-${i}`} stint={stint} />
                    ))}
                </div>
            )}
        </section>
    );
}

function StintRow({ stint }: { stint: ClubMemberStint }) {
    if (!stint.left_at) {
        return (
            <div className="flex items-start gap-2 py-3">
                <UserPlus className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="flex flex-1 flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{stint.player_name}</span>
                    <span>участвует с {formatDateTime(stint.joined_at)}</span>
                    <span className="text-sm text-success">сейчас в клубе</span>
                </div>
            </div>
        );
    }
    return (
        <div className="flex items-start gap-2 py-3">
            <UserMinus className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="flex flex-1 flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{stint.player_name}</span>
                <span className="text-muted-foreground">
                    состоял: с {formatDateTime(stint.joined_at)} до {formatDateTime(stint.left_at)}
                </span>
            </div>
        </div>
    );
}
