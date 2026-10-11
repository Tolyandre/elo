import { IMAGE_POOLS } from "@/lib/image-pools.gen";
import type { Tournament } from "@/app/api";

/**
 * The tournament trophy pool (ADR-26 §UI) — one of the app's image pools:
 * static art in `public/trophies/*`, shown next to the winner of a completed
 * tournament and as the tournament's mark in lists. A trophy's identity is
 * its file name without extension; adding one means dropping the file into
 * the folder and redeploying (the pickers' help hint says the same).
 *
 * The organizer picks from the pool while the tournament is in registration;
 * the assignment is exclusive — a trophy some tournament holds is hidden from
 * every other tournament's picker.
 */
export type TrophyInfo = { key: string; src: string };

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Every trophy in the pool, key = file name without extension. */
export const TROPHY_POOL: readonly TrophyInfo[] = IMAGE_POOLS.trophies.map((fileName) => ({
    key: fileName.replace(/\.[a-z0-9]+$/i, ""),
    src: `${basePath}/trophies/${fileName}`,
}));

export function trophyById(key: string): TrophyInfo | undefined {
    return TROPHY_POOL.find((t) => t.key === key);
}

/** Trophy keys held by a tournament (optionally ignoring one — the holder itself). */
export function takenTrophyKeys(tournaments: Tournament[], exceptTournamentId?: string): Set<string> {
    const taken = new Set<string>();
    for (const t of tournaments) {
        if (t.trophy == null || t.id === exceptTournamentId) continue;
        taken.add(t.trophy);
    }
    return taken;
}

/** The assignable pool: every trophy no other tournament holds, key-sorted. */
export function availableTrophies(tournaments: Tournament[], exceptTournamentId?: string): TrophyInfo[] {
    const taken = takenTrophyKeys(tournaments, exceptTournamentId);
    return TROPHY_POOL.filter((t) => !taken.has(t.key)).sort((a, b) => a.key.localeCompare(b.key));
}
