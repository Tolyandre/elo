// Every exported page of the app, precached by the service worker so the app
// opens while offline. With `output: "export"` each page.tsx is exactly one
// HTML file, so a constant list is the simplest correct manifest.
//
// KEEP IN SYNC with app/**/page.tsx: add new routes here when adding pages.
// ("/debug" is deliberately absent: it is an unlinked monitoring tool that
// only makes sense with a live backend.)
export const PAGES = [
    "/",
    "/admin",
    "/admin/clubs",
    "/admin/clubs/edit",
    "/admin/formula",
    "/admin/games",
    "/admin/markets",
    "/admin/players",
    "/admin/users",
    "/arenas",
    "/arenas/edit",
    "/arenas/new",
    "/arenas/view",
    "/calculators",
    "/calculators/chess-clock",
    "/calculators/skull-king",
    "/calculators/st-patrick",
    "/games",
    "/games/view",
    "/help",
    "/markets",
    "/markets/new",
    "/markets/view",
    "/matches/edit",
    "/matches/new",
    "/matches/table",
    // Legacy per-game table pages, now client-side redirect stubs to
    // /matches/table; precached so old offline links still resolve.
    "/matches/table/iaww",
    "/matches/table/skull-king",
    "/matches/view",
    "/oauth2-callback",
    "/players/view",
    "/settings",
    "/tournaments",
    "/tournaments/edit",
    "/tournaments/new",
    "/tournaments/view",
] as const;
