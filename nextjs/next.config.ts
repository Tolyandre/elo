import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
import { PAGES } from "./lib/offline/routes";

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
  additionalPrecacheEntries: PAGES.flatMap((p) => {
    // Each route is precached as both the HTML (hard load / extensionless URL)
    // and the RSC payload `.txt` (client-side <Link> navigation fetches it), so
    // pages open offline even if never visited online.
    // "/" needs both "/elo" and "/elo/" cache keys when basePath is set; its RSC
    // payload is served as index.txt.
    const htmlUrls = p === "/" ? (basePath ? [basePath, `${basePath}/`] : ["/"]) : [`${basePath}${p}`];
    const rscUrl = p === "/" ? `${basePath}/index.txt` : `${basePath}${p}.txt`;
    return [...htmlUrls, rscUrl].map((url) => ({ url, revision }));
  }),
});

const nextConfig: NextConfig = {
  output: 'export',
  basePath,
};

// @serwist/next hooks into webpack, which `next dev` (Turbopack) rejects, so the
// service worker is built only for production (`next build --webpack`).
export default process.env.NODE_ENV === "development" ? nextConfig : withSerwist(nextConfig);
