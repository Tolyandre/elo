import type { PrecacheEntry, SerwistGlobalConfig, SerwistPlugin } from "serwist";
import { CacheableResponsePlugin, ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist } from "serwist";
import { defaultCache } from "@serwist/next/worker";
import type { SwToPageMessage } from "../lib/sw-messages";

declare global {
    interface WorkerGlobalScope extends SerwistGlobalConfig {
        __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
    }
}

declare const self: ServiceWorkerGlobalScope;

// Inlined at build time, same as in app/api.ts.
const apiBase = (process.env.NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL ?? "").replace(/\/+$/, "");

// Post a typed message to every open tab. includeUncontrolled is essential for
// progress reporting: during install the posting worker controls no clients yet.
const notifyClients = (message: SwToPageMessage) => {
    void self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        for (const client of clients) client.postMessage(message);
    });
};

// Precache install progress (see progressPlugin): handlerDidComplete fires once
// per manifest entry, whether it was downloaded or already cache-valid. The
// plugin also attaches to the serving route, so entries are only counted while
// an install is in flight — a fresh worker receives no fetch events until it
// activates, by which point the counter has reached the total.
// The manifest literal is read exactly once: the build replaces that single
// occurrence and rejects multiple `self.__SW_MANIFEST` references.
const precacheManifest = self.__SW_MANIFEST;
const precacheTotal = precacheManifest?.length ?? 0;
let precacheDone = 0;
let installing = false;

self.addEventListener("install", () => {
    installing = true;
    precacheDone = 0;
    notifyClients({ type: "sw-precache-progress", done: 0, total: precacheTotal });
});

const progressPlugin: SerwistPlugin = {
    handlerDidComplete: async () => {
        if (!installing) return;
        precacheDone += 1;
        notifyClients({
            type: "sw-precache-progress",
            done: Math.min(precacheDone, precacheTotal),
            total: precacheTotal,
        });
        if (precacheTotal > 0 && precacheDone >= precacheTotal) installing = false;
    },
};

// Tells the page whether its data came over the wire or from the cache —
// something the page itself cannot observe. The page drives the cloud-off
// indicator from these messages, covering the window the /ping probe misses
// (API slow or flaky between probes, reads silently falling back to the cache
// after the 4s NetworkFirst timeout).
const apiVisibilityPlugin: SerwistPlugin = {
    // Fires exactly on the two fallback paths of NetworkFirst (network timeout
    // with a cached copy, network failure with a cached copy).
    cachedResponseWillBeUsed: async ({ request, cachedResponse }) => {
        if (cachedResponse) notifyClients({ type: "api-served-from-cache", url: request.url });
        return cachedResponse;
    },
    // Fires for every successful network read — including the late completion of
    // a request whose cached copy was already served after the timeout.
    fetchDidSucceed: async ({ request, response }) => {
        notifyClients({ type: "api-network-ok", url: request.url });
        return response;
    },
};

const serwist = new Serwist({
    precacheEntries: precacheManifest,
    skipWaiting: true,
    clientsClaim: true,
    navigationPreload: false,
    disableDevLogs: true,
    precacheOptions: {
        cleanupOutdatedCaches: true,
        // Pages are exported once per route; query params (/games/view?id=5) select
        // content client-side, so the precached HTML matches any query.
        ignoreURLParametersMatching: [/.*/],
        plugins: [progressPlugin],
    },
    runtimeCaching: [
        {
            // Never cache the service worker script or the web manifest — they must
            // reflect the latest deploy so updates are detected. (The browser's own
            // SW update check bypasses the worker anyway; this guards other fetches.)
            matcher: ({ url, sameOrigin }) =>
                sameOrigin && (url.pathname.endsWith("/sw.js") || url.pathname.endsWith("/manifest.webmanifest")),
            handler: new NetworkOnly(),
        },
        {
            // Cacheable API reads: try the network, fall back to the last seen
            // response so player/game/match lists render offline. Excludes /ping
            // (must reflect real API state), auth, SSE, and the live game-table
            // endpoints (their state mutates constantly during a game and a
            // stale snapshot from the NetworkFirst fallback is worse than no
            // data — they fall through to the NetworkOnly rule below). Matches
            // on the path fragment, not the absolute URL: pathname never
            // includes the origin, and apiBase may carry a path prefix
            // (…/elo-web-service) in front of /tables.
            matcher: ({ url, request }) =>
                apiBase !== "" &&
                request.method === "GET" &&
                url.href.startsWith(`${apiBase}/`) &&
                !url.pathname.endsWith("/ping") &&
                !url.pathname.includes("/auth/") &&
                !url.pathname.endsWith("/events") &&
                !url.pathname.includes("/tables"),
            handler: new NetworkFirst({
                // v2: entries from v1 were stored before the 200-only rule and
                // may hold 404 error snapshots; renaming orphans them for
                // every existing client.
                cacheName: "elo-api-v2",
                networkTimeoutSeconds: 4,
                plugins: [
                    // Only 2xx responses enter the cache: an error snapshot
                    // (404 arena-not-found from before a database migration,
                    // a 5xx blip) must never be served as the offline/
                    // timeout fallback later.
                    new CacheableResponsePlugin({ statuses: [200] }),
                    new ExpirationPlugin({
                        maxEntries: 200,
                        maxAgeSeconds: 7 * 24 * 60 * 60,
                    }),
                    apiVisibilityPlugin,
                ],
            }),
        },
        {
            // Every other API request — /ping, /auth/*, SSE, all writes, and
            // the live-table reads — always hits the network and is never
            // cached. This keeps the health check honest, lets failed writes
            // fail fast (so they get queued offline) instead of being
            // swallowed by the cross-origin NetworkFirst rule in defaultCache,
            // and guarantees a table refetch can never resurrect a stale
            // snapshot while offline.
            matcher: ({ url }) => apiBase !== "" && url.href.startsWith(`${apiBase}/`),
            handler: new NetworkOnly(),
        },
        ...defaultCache,
    ],
});

serwist.addEventListeners();
