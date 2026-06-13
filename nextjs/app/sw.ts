import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist } from "serwist";
import { defaultCache } from "@serwist/next/worker";

declare global {
    interface WorkerGlobalScope extends SerwistGlobalConfig {
        __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
    }
}

declare const self: ServiceWorkerGlobalScope;

// Inlined at build time, same as in app/api.ts.
const apiBase = (process.env.NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL ?? "").replace(/\/+$/, "");

const serwist = new Serwist({
    precacheEntries: self.__SW_MANIFEST,
    skipWaiting: true,
    clientsClaim: true,
    navigationPreload: false,
    disableDevLogs: true,
    precacheOptions: {
        cleanupOutdatedCaches: true,
        // Pages are exported once per route; query params (/game?id=5) select
        // content client-side, so the precached HTML matches any query.
        ignoreURLParametersMatching: [/.*/],
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
            // (must reflect real API state), auth and SSE.
            matcher: ({ url, request }) =>
                apiBase !== "" &&
                request.method === "GET" &&
                url.href.startsWith(`${apiBase}/`) &&
                !url.pathname.endsWith("/ping") &&
                !url.pathname.includes("/auth/") &&
                !url.pathname.endsWith("/events"),
            handler: new NetworkFirst({
                cacheName: "elo-api",
                networkTimeoutSeconds: 4,
                plugins: [
                    new ExpirationPlugin({
                        maxEntries: 200,
                        maxAgeSeconds: 7 * 24 * 60 * 60,
                    }),
                ],
            }),
        },
        {
            // Every other API request — /ping, /auth/*, SSE, and all writes
            // (POST/PUT/DELETE) — always hits the network and is never cached.
            // This keeps the health check honest and lets failed writes fail fast
            // (so they get queued offline) instead of being swallowed by the
            // cross-origin NetworkFirst rule in defaultCache.
            matcher: ({ url }) => apiBase !== "" && url.href.startsWith(`${apiBase}/`),
            handler: new NetworkOnly(),
        },
        ...defaultCache,
    ],
});

serwist.addEventListeners();
