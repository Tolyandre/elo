// With a basePath (e.g. /elo on GitHub Pages) the client router fetches the
// root route's RSC payload at <basePath>.txt: <Link href="/"> resolves to the
// URL /elo, and next's fetch-server-response appends ".txt" to any pathname
// not ending in "/". The static export only emits the payload as index.txt,
// so the fetch 404s: offline it kills the SPA navigation to «Главная» (the
// router falls back to a full-page navigation to /elo, which is outside the
// service worker scope /elo/ and dies on a network error page), online a cold
// load degrades the same click into a full reload. Emitting the file under
// the name the router asks for fixes both. Run after `next build` (see
// package.json "build"); next.config.ts precaches the same URL.
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
if (basePath === "" || basePath === "/") {
    console.log("fix-root-rsc-payload: no basePath, nothing to do.");
    process.exit(0);
}

const OUT = join("out", "index.txt");
const DEST = join("out", `${basePath}.txt`);
if (!existsSync(OUT)) {
    console.error("fix-root-rsc-payload: out/index.txt not found — run the build first.");
    process.exit(1);
}
copyFileSync(OUT, DEST);
console.log(`fix-root-rsc-payload: emitted ${DEST}`);
