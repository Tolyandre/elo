// Service-worker build for @serwist/next "config mode"
// (https://serwist.pages.dev/docs/next/config). `next build` no longer builds
// the worker: this file feeds `serwist build` (@serwist/cli + esbuild), which
// runs after the static export and writes the worker straight into out/.
//
// Classic withSerwist() mode is a silent no-op on Next 16 — it patches webpack
// entry keys that no longer exist, so its registration never shipped (see
// components/sw-update-reloader.tsx, which now registers manually).
//
// The CLI loads this file with a plain import() (no bundler), so it stays
// plain ESM; the imported .ts helpers ride Node's native type stripping
// (Node ≥ 22.18 — the pinned CI/Nix toolchain is Node 24).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { serwist } from "@serwist/next/config";
import { PAGES } from "./lib/offline/routes.ts";
import { precacheUrlsForRoute } from "./lib/offline/precache-urls.ts";

export default serwist.withNextConfig((nextConfig) => {
  // Same source as next.config.ts; baked into every precache URL.
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  // Versions precached pages per deploy: a new GITHUB_SHA (set by the Pages
  // workflow and the Nix build) invalidates old HTML.
  const revision = process.env.GITHUB_SHA ?? "dev";

  // The settlement engine (ADR-38): precached with a content-hash revision —
  // the page fetches the 4 MB module on every load anyway, and a deploy
  // re-downloads it only when the engine actually changed. Guarded on the
  // file's presence: a bare local build without `make build-wasm` must still
  // produce an installable worker (a precache entry for a missing URL would
  // fail the install).
  const wasmPrecacheEntries = existsSync("public/wasm/settlement.wasm")
    ? ["settlement.wasm", "wasm_exec.js"].map((file) => ({
        url: `${basePath}/wasm/${file}`,
        revision: createHash("md5").update(readFileSync(`public/wasm/${file}`)).digest("hex"),
      }))
    : [];

  // Normalized the way @serwist/next does it internally (no leading slash,
  // trailing slash) so the glob patterns below match its conventions.
  let distDir = nextConfig.distDir ?? ".next";
  if (distDir.startsWith("/")) distDir = distDir.slice(1);
  if (!distDir.endsWith("/")) distDir += "/";

  return {
    swSrc: "app/sw.ts",
    // Written straight into the export: the static-export copy step runs
    // inside `next build`, and `serwist build` runs after it.
    swDest: "out/sw.js",
    // Our explicit PAGES entries cover route HTML + RSC .txt payloads; the
    // prerendered .next/server/*.html glob would only duplicate them.
    precachePrerendered: false,
    // Only the build chunks: the helper's default patterns also glob
    // public/**, which would precache every bgg/club-icons/trophies image.
    globPatterns: [
      `${distDir}static/**/*.{js,css,html,ico,apng,png,avif,jpg,jpeg,jfif,pjpeg,pjp,gif,svg,webp,webmanifest,json,woff,woff2}`,
    ],
    manifestTransforms: [
      // Map build chunks to their served URLs under basePath. Runs before
      // @serwist/next's own transform, whose "/_next/" rewrite does not
      // account for basePath.
      (manifest) => ({
        manifest: manifest.map((entry) =>
          entry.url.startsWith(`${distDir}static/`)
            ? { ...entry, url: `${basePath}/_next/${entry.url.slice(distDir.length)}` }
            : entry,
        ),
        warnings: [],
      }),
    ],
    additionalPrecacheEntries: [
      ...PAGES.flatMap((p) => precacheUrlsForRoute(p, basePath).map((url) => ({ url, revision }))),
      ...wasmPrecacheEntries,
    ],
    esbuildOptions: {
      // webpack's InjectManifest used to inline these constants into the
      // worker; esbuild needs them spelled out (the browser has no
      // process.env, and serwist's runtime references NODE_ENV).
      define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
        "process.env.NEXT_PUBLIC_BASE_PATH": JSON.stringify(basePath),
        "process.env.NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL": JSON.stringify(
          process.env.NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL ?? "",
        ),
      },
    },
  };
});
