import type { NextConfig } from "next";

// Explicit basePath ("/elo" on GitHub Pages, set in .github/workflows/nextjs.yml).
// The service worker scope, precache URLs and web manifest all derive from it.
//
// The service worker is NOT built here anymore: @serwist/next classic mode
// (withSerwist) patches webpack entry keys that no longer exist on Next 16, so
// it silently builds nothing but a worker file and never ships registration.
// The worker is built by `serwist build` from serwist.config.mjs (config mode)
// and registered manually in components/sw-update-reloader.tsx.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: 'export',
  basePath,
  // Separate build dir lets a second dev instance run alongside another one
  // (e.g. against a scratch backend on another port). Unset → default .next.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
