"use client";

import React, { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useNameResolver } from "@/hooks/useNameResolver";
import { PendingMatch, SyncStatus } from "@/lib/offline/types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RankIcon } from "@/components/rank-icon";
import { ClubIcons } from "@/components/player-name";
import { CloudOff } from "lucide-react";
import { SplitSquareHorizontal } from "lucide-react";
import { formatDateTime } from "@/lib/datetime";

// Card for a match created offline and not yet synced: no Elo data, with a
// status badge. When `clickable`, it opens the match detail page where edit and
// delete actions live (delete is the escape hatch when the server rejects the
// item after reconnecting). `children` renders extra content inside the card —
// the /offline queue adds the op's field-level change list there; `actions`
// renders the action buttons in the card's footer (their clicks must not
// trigger the card's own navigation).
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
    const { resolvePlayer, resolveGame } = useNameResolver();
    const router = useRouter();

    const gameName = useMemo(() => resolveGame(match.gameId), [match.gameId, resolveGame]);

    const players = useMemo(() => {
        const entries: [string, number][] = match.mode === "coop"
            ? (match.playerIds ?? Object.keys(match.score)).map((id) => [id, 0])
            : Object.entries(match.score);
        return entries
            .map(([playerId, score]) => ({ playerId, name: resolvePlayer(playerId), score }))
            .sort((a, b) => b.score - a.score);
    }, [match.score, match.mode, match.playerIds, resolvePlayer]);

    const createdAt = new Date(match.createdAt);

    // The action footer: buttons sit inside the card; their clicks are stopped
    // from bubbling to the card's own view-page navigation.
    const actionsFooter = actions && (
        <div
            onClick={clickable ? (e) => e.stopPropagation() : undefined}
            className="mt-3 flex flex-wrap gap-2"
        >
            {actions}
        </div>
    );

    // Sync state of the queued item; the syncing state is transient between
    // sync rounds but shows honestly while it lasts.
    const statusBadge = <PendingSyncBadge status={match.status} error={match.error} />;

    // A coop match (ADR-33) has one shared result: a badge + the game score
    // instead of ranked per-player scores.
    if (match.mode === "coop") {
        const won = match.gameWon === true;
        return (
            <Card
                className={clickable ? "border-dashed cursor-pointer hover:bg-accent transition-colors" : "border-dashed"}
                onClick={clickable ? () => router.push(`/matches/view?id=${encodeURIComponent(match.clientId)}`) : undefined}
            >
                <CardHeader>
                    <CardTitle className="flex items-center justify-between w-full flex-wrap gap-2">
                        <span>{gameName}</span>
                        <span className="text-muted-foreground text-sm font-normal">
                            {formatDateTime(createdAt)}
                        </span>
                    </CardTitle>
                    <div className="flex items-center flex-wrap gap-2">
                        {statusBadge}
                        <Badge variant="outline">кооператив</Badge>
                        <Badge variant={won ? "default" : "secondary"} className={won ? "bg-success" : ""}>
                            {won ? "Победа" : "Поражение"}
                        </Badge>
                        {match.gameScore != null && (
                            <span className="text-2xl font-semibold">
                                <span className="text-sm font-normal text-muted-foreground">очки: </span>
                                {match.gameScore}
                            </span>
                        )}
                    </div>
                </CardHeader>

                <CardContent>
                    <div className="flex flex-wrap gap-1">
                        {players.map((p) => (
                            <span
                                key={p.playerId}
                                className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                            >
                                <ClubIcons playerId={p.playerId} className="mr-1" />
                                {p.name}
                            </span>
                        ))}
                    </div>
                    {children}
                    {actionsFooter}
                </CardContent>
            </Card>
        );
    }

    const ranks = players.map((v) => players.findIndex((p) => p.score === v.score) + 1);

    return (
        <Card
            className={clickable ? "border-dashed cursor-pointer hover:bg-accent transition-colors" : "border-dashed"}
            onClick={clickable ? () => router.push(`/matches/view?id=${encodeURIComponent(match.clientId)}`) : undefined}
        >
            <CardHeader>
                <CardTitle className="flex items-center justify-between w-full flex-wrap gap-2">
                    <span>{gameName}</span>
                    <span className="text-muted-foreground text-sm font-normal">
                        {formatDateTime(createdAt)}
                    </span>
                </CardTitle>
                <div className="flex items-center flex-wrap gap-2">
                    {statusBadge}
                    {match.calculatorKind && (
                        <Badge variant="outline">
                            калькулятор
                        </Badge>
                    )}
                </div>
            </CardHeader>

            <CardContent>
                <ul className="space-y-2">
                    {players.map((p, idx) => (
                        <li key={p.playerId} className="flex items-center gap-2">
                            {/* Inline flow (not flex) so icons + name wrap together and a
                                long name reclaims the full width under the icons. */}
                            <div className="flex-1 min-w-0 text-sm">
                                <RankIcon rank={ranks[idx]} className="inline-block align-middle mr-1" />
                                <ClubIcons playerId={p.playerId} className="align-middle mr-1" />
                                <span className="break-words align-middle">{p.name}</span>
                            </div>
                            <div className="text-center text-2xl font-semibold w-12 flex-shrink-0">
                                {p.score}
                            </div>
                        </li>
                    ))}
                </ul>
                {children}
                {actionsFooter}
            </CardContent>
        </Card>
    );
}

/** The queue sync state of any pending item — shared with the /offline page's
 * game/player op rows so all queued entities badge alike. */
export function PendingSyncBadge({ status, error }: { status: SyncStatus; error?: string }) {
    if (status === "error") {
        return (
            <Badge variant="destructive">
                <CloudOff />
                ошибка: {error}
            </Badge>
        );
    }
    if (status === "conflict") {
        return (
            <Badge variant="destructive">
                <SplitSquareHorizontal />
                конфликт
            </Badge>
        );
    }
    if (status === "syncing") {
        return (
            <Badge variant="secondary">
                <CloudOff />
                отправляется…
            </Badge>
        );
    }
    return (
        <Badge variant="secondary">
            <CloudOff />
            не сохранено
        </Badge>
    );
}
