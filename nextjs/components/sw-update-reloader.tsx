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
 * the background. Once that new worker activates and claims the page (skipWaiting
 * + clientsClaim), we reload once so the page shows the new version.
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
        if (process.env.NODE_ENV === "production") {
            const swUrl = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/sw.js`;
            navigator.serviceWorker
                .getRegistration(swUrl)
                .then((reg) => reg ?? navigator.serviceWorker.register(swUrl))
                .catch(() => { /* registration failure degrades to no-SW — ignore */ });
        }

        // Only reload on an UPDATE: if the page is already controlled by a worker,
        // a controllerchange means a new worker took over. On a first-ever visit
        // the page isn't controlled yet, so we skip that initial activation.
        const hadController = !!navigator.serviceWorker.controller;
        const onControllerChange = () => {
            if (hadController) reloadOnce();
        };
        navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

        // Nudge a waiting worker into taking over. The new worker sets its skip
        // waiting flag at evaluation, but the spec's activation gate also demands
        // that the OLD worker have no pending events at that exact moment — the
        // page-load burst (precache serves, wasm, API reads) usually fails it, and
        // the browser then retries lazily, leaving the update "installed" until a
        // much later navigation. Each skipWaiting() call re-runs the activation
        // attempt (spec §4.1.4), so while a waiting worker exists we re-send
        // SKIP_WAITING every second until the old worker is briefly idle and the
        // takeover lands (controllerchange reloads the page above). Harmless when
        // nothing is waiting; the worker side is idempotent.
        const nudgeWaitingWorker = () => {
            navigator.serviceWorker.getRegistration()
                .then((reg) => {
                    if (reg?.waiting && reg.waiting.state === "installed") {
                        reg.waiting.postMessage({ type: "SKIP_WAITING" });
                    }
                })
                .catch(() => { /* no registration — nothing to nudge */ });
        };
        const nudgeTimer = window.setInterval(nudgeWaitingWorker, 1000);

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
            window.clearInterval(nudgeTimer);
            navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
            window.removeEventListener("focus", onFocus);
            document.removeEventListener("visibilitychange", onFocus);
        };
    }, []);

    return null;
}
