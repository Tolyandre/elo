"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Base58ID } from "@/lib/id";
import { usePlayers } from "@/app/players/PlayersContext";
import { useGames } from "@/app/gamesContext";
import { useOffline } from "@/app/offline/OfflineContext";
import { subscribeEntities } from "@/lib/offline/db";

/**
 * The one name-resolution path for player/game ids (ADR-37). Layers, in
 * order: the pending queue (shows «(офлайн)» — the id has no server entity
 * yet), the live server lists (the fetch the contexts hold), the Dexie
 * entity replica (the last-known server mirror), and finally the unknown
 * fallback. The replica is what closes the old coherence gap: a just-synced
 * id resolves from the mirror immediately, while the live list is still
 * catching up, and a cold offline start resolves from the last session.
 *
 * The id parameter is a plain string because callers carry ids in untyped
 * containers (match score map keys, URL params); lookups into the
 * Base58ID-keyed context maps cast it back.
 */
export function useNameResolver() {
    const { playerMap, playerDisplayName } = usePlayers();
    const { games = [] } = useGames();
    // Defaults keep partial test mocks (and any future context that drops a
    // field) from crashing the resolver.
    const { pendingPlayers = [], pendingGames = [] } = useOffline();

    const [replica, setReplica] = useState({
        players: new Map<string, string>(),
        games: new Map<string, string>(),
    });
    useEffect(() => subscribeEntities((players, games) => setReplica({ players, games })), []);

    const pendingPlayerNames = useMemo(
        () => new Map(pendingPlayers.map((p) => [p.clientId as string, p.name])),
        [pendingPlayers],
    );
    const pendingGameNames = useMemo(
        () => new Map(pendingGames.map((g) => [g.clientId as string, g.name])),
        [pendingGames],
    );
    const ctxGameNames = useMemo(
        () => new Map(games.map((g) => [g.id as string, g.name])),
        [games],
    );

    const resolvePlayer = useCallback(
        (id: string): string => {
            const pending = pendingPlayerNames.get(id);
            if (pending !== undefined) return `${pending} (офлайн)`;
            const ctx = playerMap.get(id as Base58ID);
            if (ctx) return playerDisplayName(ctx);
            return replica.players.get(id) ?? "Unknown";
        },
        [pendingPlayerNames, playerMap, playerDisplayName, replica.players],
    );

    const resolveGame = useCallback(
        (id: string): string => {
            const pending = pendingGameNames.get(id);
            if (pending !== undefined) return `${pending} (офлайн)`;
            return ctxGameNames.get(id) ?? replica.games.get(id) ?? "Неизвестная игра";
        },
        [pendingGameNames, ctxGameNames, replica.games],
    );

    return { resolvePlayer, resolveGame };
}
