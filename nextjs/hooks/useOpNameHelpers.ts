"use client";

import { useMemo } from "react";
import { useNameResolver } from "@/hooks/useNameResolver";
import { useCamps } from "@/app/arenas/campsContext";
import type { OpNameHelpers } from "@/lib/offline/op-display";

/** The `OpNameHelpers` backed by the app contexts — one place so every
 * surface (/offline queue, match/player/game views, the feed) resolves names
 * for queued-change diffs and op overlays identically. Memoized so callers
 * can use it in effect/memo dependency lists. */
export function useOpNameHelpers(): OpNameHelpers {
    const { resolvePlayer, resolveGame } = useNameResolver();
    const { camps } = useCamps();
    return useMemo(
        () => ({
            gameName: resolveGame,
            playerName: resolvePlayer,
            campName: (id) => camps.find((c) => c.id === id)?.name ?? id,
        }),
        [resolvePlayer, resolveGame, camps],
    );
}
