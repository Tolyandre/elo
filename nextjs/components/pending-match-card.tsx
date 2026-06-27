"use client";

import React, { useMemo } from "react";
import { useRouter } from "next/navigation";
import { usePlayers } from "@/app/players/PlayersContext";
import { useGames } from "@/app/gamesContext";
import { useOffline } from "@/app/offline/OfflineContext";
import { PendingMatch } from "@/lib/offline/types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RankIcon } from "@/components/rank-icon";
import { ClubIcons } from "@/components/player-name";
import { CloudOff } from "lucide-react";

// Card for a match created offline and not yet synced: no Elo data, with a
// status badge. When `clickable`, it opens the match detail page where edit and
// delete actions live (delete is the escape hatch when the server rejects the
// item after reconnecting).
export function PendingMatchCard({ match, clickable = false }: { match: PendingMatch; clickable?: boolean }) {
    const { playerMap, playerDisplayName } = usePlayers();
    const { games } = useGames();
    const { pendingPlayers, pendingGames } = useOffline();
    const router = useRouter();

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
        <Card
            className={clickable ? "border-dashed cursor-pointer hover:bg-accent/50 transition-colors" : "border-dashed"}
            onClick={clickable ? () => router.push(`/matches/view?id=${encodeURIComponent(match.clientId)}`) : undefined}
        >
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
                            не сохранено
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
            </CardContent>
        </Card>
    );
}
