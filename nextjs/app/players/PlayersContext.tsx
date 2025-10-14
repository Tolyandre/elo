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
    invalidate: () => void;
};

const PlayersContext = createContext<PlayersContextType | undefined>(undefined);

export function PlayersProvider({ children
}: {
    children: ReactNode
}) {
    const [players, setPlayers] = useState<Player[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [stamp, setStamp] = useState<number>(0);

    useEffect(() => {
        setLoading(true);
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
    }, [stamp]);

    const invalidate = () => {
        setStamp((s) => s + 1);
    };

    return (
        <PlayersContext.Provider value={{ players, loading, error, invalidate }}>
            {children}
        </PlayersContext.Provider>
    );
}

export function usePlayers(): PlayersContextType {
    const context = useContext(PlayersContext);
    if (!context) throw new Error("usePlayers must be used within PlayersProvider");
    return context;
}
