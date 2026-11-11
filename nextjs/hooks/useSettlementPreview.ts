"use client";

import { useEffect, useMemo, useState } from "react";
import { getPlayerStatsPromise } from "@/app/api";
import { useSettings } from "@/app/settingsContext";
import { useTenantScope } from "@/app/tenantScopeContext";
import {
    priorHistoryPoint,
    previewSettlement,
    type PreviewHistoryPoint,
    type SettlementPreview,
} from "@/lib/offline/elo-preview";
import { toBase58ID, type Base58ID } from "@/lib/id";

type RatingHistory = { date: string; rating: number; elo: number }[];

// Session cache of pulled rating histories: repeat mounts (feed re-renders,
// view↔feed navigation) reuse the pulled series instead of refetching per
// participant. Only successes are cached — a failed pull retries on the next
// mount, and until then the preview degrades to the starting values (the
// server's own rule for players without history).
const historyCache = new Map<string, RatingHistory>();
const inFlight = new Map<string, Promise<RatingHistory | null>>();

function pullHistory(id: string, tenant: Base58ID): Promise<RatingHistory | null> {
    const cached = historyCache.get(id);
    if (cached) return Promise.resolve(cached);
    const running = inFlight.get(id);
    if (running) return running;
    const parsed = toBase58ID(id);
    if (!parsed) return Promise.resolve(null);
    const promise = getPlayerStatsPromise(parsed, { tenant })
        .then((stats) => {
            historyCache.set(id, stats.rating_history);
            return stats.rating_history;
        })
        .catch(() => null)
        .finally(() => inFlight.delete(id));
    inFlight.set(id, promise);
    return promise;
}

/**
 * The client-side settlement preview for a match's effective state (ADR-37).
 * Pulls each participant's rating history (the tenant-scoped stats read; the
 * service worker caches the GET, so it works offline once seen), picks each
 * player's prior point strictly before the match date and runs the mirrored
 * server math (`lib/offline/elo-preview`).
 *
 * Null while anything is unresolved, for coop matches (they never settle —
 * pass a null score map) and until the settings load — the card then simply
 * hides the columns instead of showing half a picture. After the sync lands,
 * the server's settlement replaces the preview everywhere.
 */
export function useSettlementPreview(
    scores: Record<string, number> | null,
    matchDate: Date | null,
): SettlementPreview | null {
    const { tenantId } = useTenantScope();
    const settings = useSettings();
    // A stable key for the participant set: the score map identity changes on
    // every overlay recomputation, the sorted id list does not.
    const idsKey = scores ? Object.keys(scores).sort().join(",") : "";
    const [histories, setHistories] = useState<Map<string, RatingHistory | null>>(new Map());

    useEffect(() => {
        if (!tenantId || !idsKey) return;
        const ids = idsKey.split(",");
        let cancelled = false;
        void Promise.all(ids.map(async (id) => [id, await pullHistory(id, tenantId)] as const)).then((entries) => {
            if (!cancelled) setHistories(new Map(entries));
        });
        return () => {
            cancelled = true;
        };
    }, [idsKey, tenantId]);

    return useMemo(() => {
        if (!scores || !matchDate || !tenantId || !idsKey) return null;
        // Settings not loaded yet (K/D sit at 0 until the read lands) — no
        // preview rather than a wrong all-zero one.
        if (settings.eloConstK === 0 && settings.eloConstD === 0) return null;
        const ids = idsKey.split(",");
        if (!ids.every((id) => histories.has(id))) return null;
        const history = new Map<string, PreviewHistoryPoint | null>();
        for (const id of ids) {
            const series = histories.get(id);
            history.set(id, series ? priorHistoryPoint(series, matchDate) : null);
        }
        return previewSettlement({
            scores,
            matchDate,
            history,
            settings: {
                k: settings.eloConstK,
                d: settings.eloConstD,
                startingElo: settings.startingElo,
                winReward: settings.winReward,
                startingRatingDefault: settings.startingRatingDefault,
            },
        });
    }, [scores, matchDate, tenantId, idsKey, histories, settings]);
}
