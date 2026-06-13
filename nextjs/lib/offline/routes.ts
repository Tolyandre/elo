// Every exported page of the app, precached by the service worker so the app
// opens while offline. With `output: "export"` each page.tsx is exactly one
// HTML file, so a constant list is the simplest correct manifest.
//
// KEEP IN SYNC with app/**/page.tsx: add new routes here when adding pages.
export const PAGES = [
    "/",
    "/admin",
    "/admin/club",
    "/admin/clubs",
    "/admin/formula",
    "/admin/games",
    "/admin/markets",
    "/admin/players",
    "/admin/users",
    "/calculators",
    "/calculators/chess-clock",
    "/calculators/elo-reset",
    "/calculators/skull-king",
    "/calculators/skull-king-game",
    "/calculators/st-patrick",
    "/game",
    "/games",
    "/help",
    "/its-a-wonderful-world",
    "/market",
    "/markets",
    "/markets/new",
    "/matches",
    "/matches/edit",
    "/matches/new",
    "/matches/view",
    "/oauth2-callback",
    "/player",
    "/players",
    "/settings",
    "/skull-king-game",
] as const;
