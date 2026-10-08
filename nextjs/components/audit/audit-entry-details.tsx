"use client";

import type { components } from "@/app/api-types.gen";
import type { AuditEntry } from "@/app/api";
import { useGames } from "@/app/gamesContext";
import { usePlayers } from "@/app/players/PlayersContext";
import { useClubs } from "@/app/clubsContext";
import { MEMBERSHIP_MODE_LABELS, TOURNAMENTS_OPENNESS_LABELS } from "@/app/admin/tenants/labels";
import { matchUpdateRows, tenantUpdateRows, formatScore } from "@/lib/audit-display";
import { TenantIcon } from "@/components/tenant-icon";
import { clubIconSrc, isValidClubIcon } from "@/lib/club-icons";
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
    if (entry.details?.kind === "tenant-update") {
        return <TenantUpdateDetails changes={entry.details.changes} />;
    }
    if (entry.details?.kind === "user-update") {
        return <UserUpdateDetails changes={entry.details.changes} />;
    }
    if (entry.details?.kind === "club-update") {
        return <ClubUpdateDetails changes={entry.details.changes} />;
    }
    return null;
}

function ClubUpdateDetails({ changes }: { changes: components["schemas"]["AuditClubUpdateDetails"] }) {
    const { playerMap, playerDisplayName } = usePlayers();

    return (
        <dl className="space-y-1.5 text-sm">
            {changes.icon && (
                <div className="flex flex-wrap gap-x-2 items-center">
                    <dt className="text-muted-foreground">Иконка:</dt>
                    <dd className="inline-flex items-center gap-1.5">
                        <ClubIconByKey icon={changes.icon.from} />
                        {changes.icon.from ? "иконка" : "нет"}
                        {" → "}
                        <ClubIconByKey icon={changes.icon.to} />
                        {changes.icon.to ? "иконка" : "нет"}
                    </dd>
                </div>
            )}
            {changes.players && (
                <div className="flex flex-wrap gap-x-2">
                    <dt className="text-muted-foreground">Состав:</dt>
                    <dd>
                        {[
                            ...changes.players.added_player_ids.map((id) => `+${playerName(id)}`),
                            ...changes.players.removed_player_ids.map((id) => `−${playerName(id)}`),
                        ].join(", ")}
                    </dd>
                </div>
            )}
        </dl>
    );

    function playerName(id: string): string {
        const player = playerMap.get(id);
        return player ? playerDisplayName(player) : "—";
    }
}

// The audit row stores an icon key, not a club object — render the built-in
// SVG straight from the key (nothing when there was no icon).
function ClubIconByKey({ icon }: { icon: string | null }) {
    if (!icon || !isValidClubIcon(icon)) return <span className="text-muted-foreground">нет</span>;
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={clubIconSrc(icon)} alt="" aria-hidden className="inline-block h-4 w-4 shrink-0 align-text-bottom" />
    );
}

function UserUpdateDetails({ changes }: { changes: components["schemas"]["AuditUserUpdateDetails"] }) {
    return (
        <dl className="space-y-1.5 text-sm">
            <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted-foreground">Право на редактирование:</dt>
                <dd>
                    {changes.allow_editing.from ? "включено" : "выключено"}
                    {" → "}
                    {changes.allow_editing.to ? "включено" : "выключено"}
                </dd>
            </div>
        </dl>
    );
}

function TenantUpdateDetails({ changes }: { changes: components["schemas"]["AuditTenantUpdateDetails"] }) {
    const { clubs, clubDisplayName } = useClubs();

    const clubName = (id: string): string => {
        const club = clubs.find((c) => c.id === id);
        return club ? clubDisplayName(club) : "—";
    };
    const rows = tenantUpdateRows(changes);
    if (rows.length === 0) return null;

    return (
        <dl className="space-y-1.5 text-sm">
            {rows.map((row, i) => {
                if (row.kind === "membership-mode") {
                    return (
                        <div key={i} className="flex flex-wrap gap-x-2">
                            <dt className="text-muted-foreground">Какие партии идут в общий рейтинг:</dt>
                            <dd>{MEMBERSHIP_MODE_LABELS[row.old as keyof typeof MEMBERSHIP_MODE_LABELS]} → {MEMBERSHIP_MODE_LABELS[row.new as keyof typeof MEMBERSHIP_MODE_LABELS]}</dd>
                        </div>
                    );
                }
                if (row.kind === "tournaments-openness") {
                    return (
                        <div key={i} className="flex flex-wrap gap-x-2">
                            <dt className="text-muted-foreground">Регистрация в турнирах:</dt>
                            <dd>{TOURNAMENTS_OPENNESS_LABELS[row.old as keyof typeof TOURNAMENTS_OPENNESS_LABELS]} → {TOURNAMENTS_OPENNESS_LABELS[row.new as keyof typeof TOURNAMENTS_OPENNESS_LABELS]}</dd>
                        </div>
                    );
                }
                if (row.kind === "starting-rating") {
                    return (
                        <div key={i} className="flex flex-wrap gap-x-2">
                            <dt className="text-muted-foreground">Стартовый рейтинг:</dt>
                            <dd>{formatScore(row.old)} → {formatScore(row.new)}</dd>
                        </div>
                    );
                }
                if (row.kind === "leagues") {
                    return (
                        <div key={i} className="flex flex-wrap gap-x-2">
                            <dt className="text-muted-foreground">Лиги:</dt>
                            <dd>изменены параметры лиг</dd>
                        </div>
                    );
                }
                if (row.kind === "icon") {
                    return (
                        <div key={i} className="flex flex-wrap gap-x-2 items-center">
                            <dt className="text-muted-foreground">Иконка:</dt>
                            <dd className="inline-flex items-center gap-1.5">
                                <TenantIcon icon={row.old} className="h-4 w-4" />
                                {row.old ? "иконка" : "нет"}
                                {" → "}
                                <TenantIcon icon={row.new} className="h-4 w-4" />
                                {row.new ? "иконка" : "нет"}
                            </dd>
                        </div>
                    );
                }
                const parts: string[] = [
                    ...row.added.map((id) => `+${clubName(id)}`),
                    ...row.removed.map((id) => `−${clubName(id)}`),
                ];
                return (
                    <div key={i} className="flex flex-wrap gap-x-2">
                        <dt className="text-muted-foreground">Клубы:</dt>
                        <dd>{parts.join(", ")}</dd>
                    </div>
                );
            })}
        </dl>
    );
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
