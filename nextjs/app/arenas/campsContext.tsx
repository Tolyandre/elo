"use client"

import { createContext, useContext, useCallback, useMemo, ReactNode } from "react";
import { Arena, getArenasPromise } from "../api";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import type { Base58ID } from "@/lib/id";

/**
 * A camp arena (ADR-27) normalized for the form/match-form needs: the window
 * bounds (ISO strings as delivered) and the derived participants
 * (arena_settlements players), which power the default-check rule and the
 * player-picker camp sections offline.
 */
export type CampArena = {
    id: Base58ID;
    name: string;
    starts_at: string;
    ends_at: string;
    player_ids: Base58ID[];
};

function toCampArena(a: Arena): CampArena | null {
    if (!a.camp || !a.starts_at || !a.ends_at) return null;
    return {
        id: a.id,
        name: a.name,
        starts_at: a.starts_at,
        ends_at: a.ends_at,
        player_ids: a.player_ids ?? [],
    };
}

type CampsContextType = {
    camps: CampArena[];
    /** Camps whose [starts_at, ends_at] window contains `date` (default: now). */
    activeCamps: (date?: Date) => CampArena[];
    invalidate: () => void;
};

const CampsContext = createContext<CampsContextType | undefined>(undefined);

export const CampsProvider = ({ children }: { children: ReactNode }) => {
    const { data, invalidate } = useAsyncResource(() => getArenasPromise({ kind: "camps" }));
    const camps = useMemo(
        () => (data ?? []).map(toCampArena).filter((c): c is CampArena => c !== null),
        [data],
    );

    const activeCamps = useCallback(
        (date: Date = new Date()): CampArena[] => {
            const t = date.getTime();
            return camps.filter(
                (c) => new Date(c.starts_at).getTime() <= t && t <= new Date(c.ends_at).getTime(),
            );
        },
        [camps],
    );

    return (
        <CampsContext.Provider value={{ camps, activeCamps, invalidate }}>
            {children}
        </CampsContext.Provider>
    );
};

export const useCamps = () => {
    const ctx = useContext(CampsContext);
    if (!ctx) throw new Error("useCamps must be used within a CampsProvider");
    return ctx;
};
