"use client";

import { useEffect } from "react";

/**
 * Registers the service worker and makes a new deployment take effect on reload
 * instead of being "one reload behind". Registration is manual: @serwist/next
 * injects its sw-entry by patching the webpack "main-app"/"main.js" entry keys,
 * which Next 16 no longer provides (the App Router client entry is added at
 * compile time by FlightClientEntryPlugin), so that injection is a silent no-op —
 * without this call nothing ever registers the worker.
 *
 * The service worker precache is cache-first, so right after a deploy the first
 * reload still serves the OLD precached HTML/JS while the new worker installs in
 * the background. Once that new worker activates and claims the page, we reload
 * once so the page shows the new version.
 *
 * The takeover is detected by polling, not by the controllerchange event alone:
 * Firefox does not fire controllerchange when the worker claims existing clients
 * (a long-standing deviation), so a successful in-place takeover would be
 * invisible there and the tab would keep running the old bundle. The 1s tick
 * compares the controller against the one this page was loaded under and reloads
 * when it changed.
 *
 * If a ready update still does not take over (the old worker never idles, or a
 * browser quirk keeps the waiting worker dormant), the tick falls back to
 * reloading the page: a navigation unloads the clients and deterministically
 * promotes the waiting worker. A sessionStorage guard keeps it to one reload
 * per 30s so a pathological registration cannot loop.
 *
 * Also proactively checks for a new worker when the app regains focus — important
 * for an installed PWA that can stay open for a long time without a navigation
 * (which is what otherwise triggers the browser's update check).
 */
export function SwUpdateReloader() {
    useEffect(() => {
        if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

        let reloading = false;
        const reloadOnce = () => {
            if (reloading) return;
            reloading = true;
            window.location.reload();
        };

        // Production-only: `next dev` never builds sw.js, and a stale local
        // public/sw.js must not control the dev server. NODE_ENV is inlined at
        // build time, so the dev bundle drops this branch entirely.
        // updateViaCache "none" keeps every browser (Firefox heeds HTTP caching
        // of the script far more than Chrome) from deciding the update check on
        // a heuristically-fresh cached copy of sw.js.
        if (process.env.NODE_ENV === "production") {
            const swUrl = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/sw.js`;
            navigator.serviceWorker
                .getRegistration(swUrl)
                .then((reg) => reg ?? navigator.serviceWorker.register(swUrl, { updateViaCache: "none" }))
                .catch(() => { /* registration failure degrades to no-SW — ignore */ });
        }

        // Only reload on an UPDATE: a controller present at mount means the page
        // is already controlled; on a first-ever visit the page isn't controlled
        // yet, so the initial activation must not reload.
        const initialController = navigator.serviceWorker.controller;
        const onControllerChange = () => {
            if (initialController) reloadOnce();
        };
        navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

        // Nudge + fallback tick (see the component docblock). The new worker
        // sets its skip waiting flag at evaluation, but the spec's activation
        // gate also demands that the OLD worker have no pending events at that
        // exact moment. Each skipWaiting() call re-runs the activation attempt
        // (spec §4.1.4), so while a waiting worker exists we re-send
        // SKIP_WAITING every second until the old worker is briefly idle.
        // Harmless when nothing is waiting; the worker side is idempotent.
        const RELOAD_AFTER_WAITING_MS = 10_000;
        const RELOAD_GUARD_KEY = "sw-update-reload-at";
        const RELOAD_GUARD_MS = 30_000;
        let waitingSince: number | null = null;

        const tick = () => {
            navigator.serviceWorker.getRegistration()
                .then((reg) => {
                    const controller = navigator.serviceWorker.controller;
                    if (initialController && controller && controller !== initialController) {
                        reloadOnce();
                        return;
                    }
                    if (reg?.waiting && reg.waiting.state === "installed") {
                        reg.waiting.postMessage({ type: "SKIP_WAITING" });
                        const since = waitingSince ?? Date.now();
                        waitingSince = since;
                        if (Date.now() - since >= RELOAD_AFTER_WAITING_MS) {
                            const lastReload = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0);
                            if (Date.now() - lastReload >= RELOAD_GUARD_MS) {
                                sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
                                reloadOnce();
                            }
                        }
                    } else {
                        waitingSince = null;
                    }
                })
                .catch(() => { /* no registration — nothing to do */ });
        };
        const tickTimer = window.setInterval(tick, 1000);

        // Force an update check now (on every page load) and whenever the user
        // returns to the app. The browser's automatic check on navigation can be
        // throttled or unreliable (notably in Firefox and installed PWAs), so we
        // ask explicitly. A detected new worker then activates and triggers the
        // reload above.
        const checkForUpdate = () => {
            navigator.serviceWorker.getRegistration()
                .then((reg) => reg?.update())
                .catch(() => { /* offline or no registration — ignore */ });
        };
        checkForUpdate();
        const onFocus = () => {
            if (document.visibilityState === "visible") checkForUpdate();
        };
        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onFocus);

        return () => {
            window.clearInterval(tickTimer);
            navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
            window.removeEventListener("focus", onFocus);
            document.removeEventListener("visibilitychange", onFocus);
        };
    }, []);

    return null;
}
