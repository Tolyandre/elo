"use client";

import { useEffect, useState } from "react";
import { useAsyncResource } from "./useAsyncResource";

export type CachedAsyncResource<T> = {
    /** The fresh data, else the last cached copy, else null. */
    data: T | null;
    /**
     * True only while nothing at all can be shown (fetch in flight, no cached
     * copy). A cached list degrades silently — same stale-while-offline
     * contract as the service-worker API cache.
     */
    loading: boolean;
    /** Set when the fetch failed and no cached copy stands in. */
    error: string | null;
    /** Re-run the fetcher. Stable identity. */
    invalidate: () => void;
};

/**
 * useAsyncResource with a localStorage last-good copy (the me-cache pattern):
 * the cached value applies post-mount, is rewritten on every successful
 * fetch, and stands in whenever the network has nothing — offline or while
 * the request fails. For infrastructure lists whose consumers hang global
 * behavior off them (the tenant scope resolves the current community from the
 * tenants list), a cold service-worker cache must not blank every page.
 *
 * `loading`/`error` fire only while resolving from nothing; stale cached data
 * is preferable to a hard error there, and the server re-validates anything
 * created against it.
 */
export function useCachedAsyncResource<T>(
    fetcher: () => Promise<T>,
    cacheKey: string,
): CachedAsyncResource<T> {
    const { data, loading, error, invalidate } = useAsyncResource(fetcher);
    const [cached, setCached] = useState<T | null>(null);

    // SSR-safe hydration: localStorage is only available after mount (the
    // first commit matches the server, same as meContext).
    useEffect(() => {
        try {
            const raw = localStorage.getItem(cacheKey);
            const parsed: unknown = raw ? JSON.parse(raw) : null;
            /* eslint-disable-next-line react-hooks/set-state-in-effect -- see above */
            setCached((parsed ?? null) as T | null);
        } catch {
            // Corrupt cache entry — ignore it, the network fetch decides.
        }
    }, [cacheKey]);

    // Write-through: every successful fetch refreshes the copy. No setState
    // here — `data ?? cached` already prefers the fresh value, so the cached
    // state only ever holds the mount-time read.
    useEffect(() => {
        if (data == null) return;
        try {
            localStorage.setItem(cacheKey, JSON.stringify(data));
        } catch {
            // Quota exceeded — the fresh data is still shown for the session.
        }
    }, [cacheKey, data]);

    const resolving = data == null && cached == null;
    return {
        data: data ?? cached,
        loading: loading && resolving,
        error: error != null && resolving ? error : null,
        invalidate,
    };
}
