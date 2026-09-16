"use client";

import { useMemo, useSyncExternalStore } from "react";

/**
 * Query-string state for the statically exported app (ADR-25).
 *
 * The App Router cannot navigate to the current route with a changed query
 * string on a static export — `router.push`/`router.replace` are silent no-ops
 * (ADR-24 session notes, trap 1) — so view state travels in the URL without
 * involving the router: reads go straight to window.location, writes go
 * through the History API. window.location.pathname already contains the
 * deployment basePath (/elo on GitHub Pages), so URLs built here keep it
 * automatically; never concatenate usePathname() (which strips the basePath)
 * into them.
 */

const URL_QUERY_CHANGE = "elo:url-query-change";

function subscribe(onStoreChange: () => void) {
    window.addEventListener("popstate", onStoreChange);
    window.addEventListener(URL_QUERY_CHANGE, onStoreChange);
    return () => {
        window.removeEventListener("popstate", onStoreChange);
        window.removeEventListener(URL_QUERY_CHANGE, onStoreChange);
    };
}

function getSnapshot(): string {
    return window.location.search;
}

// The prerendered shell has no query; after hydration useSyncExternalStore
// re-checks the client snapshot and re-renders with the real values — no
// hydration mismatch.
function getServerSnapshot(): string {
    return "";
}

/**
 * The current query string as URLSearchParams, live across Back/Forward and
 * programmatic writes. Treat it as read-only; change the URL via setUrlQuery.
 */
export function useUrlQuery(): URLSearchParams {
    const search = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    return useMemo(() => new URLSearchParams(search), [search]);
}

export type UrlHistoryMode = "push" | "replace";

/**
 * Rewrites the query string of the current URL; pathname and hash are
 * preserved as-is (basePath included).
 *
 * "push" creates a history entry so Back/Forward step through the change —
 * use it for discrete user-visible steps (tab switches, the Главная reset).
 * "replace" (default) overwrites the current entry — use it for refinements
 * whose every step must not appear in history (filter inputs).
 */
export function setUrlQuery(
    mutate: (params: URLSearchParams) => void,
    mode: UrlHistoryMode = "replace",
): void {
    const params = new URLSearchParams(window.location.search);
    mutate(params);
    const query = params.toString();
    const url = window.location.pathname + (query ? `?${query}` : "") + window.location.hash;
    if (mode === "push") {
        window.history.pushState(null, "", url);
    } else {
        window.history.replaceState(null, "", url);
    }
    window.dispatchEvent(new Event(URL_QUERY_CHANGE));
}
