# SPA routing on a static export

Revises the UI part of ADR-24 (the main page location) and resolves the
routing problems the ADR-24 implementation hit on GitHub Pages.

## Problem

The frontend is a fully client-rendered app deployed as a Next.js static
export to GitHub Pages under a basePath (`/elo`). Three consequences of that
combination shaped every routing decision:

- **Path segments per id are impossible**: `/arenas/<id>` would need one
  exported file per arena, but arenas are user-created. Dynamic ids must
  travel in the query string (`/arenas/view?id=…`, ADR-24).
- **Same-route query-only navigation is a silent no-op**: on the exported
  app, `router.push`/`router.replace` to the current route with a changed
  query do nothing (the export has one static RSC payload per route, no
  per-query variants), while cross-route navigation works. ADR-24 worked
  around this with local state + `history.replaceState` mirroring, and the
  «Главная» nav item fell back to `window.location.assign` — a full page
  reload on every return home.
- **`redirect()` pages export as empty shells**: a statically exported
  redirect is an `__next_error__` HTML body whose RSC payload carries a
  client-side redirect replay. With `/` pointing at `/arenas/view`, every
  visit to `https://tolyandre.github.io/elo/` — including every PWA launch,
  since the manifest `start_url` is `/elo/` — painted a blank page, booted,
  then hopped to the arena.

Desired behavior: a single-page app (no full reloads on navigation), view
state shareable via URL, refresh-stable, restorable with Back/Forward, and
sensible defaults when the URL carries no state.

## Decision

### `/` is the real main page

`app/page.tsx` renders the global arena directly. The arena view moved into a
client component (`app/arenas/view/arena-view.tsx`) rendered by both `/` and
`/arenas/view?id=…`; the id-less global arena and the main page are the same
thing on both routes. No redirects anywhere: exported `redirect()` shells are
gone, the PWA start_url lands on real content, and «Главная» in the
navigation bar is a plain `<Link href="/">` — cross-route, therefore a normal
SPA navigation from every other page.

### Query state through the History API, not the router

`lib/url-state.ts` is the single mechanism for query state:

- `useUrlQuery()` — the live query string via `useSyncExternalStore`
  (subscribed to `popstate` and to writes). Components derive their view
  state from it (arena id, tab, filters); there is no mirrored local state to
  keep in sync. Back/Forward restore the state, because `popstate` re-reads
  the URL.
- `setUrlQuery(mutate, mode)` — writes through `history.pushState`/`replaceState`
  and notifies readers. `"push"` for discrete user-visible steps (tab
  switches, the «Главная» reset): Back/Forward walk through them. `"replace"`
  (default) for refinements whose every step must not stack history entries
  (filter inputs).
- Hand-built URLs take the pathname from `window.location`, which already
  includes the deployment basePath — the usePathname()-strips-basePath trap
  (ADR-24 notes) cannot recur here. Next `<Link>` keeps handling all
  route-to-route navigation (it prepends the basePath itself); plain `<a>`
  hrefs must not be used for app routes.

Same-route query-only changes never go through the Next router.

Defaults live in the derivation, not in the URL: only non-default values are
written (`?tab=players` is omitted), and an absent or invalid value falls back
to the default (e.g. `?tab=leaders` on an arena without that tab → «Игроки»).

### On «/» itself, «Главная» clears state via setUrlQuery

Clicking «Главная» while already on `/` cannot be a router navigation (the
no-op above). The nav item instead clears all query parameters with
`setUrlQuery(..., "push")`; the arena view re-derives its defaults and
refetches. A click on a clean `/` is a no-op.

## Consequences

- No full page reloads anywhere in the nav; Back/Forward step through tabs
  and arena states, re-fetching data only.
- Refresh and shared links restore the exact view (id, tab, filters) — the
  ADR-24 behavior, now extended to Back/Forward.
- `out/index.html` is a real prerendered shell (header + skeleton) instead of
  an empty redirect body; the `/` precache dual-key special case in
  `next.config.ts` is unchanged and still needed.
- Any new view state should be added to the query via `useUrlQuery`/
  `setUrlQuery`, not `useState` + `router`.

## Rejected alternatives

- **Path-based routes via the GitHub Pages `404.html` → SPA fallback trick.**
  Possible, but refresh, precaching and canonical URLs all get more complex;
  query routing is honest about being a static site.
- **Router-driven query-state libraries (e.g. nuqs).** They go through
  `router.replace`/`router.push` — exactly the mechanism the static export
  drops. The history-based hook is the working pattern here and stays
  portable.
- **Framework change (Vite + TanStack Router or React Router SPA mode).**
  Structurally a better fit for a fully client-rendered app: first-class
  typed search params, no static-export router quirks, trivial Pages deploy.
  Rejected for now as a rewrite of ~30 working routes for problems the hook
  already contains; revisit if routing friction recurs. The hook and the
  arena view component are deliberately framework-portable.
