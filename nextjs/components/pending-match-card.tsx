"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlayers } from "@/app/players/PlayersContext";
import { useGames } from "@/app/gamesContext";
import { useOffline } from "@/app/offline/OfflineContext";
import { useMe } from "@/app/meContext";
import { PendingMatch } from "@/lib/offline/types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RankIcon } from "@/components/rank-icon";
import { CloudOff, Pencil, Trash2 } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

// Card for a match created offline and not yet synced: no Elo data, with a
// status badge and edit/delete actions (delete is the escape hatch when the
// server rejects the item after reconnecting).
export function PendingMatchCard({ match }: { match: PendingMatch }) {
    const { playerMap, playerDisplayName } = usePlayers();
    const { games } = useGames();
    const { pendingPlayers, pendingGames, deletePendingMatch } = useOffline();
    const { canEdit } = useMe();
    const router = useRouter();
    const [deleteOpen, setDeleteOpen] = useState(false);

    const gameName = useMemo(() => {
        const pending = pendingGames.find((g) => g.clientId === match.gameId);
        if (pending) return `${pending.name} (офлайн)`;
        return games.find((g) => g.id === match.gameId)?.name ?? "Неизвестная игра";
    }, [match.gameId, games, pendingGames]);

    const players = useMemo(() => {
        return Object.entries(match.score)
            .map(([playerId, score]) => {
                const pending = pendingPlayers.find((p) => p.clientId === playerId);
                const ctxPlayer = playerMap.get(playerId);
                const name = pending
                    ? `${pending.name} (офлайн)`
                    : ctxPlayer
                        ? playerDisplayName(ctxPlayer)
                        : "Unknown";
                return { playerId, name, score };
            })
            .sort((a, b) => b.score - a.score);
    }, [match.score, pendingPlayers, playerMap, playerDisplayName]);

    const ranks = players.map((v) => players.findIndex((p) => p.score === v.score) + 1);
    const createdAt = new Date(match.createdAt);

    return (
        <Card className="border-dashed">
            <CardHeader>
                <CardTitle className="flex items-center justify-between w-full flex-wrap gap-2">
                    <span>{gameName}</span>
                    <span className="text-muted-foreground text-sm font-normal">
                        {createdAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                </CardTitle>
                <div className="flex items-center flex-wrap gap-2">
                    {match.status === "error" ? (
                        <Badge variant="destructive">
                            <CloudOff />
                            ошибка: {match.error}
                        </Badge>
                    ) : (
                        <Badge variant="secondary">
                            <CloudOff />
                            не синхронизировано
                        </Badge>
                    )}
                </div>
            </CardHeader>

            <CardContent>
                <ul className="space-y-2">
                    {players.map((p, idx) => (
                        <li key={p.playerId} className="flex items-center gap-2">
                            <div className="flex-1 min-w-0 flex items-center gap-1">
                                <RankIcon rank={ranks[idx]} />
                                <span className="truncate text-sm">{p.name}</span>
                            </div>
                            <div className="text-center text-2xl font-semibold w-12 flex-shrink-0">
                                {p.score}
                            </div>
                        </li>
                    ))}
                </ul>

                {canEdit && (
                    <div className="flex gap-2 mt-4">
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => router.push(`/add-match?edit=${encodeURIComponent(match.clientId)}`)}
                        >
                            <Pencil />
                            Редактировать
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
                            <Trash2 />
                            Удалить
                        </Button>
                    </div>
                )}
            </CardContent>

            <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Удалить несинхронизированную партию</DialogTitle>
                        <DialogDescription>
                            Партия «{gameName}» ещё не отправлена на сервер и будет удалена с этого устройства без возможности восстановления.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteOpen(false)}>Отмена</Button>
                        <Button
                            variant="destructive"
                            onClick={() => {
                                deletePendingMatch(match.clientId);
                                setDeleteOpen(false);
                            }}
                        >
                            Удалить
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
