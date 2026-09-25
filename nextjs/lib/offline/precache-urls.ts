// The precache URL set for one exported route (PAGES in lib/offline/routes.ts):
// the page's HTML under the name(s) it is served at, plus the RSC payload the
// client router fetches on <Link> navigation (fetch-server-response appends
// ".txt" to hrefs not ending in "/", "index.txt" to slash-terminated ones).
//
// Shared between next.config.ts (which turns the URLs into precache entries)
// and scripts/check-precache.mjs (which verifies them against the build output
// and the deploy geometry), so the manifest and its check cannot drift apart.

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
