"use client"

import React, { createContext, useContext, useEffect, useState, ReactNode, use } from "react";
import { getPlayersPromise } from "./api";

export type Player = {
    id: string;
    elo: number;
};

type PlayersContextType = {
    //playersPromise: Promise<Player[]>;
    players: Player[];

    // TODO https://nextjs.org/docs/app/getting-started/updating-data#showing-a-pending-state
    loading: boolean;
    error: string | null;
    pingError: boolean;
};

const PlayersContext = createContext<PlayersContextType | undefined>(undefined);

export function PlayersProvider({ children
}: {
    children: ReactNode
}) {
    const [players, setPlayers] = useState<Player[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [pingError, setPingError] = useState(false);

    const pingPromise = fetch("https://toly.is-cool.dev/elo-web-service/ping");

    let playersPromise: Promise<any> | null = null;

    useEffect(() => {
        playersPromise = getPlayersPromise();

        playersPromise
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

        pingPromise
            .catch(() => {
                setPingError(true);
            });
    }, []);

    return (
        <PlayersContext.Provider value={{ players, loading, error, pingError }}>
            {children}
        </PlayersContext.Provider>
    );
}

export function usePlayers(): PlayersContextType {
    const context = useContext(PlayersContext);
    if (!context) throw new Error("usePlayers must be used within PlayersProvider");
    return context;
}