import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Player = {
    id: string;
    elo: number;
};

type PlayersContextType = {
    players: Player[];
    loading: boolean;
    error: string | null;
    pingError: boolean;
};

const PlayersContext = createContext<PlayersContextType | undefined>(undefined);

export function PlayersProvider({ children }: { children: ReactNode }) {
    const [players, setPlayers] = useState<Player[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [pingError, setPingError] = useState(false);

    useEffect(() => {
        fetch("https://toly.is-cool.dev/elo-web-service/players")
            .then((res) => {
                if (!res.ok) throw new Error("Failed to fetch players");
                return res.json();
            })
            .then((data) => {
                const sorted = [...data].sort((a, b) => b.elo - a.elo);
                setPlayers(sorted);
                setLoading(false);
            })
            .catch((err) => {
                setError(err.message);
                setLoading(false);
            });

        fetch("https://toly.is-cool.dev/elo-web-service/ping")
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

export function usePlayers() {
    const context = useContext(PlayersContext);
    if (!context) throw new Error("usePlayers must be used within PlayersProvider");
    return context;
}