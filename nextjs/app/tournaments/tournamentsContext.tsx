"use client"

import { createContext, useContext, ReactNode, useMemo } from "react";
import { Tournament, getTournamentsPromise } from "../api";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useTenantScope } from "@/app/tenantScopeContext";

/**
 * Bracket tournaments (ADR-26), preloaded app-wide the same way camps are:
 * the list page renders it, the main page's «Сейчас» block links the active
 * ones, and the match form needs the running tournaments to decide whether
 * the tournament checkbox (slot fit) is offered. Everything the viewer sees
 * is scoped to the current tenant (ADR-36): a tournament belongs to exactly
 * one tenant, and the list filters to it once the scope resolves.
 */
type TournamentsContextType = {
    tournaments: Tournament[];
    /** Tournaments open for play: registration or running (the server list already sorts them first). */
    activeTournaments: Tournament[];
    invalidate: () => void;
};

const TournamentsContext = createContext<TournamentsContextType | undefined>(undefined);

export const TournamentsProvider = ({ children }: { children: ReactNode }) => {
    const { tenantId } = useTenantScope();
    const { data, invalidate } = useAsyncResource(() => getTournamentsPromise());

    const tournaments = useMemo(
        // Before the tenant scope resolves (fresh visit) nothing shows — the
        // same empty state as while the list itself is loading.
        () => (data ?? []).filter((t) => tenantId == null || t.tenant_id === tenantId),
        [data, tenantId],
    );
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
