"use client"

import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getPlayersPromise, Player } from "../api";

type PlayersContextType = {
    players: Player[];
    playerMap: Map<string, Player>;

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

    return (
        <PlayersContext.Provider value={{ players, playerMap, loading, error, invalidate }}>
            {children}
        </PlayersContext.Provider>
    );
}

export function usePlayers(): PlayersContextType {
    const context = useContext(PlayersContext);
    if (!context) throw new Error("usePlayers must be used within PlayersProvider");
    return context;
}
