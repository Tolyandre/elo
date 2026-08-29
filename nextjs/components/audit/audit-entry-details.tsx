"use client";

import type { components } from "@/app/api-types.gen";
import type { AuditEntry } from "@/app/api";
import { useGames } from "@/app/gamesContext";
import { usePlayers } from "@/app/players/PlayersContext";
import { matchUpdateRows, formatScore } from "@/lib/audit-display";
import { formatDateTime } from "@/lib/datetime";

/**
 * Expanded details of one audit event. Player and game ids resolve to names
 * through the app-wide contexts (participants of saved matches can't be
 * deleted, so the ids always resolve).
 */
export function AuditEntryDetailsView({ entry }: { entry: AuditEntry }) {
    if (entry.details?.kind === "rename") {
        return (
            <p className="text-sm">
                <span className="text-muted-foreground line-through">{entry.details.oldName}</span>
                {" → "}
                <span className="font-medium">{entry.details.newName}</span>
            </p>
        );
    }
    if (entry.details?.kind === "match-update") {
        return <MatchUpdateDetails changes={entry.details.changes} />;
    }
    return null;
}

function MatchUpdateDetails({ changes }: { changes: components["schemas"]["AuditMatchUpdateDetails"] }) {
    const { playerMap, playerDisplayName } = usePlayers();
    const { games } = useGames();

    const gameName = (id: string): string => games.find((g) => g.id === id)?.name ?? "—";
    const rows = matchUpdateRows(changes);
    if (rows.length === 0) return null;

    return (
        <dl className="space-y-1.5 text-sm">
            {rows.map((row, i) => {
                if (row.kind === "date") {
                    return (
                        <div key={i} className="flex flex-wrap gap-x-2">
                            <dt className="text-muted-foreground">Дата:</dt>
                            <dd>{formatDateTime(row.old)} → {formatDateTime(row.new)}</dd>
                        </div>
                    );
                }
                if (row.kind === "game") {
                    return (
                        <div key={i} className="flex flex-wrap gap-x-2">
                            <dt className="text-muted-foreground">Игра:</dt>
                            <dd>{gameName(row.oldGameId)} → {gameName(row.newGameId)}</dd>
                        </div>
                    );
                }
                if (row.kind === "calculator") {
                    return (
                        <div key={i} className="flex flex-wrap gap-x-2">
                            <dt className="text-muted-foreground">Калькулятор:</dt>
                            <dd>изменены данные калькулятора</dd>
                        </div>
                    );
                }
                const player = playerMap.get(row.playerId);
                const name = player ? playerDisplayName(player) : "—";
                return (
                    <div key={i} className="flex flex-wrap gap-x-2">
                        <dt className="text-muted-foreground">{name}:</dt>
                        <dd>
                            {row.change === "added" && (
                                // No +/- prefix on join/leave scores: the sign
                                // reads like a delta; a negative score carries
                                // its own minus.
                                <span>{formatScore(row.newScore)} <span className="text-muted-foreground">(добавлен)</span></span>
                            )}
                            {row.change === "removed" && (
                                <span>{formatScore(row.oldScore)} <span className="text-muted-foreground">(удалён)</span></span>
                            )}
                            {row.change === "score" && (
                                <span>{row.oldScore ?? "—"} → {row.newScore ?? "—"}</span>
                            )}
                        </dd>
                    </div>
                );
            })}
        </dl>
    );
}
