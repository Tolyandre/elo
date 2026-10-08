# The general feed (arena feeds and the home feed)

Extends ADR-24. The old "Партии" tab of the arena view — the global arena's
match list with corrections merged in client-side and market resolutions
lazily nested under match cards — becomes a general **feed**: one server-side
merged, cursor-paginated stream of the events an arena's rating is built from,
designed to carry non-rating content later (cooperative matches, posts).

**Update (ADR-36 phase 5):** the feed's correction event kind is removed
together with the corrections feature — feeds merge match and market events
only.

**Update (ADR-36 phases 5–7):** the home feed is the **tenant feed**
(`GET /tenants/{id}/feed` — ADR-36), the main page renders the current
community's feed; the arena feeds of per-game/tag/camp/tournament arenas are
unchanged. In this ADR's original wording the home feed was the global
arena's event set — the same arena that later became «Синие люди»'s main
arena, then the tenant feed proper.

## Problem

- The feed was assembled **client-side** from two endpoints
  (`GET /arenas/{id}/matches` + `GET /corrections`) merged in the frontend
  hook. Every new content kind would have meant another endpoint and another
  hand-rolled merge, and ordering across sources drifted (the two cursors
  paginated independently; ties were resolved by frontend convention).
- The "is this the global arena" decision was a frontend heuristic
  (`filter is empty ⇒ global`). Tournament arenas serialize an empty filter
  (they are link-only, ADR-26/24), so the heuristic misfired: the tournament
  arena's feed wrongly merged corrections and showed market resolutions.
- Market resolutions were not events at all — they were lazily fetched cards
  nested under every match with `has_markets`, in every arena, although
  markets settle only into the global arena (ADR-24).
- The markets lobby (`GET /markets`) loaded every market and every outcome
  row on each request with no pagination; the list grows without bound.

## Decision

### One feed endpoint per scope, events assembled server-side

- `GET /arenas/{id}/feed` — an arena's feed: the events its ratings are
  computed from. Matches (arena membership as everywhere, ADR-28) for every
  arena; market-resolution events **only for the tenant main arenas** (the
  global arena at the time of writing; ADR-36: they settle into the owning
  tenant's arena) — decided server-side by the arena's tenant, never by a
  client heuristic.
- `GET /feed` — the **home feed**, the main page's surface. At the time of
  writing it is the global arena's event set; since ADR-36 it is the
  tenant's community feed (`GET /tenants/{id}/feed`), deliberately a
  separate concept: the main arena's own feed stays rating-only forever.
  Future content that affects no rating — cooperative matches (not counted
  in the main arena, absent from its direct link), posts — joins the home
  feed only, as new event kinds.

The response envelope is content-typed and closed under extension:

    FeedPage  {status, data: FeedEvent[], next}
    FeedEvent {type: "match"|"correction"|"market", data: Match|Correction|Market}

New content kinds (cooperative matches, posts) add another event schema to
the union and another branch to the server's event selection; the envelope,
the cursor and the renderers' dispatch never change. Clients skip event types
they do not know instead of failing the whole feed.

Filters (`player_id`, `club_id`, `game_id`) apply to **match and market
events** (corrections stay unfiltered — they are a settled-history view, not
content a filter should hide). For markets, a player matches when he is a
resolution condition (match-winner targets, win-streak target), is referred
to by any outcome (tournament-winner rosters), guaranteed the market, or took
part in its settlement (`'market'`/`'market_guarantor'` ledger rows); a club
matches through any of its members; a game matches as a listed condition game
or via the resolving match's game. They travel inside the cursor token, as
with `/matches`.

### Ordering and cursor

One stream, ordered by `(sort_date DESC, event_type DESC, id DESC)` where
`sort_date` is the match date, the correction date, or the market's feed
position: an **active** market (open / betting-closed) enters the feed at its
`created_at`; a **settled** market (resolved or cancelled — cancellation rides
only on the status column) sits at its `resolved_at`, so a market occupies
exactly one position at any moment and "moves" from its creation position to
its resolution position when it settles. A match-triggered settlement stamps
`resolved_at` with the match date, and the type tiebreak puts a match above
its market resolution at the shared instant — the resolution lands
immediately after the match that resolved it. The same tiebreak orders a
match above corrections. The cursor is the last returned
`(sort_date, event_type, id)` tuple (base64 JSON, filters embedded — the
`matchCursor` convention), which closes the date-only cursor's same-timestamp
straddle: no event is skipped or repeated across page boundaries.

### Markets lobby pagination

`GET /markets` keeps its two buckets but paginates: `active` (open /
betting-closed — small, bounded) is returned in full on every page; `closed`
(resolved / cancelled) pages by the `(resolved_at DESC, id DESC)` keyset with
`closed_next` as the continuation token (`resolved_at` is stamped for both
statuses; cancellation rides only on the status column). Payload rows for both
buckets are fetched by ids in bulk; the per-resolved-market settlement detail
queries are now bounded by the page instead of the whole table.

### Removed endpoints

Superseded surfaces are removed rather than kept (the ADR-24 precedent of
removing `GET /games/{id}/matches`):

- `GET /arenas/{id}/matches` — its last in-app caller (the leaders tab) drains
  the arena feed keeping only match events.
- `GET /corrections` — its last in-app callers were the arena view and the
  matches context's corrections timeline, which nothing read. Corrections are
  created via `POST /admin/players/{id}/corrections` (unchanged) and read
  through the feeds.

Stale PWA clients may hit 404s / unknown tabs until their service worker
updates — accepted in exchange for a clear API surface.

### UI

The tab is renamed `matches` → `feed` («Лента») on every arena page; the main
page's tab URL becomes `/?tab=feed`. In-app links are rewritten; a stale
`?tab=matches` deep link falls back to «Игроки» like any unknown tab value (no
legacy alias). Event rendering dispatches per type: match cards, correction
cards, market cards (linked to the market page); markets are no longer nested
under match rows.

With the feed carrying every market (active ones at their creation moment),
the dedicated markets lobby page (`/markets`) is gone: the main page shows a
compact «Ставки» section between «Сейчас играют» and the feed tabs — every
active market plus the markets resolved within the last day (cancelled
excluded) — and the feed holds the full market story. Creating a market moved
from `/markets/new` into a «Рынок» tab of the adding hub, which itself moved
from `/matches/new` to `/new` («Добавить»). The lobby endpoint `GET /markets`
stays — the main-page section renders from it.

## Consequences

- Feed composition is a server concern again: one query per page of event
  keys (`UNION ALL` of matches / resolved markets, markets gated by the
  owning tenant; corrections were removed in ADR-36 phase 5) plus bulk
  payload fetches per type — bounded, ordered, and extensible by adding a
  branch.
- The matches context slims to a plain match list (its corrections timeline
  and merge logic were dead code).
- Cooperative matches, when built, touch only the home feed's event selection
  and a new event schema — the arena membership semantics (ADR-24/28) and the
  main arena's feed stay untouched.
