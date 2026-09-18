"use client";

import { useMemo } from "react";
import type { Base58ID } from "@/lib/id";
import type { Bracket } from "@/app/api";
import { getTournamentBracketPromise } from "@/app/api";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useTournaments } from "@/app/tournaments/tournamentsContext";

/**
 * Whether the match being entered (game + exactly this roster) fits a
 * `playing` slot of some running tournament (ADR-26) — drives the match
 * form's tournament checkbox. The fit is computed locally from the running
 * tournaments' brackets; the server always re-verifies at the write.
 */
export function useTournamentSlotFit(playerIds: Base58ID[], gameId?: Base58ID) {
    const { activeTournaments } = useTournaments();
    const running = useMemo(
        () => activeTournaments.filter((t) => t.status === "running"),
        [activeTournaments],
    );
    const runningKey = running.map((t) => t.id).join(",");
    const namesById = useMemo(
        () => new Map(running.map((t) => [t.id as string, t.name])),
        [running],
    );

    const { data, loading } = useAsyncResource(async () => {
        if (running.length === 0) return {};
        const entries = await Promise.all(
            running.map(async (t) => [t.id as string, await getTournamentBracketPromise(t.id)] as const),
        );
        return Object.fromEntries(entries) as Record<string, Bracket>;
    }, [runningKey]);

    return useMemo(() => {
        if (!gameId || playerIds.length === 0) {
            return { fits: false, tournamentNames: [] as string[], loading };
        }
        const roster = new Set<string>(playerIds);
        const names: string[] = [];
        for (const [tid, bracket] of Object.entries(data ?? {})) {
            for (const round of bracket.rounds) {
                for (const slot of round.slots) {
                    if (slot.status !== "playing" || slot.game_id !== gameId) continue;
                    const seatIds = slot.seats.map((s) => s.player_id);
                    // A playing slot's seats are resolved; a stale cache may lag.
                    if (seatIds.some((p) => p == null)) continue;
                    if (setEquals(seatIds.map(String), roster)) {
                        names.push(namesById.get(tid) ?? tid);
                    }
                }
            }
        }
        return { fits: names.length > 0, tournamentNames: names, loading };
    }, [data, gameId, playerIds, loading, namesById]);
}

function setEquals(a: string[], b: Set<string>): boolean {
    if (a.length !== b.size) return false;
    return a.every((x) => b.has(x));
}
