import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
import { PAGES } from "./lib/offline/routes";
import { precacheUrlsForRoute } from "./lib/offline/precache-urls";

// Explicit basePath ("/elo" on GitHub Pages, set in .github/workflows/nextjs.yml).
// The service worker scope, precache URLs and web manifest all derive from it.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// Revision versions precached pages so a new deploy invalidates old HTML.
const revision = process.env.GITHUB_SHA ?? crypto.randomUUID();

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // Our offline sync handles the "online" event itself; a forced reload would
  // interrupt it.
  reloadOnOnline: false,
  // Each route is precached as both the HTML (hard load / extensionless URL)
  // and the RSC payload `.txt` (client-side <Link> navigation fetches it), so
  // pages open offline even if never visited online. For "/" with a basePath
  // the router asks for <basePath>.txt — a URL no static host serves under
  // <basePath>/ and one outside the worker scope — so the app rewrites that
  // request to <basePath>/index.txt client-side (lib/root-rsc-payload.ts) and
  // only the index.txt name is precached here.
  additionalPrecacheEntries: PAGES.flatMap((p) =>
    precacheUrlsForRoute(p, basePath).map((url) => ({ url, revision })),
  ),
});

const nextConfig: NextConfig = {
  output: 'export',
  basePath,
  // Separate build dir lets a second dev instance run alongside another one
  // (e.g. against a scratch backend on another port). Unset → default .next.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

// @serwist/next hooks into webpack, which `next dev` (Turbopack) rejects, so the
// service worker is built only for production (`next build --webpack`).
export default process.env.NODE_ENV === "development" ? nextConfig : withSerwist(nextConfig);
