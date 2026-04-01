"use client"

import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { getPlayersPromise, Player } from "../api";
import { useMe } from "../meContext";

type PlayersContextType = {
    players: Player[];
    playerMap: Map<string, Player>;
    playerDisplayName: (player: Pick<Player, "name" | "geologist_name">) => string;

    // TODO https://nextjs.org/docs/app/getting-started/updating-data#showing-a-pending-state
    loading: boolean;
    error: string | null;
    invalidate: () => void;
};

const PlayersContext = createContext<PlayersContextType | undefined>(undefined);

export function PlayersProvider({ children
}: {
    children: ReactNode
}) {
    const [players, setPlayers] = useState<Player[]>([]);
    const [playerMap, setPlayerMap] = useState<Map<string, Player>>(new Map());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [stamp, setStamp] = useState<number>(0);

    const { geologistMode } = useMe();

    useEffect(() => {
        setLoading(true);
        getPlayersPromise()
            .then((data) => {
                const sorted = [...data].sort((a, b) => (a.rank.now.rank ?? Number.MAX_VALUE) - (b.rank.now.rank ?? Number.MAX_VALUE));
                setPlayers(sorted);
                const map = new Map(sorted.map(p => [p.id, p]));
                setPlayerMap(map);
                setLoading(false);
                return sorted;
            })
            .catch((err) => {
                setError(err.message);
                setLoading(false);
            });
    }, [stamp]);

    const invalidate = () => {
        setStamp((s) => s + 1);
    };

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
