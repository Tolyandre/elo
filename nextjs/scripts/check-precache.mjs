// Verifies the precache route list (lib/offline/routes.ts) stays in sync with the
// actual static export in out/. Run after `next build` (see package.json "build").
//
// - Fails if any PAGES route is missing its exported .html or .txt (a precache
//   entry pointing at a missing file would break service worker installation).
// - Warns if out/ contains an exported page route not listed in PAGES (it would
//   not be precached and so would not open offline).
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PAGES } from "../lib/offline/routes.ts";

const OUT = "out";

if (!existsSync(OUT)) {
    console.error(`check-precache: "${OUT}" not found — run the build first.`);
    process.exit(1);
}

// 1. Every PAGES route must have both .html and .txt in the export.
const missing = [];
for (const route of PAGES) {
    const base = route === "/" ? "index" : route.replace(/^\//, "");
    for (const ext of ["html", "txt"]) {
        const file = join(OUT, `${base}.${ext}`);
        if (!existsSync(file)) missing.push(file);
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

if (missing.length > 0) {
    console.error(
        "check-precache: PAGES routes missing from the export (would break SW install):\n  " +
            missing.sort().join("\n  "),
    );
    process.exit(1);
}

console.log(`check-precache: OK — ${PAGES.length} routes precached (html + txt).`);
