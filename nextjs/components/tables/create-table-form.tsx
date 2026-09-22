"use client";
import type { Base58ID } from "@/lib/id";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createTablePromise } from "@/app/api";
import { useMe } from "@/app/meContext";
import { usePlayers } from "@/app/players/PlayersContext";
import { writeTableSession } from "@/hooks/useTableSession";
import { GAME_APPS, gameAppByGameId, TABLE_PAGE_PATH } from "@/lib/game-apps";
import { PlayerMultiSelect } from "@/components/player-multi-select";
import { PlayerOrderList } from "@/components/tables/player-order-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The «Стол» tab on /matches/new: pick the game and the participants in
 * seating order (order matters — it is the order the game starts with), then
 * create the table and open it. Joining existing tables happens via the
 * «Сейчас играют» lobby or an invite toast; creating requires auth and a
 * linked player, same as hosting a table.
 */
export function CreateTableForm() {
    const me = useMe();
    const { players: allPlayers, playerDisplayName } = usePlayers();
    const router = useRouter();

    const [gameId, setGameId] = useState<Base58ID>(GAME_APPS[0].id);
    const [playerIds, setPlayerIds] = useState<Base58ID[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const app = gameAppByGameId(gameId);
    const canCreate = !!(me.isAuthenticated && me.playerId);

    async function create() {
        const players = playerIds
            .map((id) => allPlayers.find((p) => p.id === id))
            .filter(Boolean)
            .map((p) => ({ id: p!.id, name: playerDisplayName(p!) }));
        if (!app || players.length < app.minPlayers) return;
        if (!(me.isAuthenticated && me.playerId)) return;

        setIsSubmitting(true);
        try {
            const table = await createTablePromise(app.id, app.createInitialState(players));
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

                <PlayerMultiSelect
                    value={playerIds}
                    onChange={setPlayerIds}
                />

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
                    disabled={playerIds.length < (app?.minPlayers ?? 2) || isSubmitting || !canCreate}
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
