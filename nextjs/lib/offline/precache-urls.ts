// The precache URL set for one exported route (PAGES in lib/offline/routes.ts):
// the page's HTML under the name(s) it is served at, the flat RSC payload the
// export writes alongside it (<route>.txt; "index.txt" for the root), and —
// via segmentedPayloadUrlsForRoute — the segmented payload files the Next 16.2
// router actually fetches on navigation.
//
// Shared between serwist.config.mjs (which turns the URLs into precache
// entries) and scripts/check-precache.mjs (which verifies them against the
// build output and the deploy geometry), so the manifest and its check cannot
// drift apart.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function precacheUrlsForRoute(route: string, basePath: string): string[] {
    // "/" needs both "<basePath>" and "<basePath>/" cache keys: a hard
    // navigation can arrive at either form (GitHub Pages redirects the
    // slashless one to the deploy root).
    const htmlUrls = route === "/" ? (basePath ? [basePath, `${basePath}/`] : ["/"]) : [`${basePath}${route}`];
    // The root payload is exported as index.txt; every other route gets
    // "<route>.txt". (With a basePath the router asks for <basePath>.txt — a
    // URL no static host serves under <basePath>/ — so lib/root-rsc-payload.ts
    // rewrites that request to <basePath>/index.txt and only the index.txt
    // name is precached.)
    const rscUrls =
        route === "/" ? (basePath ? [`${basePath}/index.txt`] : ["/index.txt"]) : [`${basePath}${route}.txt`];
    return [...htmlUrls, ...rscUrls];
}

/**
 * The segmented RSC payload files Next 16.2 exports for one route
 * (`__next._tree.txt`, `__next.__PAGE__.txt`, … inside the route's export
 * directory). The router fetches these — with a per-build `_rsc` query token —
 * on every navigation, so offline a route is only as open as these files are
 * precached: the NetworkFirst runtime cache keys on the full URL, and the
 * token changes every build, which would strand every cached payload after
 * the first update. The export writes no such directory for routes that fail
 * to prerender — an empty list there.
 */
export function segmentedPayloadFilesForRoute(route: string, exportRoot: string): string[] {
    const dir = route === "/" ? exportRoot : join(exportRoot, route);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter((name) => name.startsWith("__next.") && name.endsWith(".txt"))
        .sort();
}

/** The precache URLs for one route's segmented payload files. */
export function segmentedPayloadUrlsForRoute(route: string, basePath: string, exportRoot: string): string[] {
    return segmentedPayloadFilesForRoute(route, exportRoot).map((name) =>
        route === "/" ? `${basePath}/${name}` : `${basePath}${route}/${name}`,
    );
}

/** True when the URL lives inside the deploy root at a path-segment boundary. A plain string prefix is not enough ("/elo.txt" starts with "/elo"!). */
export function urlWithinBasePath(url: string, basePath: string): boolean {
    if (basePath === "" || basePath === "/") return true;
    const pathname = new URL(url, "http://deploy.invalid").pathname;
    return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

/**
 * The out/ file a precache URL resolves to on the deploy: the export is served
 * under basePath/ (out/* maps to <basePath>/*), extensionless URLs resolve to
 * "<name>.html" and directory URLs to "index.html" (GitHub Pages rules, shared
 * by every static host this app deploys to).
 */
export function precacheUrlToFile(url: string, basePath: string): string {
    let pathname = new URL(url, "http://deploy.invalid").pathname;
    if (basePath !== "" && basePath !== "/") {
        pathname = pathname.slice(basePath.length) || "/";
    }
    if (pathname.endsWith(".txt")) return pathname.replace(/^\//, "");
    return `${pathname.replace(/^\/+|\/+$/g, "") || "index"}.html`;
}
