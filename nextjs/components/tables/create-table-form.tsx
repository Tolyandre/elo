"use client";
import type { Base58ID } from "@/lib/id";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createTablePromise } from "@/app/api";
import { useMe } from "@/app/meContext";
import { usePlayers } from "@/app/players/PlayersContext";
import { useTenantScope, useTenantMemberIds } from "@/app/tenantScopeContext";
import { participantsMembershipIssue } from "@/lib/tenant-members";
import { writeTableSession } from "@/hooks/useTableSession";
import { GAME_APPS, gameAppByGameId, TABLE_PAGE_PATH } from "@/lib/game-apps";
import { PlayerMultiSelect } from "@/components/player-multi-select";
import { PlayerOrderList } from "@/components/tables/player-order-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The «Стол» tab on /new: pick the game and the participants in
 * seating order (order matters — it is the order the game starts with), then
 * create the table and open it. Joining existing tables happens via the
 * «Сейчас играют» lobby or an invite toast; creating requires auth and a
 * linked player, same as hosting a table.
 */
export function CreateTableForm() {
    const me = useMe();
    const { players: allPlayers, playerDisplayName } = usePlayers();
    const router = useRouter();
    // The table's eventual match lands in the community under which the table
    // is created (ADR-36): the same openness rules as the match form — the
    // roster must satisfy the tenant or the match would never reach its feed.
    const { tenant, tenantId } = useTenantScope();
    const memberIds = useTenantMemberIds();

    const [gameId, setGameId] = useState<Base58ID>(GAME_APPS[0].id);
    const [playerIds, setPlayerIds] = useState<Base58ID[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const app = gameAppByGameId(gameId);
    const canCreate = !!(me.isAuthenticated && me.playerId) && !!tenantId;
    const membershipIssue = tenant
        ? participantsMembershipIssue(playerIds, memberIds, tenant.arena_membership_mode, tenant.name)
        : null;

    async function create() {
        if (!tenantId) return;
        const players = playerIds
            .map((id) => allPlayers.find((p) => p.id === id))
            .filter(Boolean)
            .map((p) => ({ id: p!.id, name: playerDisplayName(p!) }));
        if (!app || players.length < app.minPlayers) return;
        if (!(me.isAuthenticated && me.playerId)) return;
        if (membershipIssue) return;

        setIsSubmitting(true);
        try {
            // The table belongs to the community it is created under (ADR-36
            // phase 7): the server re-checks the seating against the tenant's
            // openness mode.
            const table = await createTablePromise(tenantId, app.id, app.createInitialState(players));
            // The table page resumes the host session from localStorage; the
            // ?id= binding it lands on keeps the URL shareable (ADR-25:
            // cross-route navigation goes through the router, same-route
            // query writes would be dropped).
            writeTableSession({ tableId: table.id, isHost: true, myPlayerIndex: null });
            router.push(`${TABLE_PAGE_PATH}?id=${table.id}`);
        } catch (err) {
            toast.error("Не удалось создать стол: " + (err instanceof Error ? err.message : String(err)));
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Новый стол</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">Игра:</p>
                    {GAME_APPS.map((game) => {
                        const Icon = game.icon;
                        const selected = game.id === gameId;
                        return (
                            <button
                                key={game.id}
                                type="button"
                                onClick={() => setGameId(game.id)}
                                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${
                                    selected ? "border-primary bg-accent" : "hover:bg-accent/50"
                                }`}
                            >
                                <Icon className="h-5 w-5 shrink-0" />
                                <span className="text-sm font-medium">{game.title}</span>
                            </button>
                        );
                    })}
                </div>

                {tenant && (
                    <p className="text-xs text-muted-foreground">
                        {tenant.arena_membership_mode === "members_only"
                            ? `Сообщество «${tenant.name}» принимает только партии своих участников.`
                            : tenant.arena_membership_mode === "all"
                                ? `Сообщество «${tenant.name}» считает все партии: стол попадёт в его ленту в любом составе.`
                                : `Партия стола попадёт в ленту сообщества «${tenant.name}», если среди участников есть хотя бы один его участник.`}
                    </p>
                )}
                <PlayerMultiSelect
                    value={playerIds}
                    onChange={setPlayerIds}
                    allowedPlayerIds={tenant?.arena_membership_mode === "members_only" ? [...memberIds] : undefined}
                />

                {membershipIssue && (
                    <p className="text-xs text-destructive">{membershipIssue}</p>
                )}

                {playerIds.length > 0 && (
                    <PlayerOrderList
                        playerIds={playerIds}
                        onChange={setPlayerIds}
                        resolveName={(id) => {
                            const player = allPlayers.find((p) => p.id === id);
                            return player ? playerDisplayName(player) : id;
                        }}
                    />
                )}

                <Button
                    className="w-full md:h-12 md:text-base lg:h-14 lg:text-lg"
                    disabled={playerIds.length < (app?.minPlayers ?? 2) || isSubmitting || !canCreate || membershipIssue !== null}
                    onClick={create}
                    title={!canCreate
                        ? "Для создания стола нужна авторизация и привязка к игроку"
                        : undefined}
                >
                    {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Создать стол"}
                </Button>
            </CardContent>
        </Card>
    );
}
