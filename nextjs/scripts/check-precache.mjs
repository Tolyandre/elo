// Verifies the precache route list (lib/offline/routes.ts) stays in sync with
// the actual static export in out/. Run after `next build` (see package.json "build").
//
// For every PAGES route, every precache URL (lib/offline/precache-urls.ts) must:
// - live inside the deploy root when a basePath is set: a URL outside
//   <basePath>/ can never be served by a project-pages deploy, and a precache
//   entry that 404s breaks the entire service worker installation (this
//   happened with an "/elo.txt" entry — every client's update wedged forever);
// - map to a file that exists in out/.
//
// Also warns when out/ contains an exported page route not listed in PAGES
// (it would not be precached and so would not open offline).
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PAGES } from "../lib/offline/routes.ts";
import { precacheUrlsForRoute, precacheUrlToFile, urlWithinBasePath } from "../lib/offline/precache-urls.ts";

const OUT = "out";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

if (!existsSync(OUT)) {
    console.error(`check-precache: "${OUT}" not found — run the build first.`);
    process.exit(1);
}

// 1. Every precache URL must be servable on the deploy and backed by a file.
const broken = [];
for (const route of PAGES) {
    for (const url of precacheUrlsForRoute(route, basePath)) {
        if (!urlWithinBasePath(url, basePath)) {
            broken.push(`${url} — outside the deploy root ${basePath}/, can never be served`);
            continue;
        }
        const file = precacheUrlToFile(url, basePath);
        if (!existsSync(join(OUT, file))) {
            broken.push(`${url} — export file out/${file} missing`);
        }
    }
}

// 2. Exported page routes not covered by PAGES (warning only).
//    Collect every <name>.html under out/ (excluding 404/_not-found) as a route.
const known = new Set(PAGES.map((r) => (r === "/" ? "/" : r)));
function* walk(dir, prefix = "") {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            yield* walk(join(dir, entry.name), `${prefix}/${entry.name}`);
        } else if (entry.name.endsWith(".html")) {
            const name = entry.name.slice(0, -".html".length);
            if (name === "404" || name === "_not-found") continue;
            const route = name === "index" ? (prefix || "/") : `${prefix}/${name}`;
            yield route;
        }
    }
}
const uncovered = [...walk(OUT)].filter((route) => !known.has(route));

if (uncovered.length > 0) {
    console.warn(
        "check-precache: exported routes NOT in PAGES (won't be available offline):\n  " +
            uncovered.sort().join("\n  ") +
            "\n  → add them to nextjs/lib/offline/routes.ts",
    );
}

if (broken.length > 0) {
    console.error(
        "check-precache: precache URLs the deploy cannot serve (would break SW install):\n  " +
            broken.sort().join("\n  "),
    );
    process.exit(1);
}

console.log(`check-precache: OK — ${PAGES.length} routes precached (html + txt).`);
