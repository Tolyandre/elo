// With a basePath (e.g. /elo on GitHub Pages) the client router fetches the
// root route's RSC payload at <basePath>.txt: <Link href="/"> resolves to the
// URL /elo, and next's fetch-server-response appends ".txt" to any href not
// ending in "/" ("index.txt" to slash-terminated ones). That URL can never
// work on a basePath deploy, though: the static export is served *under*
// <basePath>/ (on GitHub Pages out/* maps to /elo/*), so <basePath>.txt lies
// outside the deploy root, and it is outside the service worker scope
// (<basePath>/) anyway — precaching it only breaks installation, and nothing
// could ever serve it offline. The exported payload actually lives at
// <basePath>/index.txt.
//
// So the page rewrites exactly that one request to <basePath>/index.txt
// before it leaves the window: online the static host serves the exported
// payload, offline the service worker serves its precached copy — either way
// a navigation to «Главная» completes as a real SPA navigation instead of
// dying on an error page (offline) or degrading into a full page load
// (online).
//
// The rewrite must exist before the first router navigation.
// components/root-rsc-payload-rewrite.tsx (mounted by app/layout.tsx)
// installs it at client-bundle evaluation, before hydration and hence before
// any navigation. If a Next.js upgrade changes the payload naming, the
// exact-pathname match simply stops matching and behavior falls back to what
// it was before the rewrite existed (a full-page navigation), never to broken
// fetches.

/** The request URL with the root payload path rewritten, or null when the URL is not the router's root payload request. */
export function rewriteRootRscPayloadUrl(url: URL, basePath: string): URL | null {
    if (basePath === "" || basePath === "/") return null;
    if (url.pathname !== `${basePath}.txt`) return null;
    const rewritten = new URL(url.toString());
    rewritten.pathname = `${basePath}/index.txt`;
    return rewritten;
}

let installed = false;

/**
 * Wraps window.fetch so the router's root payload request is transparently
 * fetched from <basePath>/index.txt instead of <basePath>.txt. Every other
 * request passes through untouched. Idempotent; no-op outside a browser or
 * without a basePath.
 */
export function installRootRscPayloadRewrite(): void {
    if (installed) return;
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    if (basePath === "" || basePath === "/") return;
    if (typeof window === "undefined" || typeof window.fetch !== "function") return;
    installed = true;

    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        try {
            const raw = input instanceof Request ? input.url : String(input);
            const url = new URL(raw, window.location.href);
            if (url.origin === window.location.origin) {
                const rewritten = rewriteRootRscPayloadUrl(url, basePath);
                if (rewritten) {
                    return originalFetch(
                        input instanceof Request ? new Request(rewritten, input) : rewritten.toString(),
                        init,
                    );
                }
            }
        } catch {
            // Malformed input — hand it to fetch untouched and let it complain.
        }
        return originalFetch(input, init);
    };
}
