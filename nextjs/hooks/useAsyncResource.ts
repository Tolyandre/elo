"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AsyncResource<T> = {
    /** The fetched data, or null while loading / after an error. */
    data: T | null;
    loading: boolean;
    error: string | null;
    /** Re-run the fetcher (bumps an internal stamp). Stable identity. */
    invalidate: () => void;
};

/**
 * Fetches async data with loading/error tracking, cancellation on unmount, and
 * an `invalidate()` trigger. Replaces the hand-rolled
 * `useState(null) + stamp + useEffect(() => fetch().then(set).catch(setErr))`
 * pattern that was duplicated across the collection contexts and detail pages.
 *
 * The fetcher is held in a ref, so passing an inline arrow does NOT cause a
 * refetch — only changes to `deps` (or `invalidate()`) do.
 */
export function useAsyncResource<T>(
    fetcher: () => Promise<T>,
    deps: unknown[] = [],
): AsyncResource<T> {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [stamp, setStamp] = useState(0);

    const fetcherRef = useRef(fetcher);
    const isFirstRef = useRef(true);
    useEffect(() => {
        fetcherRef.current = fetcher;
    });

    useEffect(() => {
        let cancelled = false;
        /* eslint-disable react-hooks/set-state-in-effect -- loading/error are reset before the async fetch; this is the single centralized site for this pattern */
        // On the first load we show the loading state; on refetches we keep the
        // stale data visible to avoid a flash.
        if (isFirstRef.current) {
            setLoading(true);
        }
        setError(null);
        /* eslint-enable react-hooks/set-state-in-effect */

        fetcherRef
            .current()
            .then((result) => {
                if (cancelled) return;
                setData(result);
                isFirstRef.current = false;
            })
            .catch((e: unknown) => {
                if (cancelled) return;
                setError(e instanceof Error ? e.message : String(e));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is the caller's responsibility
    }, [...deps, stamp]);

    const invalidate = useCallback(() => {
        setStamp((s) => s + 1);
    }, []);

    return { data, loading, error, invalidate };
}
