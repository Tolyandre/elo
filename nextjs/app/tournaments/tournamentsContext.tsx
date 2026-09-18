"use client"

import { createContext, useContext, ReactNode } from "react";
import { Tournament, getTournamentsPromise } from "../api";
import { useAsyncResource } from "@/hooks/useAsyncResource";

/**
 * Bracket tournaments (ADR-26), preloaded app-wide the same way camps are:
 * the list page renders it, the main page's «Сейчас» block links the active
 * ones, and the match form needs the running tournaments to decide whether
 * the tournament checkbox (slot fit) is offered.
 */
type TournamentsContextType = {
    tournaments: Tournament[];
    /** Tournaments open for play: registration or running (the server list already sorts them first). */
    activeTournaments: Tournament[];
    invalidate: () => void;
};

const TournamentsContext = createContext<TournamentsContextType | undefined>(undefined);

export const TournamentsProvider = ({ children }: { children: ReactNode }) => {
    const { data, invalidate } = useAsyncResource(() => getTournamentsPromise());

    const tournaments = data ?? [];
    const activeTournaments = tournaments.filter(
        (t) => t.status === "registration" || t.status === "running",
    );

    return (
        <TournamentsContext.Provider value={{ tournaments, activeTournaments, invalidate }}>
            {children}
        </TournamentsContext.Provider>
    );
};

export const useTournaments = () => {
    const ctx = useContext(TournamentsContext);
    if (!ctx) throw new Error("useTournaments must be used within a TournamentsProvider");
    return ctx;
};
