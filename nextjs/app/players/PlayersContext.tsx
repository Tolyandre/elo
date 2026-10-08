"use client"

import React, { createContext, useContext, useCallback, useMemo, ReactNode } from "react";
import { getPlayersPromise, Player } from "../api";
import { useMe } from "../meContext";
import { useTenantScope } from "../tenantScopeContext";
import { useAsyncResource } from "@/hooks/useAsyncResource";

type PlayersContextType = {
    players: Player[];
    playerMap: Map<string, Player>;
    playerDisplayName: (player: Pick<Player, "name" | "geologist_name">) => string;
    loading: boolean;
    error: string | null;
    invalidate: () => void;
};

const PlayersContext = createContext<PlayersContextType | undefined>(undefined);

export function PlayersProvider({ children
}: {
    children: ReactNode
}) {
    // The catalog is global but the ranking columns are tenant-scoped
    // (ADR-36 phase 5): hold the load until the tenant scope resolves, then
    // fetch against its main arena. Refetching on a tenant switch is
    // deliberate — the ranks are part of the payload.
    const { tenantId } = useTenantScope();
    const { data, loading, error, invalidate } = useAsyncResource(async () => {
        if (!tenantId) return null;
        const data = await getPlayersPromise(tenantId);
        return [...data].sort((a, b) => (a.rank.now.rank ?? Number.MAX_VALUE) - (b.rank.now.rank ?? Number.MAX_VALUE));
    }, [tenantId]);

    const players = useMemo(() => data ?? [], [data]);

    const { geologistMode } = useMe();

    const playerMap = useMemo(
        () => new Map(players.map(p => [p.id, p])),
        [players],
    );

    const playerDisplayName = useCallback(
        (player: Pick<Player, "name" | "geologist_name">): string => {
            return (geologistMode && player.geologist_name) || player.name;
        },
        [geologistMode]
    );

    return (
        <PlayersContext.Provider value={{ players, playerMap, playerDisplayName, loading, error, invalidate }}>
            {children}
        </PlayersContext.Provider>
    );
}

export function usePlayers(): PlayersContextType {
    const context = useContext(PlayersContext);
    if (!context) throw new Error("usePlayers must be used within PlayersProvider");
    return context;
}
