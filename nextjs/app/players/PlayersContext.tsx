"use client"

import React, { createContext, useContext, useEffect, useState, ReactNode, use } from "react";
import { getPlayersPromise } from "../api";

export type Player = {
    id: string;
    elo: number;
};

type PlayersContextType = {
    players: Player[];

    // TODO https://nextjs.org/docs/app/getting-started/updating-data#showing-a-pending-state
    loading: boolean;
    error: string | null;
};

const PlayersContext = createContext<PlayersContextType | undefined>(undefined);

export function PlayersProvider({ children
}: {
    children: ReactNode
}) {
    const [players, setPlayers] = useState<Player[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        getPlayersPromise()
            .then((data) => {
                const sorted = [...data].sort((a, b) => b.elo - a.elo);
                setPlayers(sorted);
                setLoading(false);
                return sorted;
            })
            .catch((err) => {
                setError(err.message);
                setLoading(false);
            });
    }, []);

    return (
        <PlayersContext.Provider value={{ players, loading, error }}>
            {children}
        </PlayersContext.Provider>
    );
}

export function usePlayers(): PlayersContextType {
    const context = useContext(PlayersContext);
    if (!context) throw new Error("usePlayers must be used within PlayersProvider");
    return context;
}