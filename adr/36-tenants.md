# Tenants (communities) and clubs

Extends ADR-05 (clubs as player grouping) and ADR-24 (arena flavors).

## Problem

The app serves one community. Other communities want to use it, but see only
their own activity: their players, their matches, their rating. A club
(ADR-05) is display grouping — a fancy name, an icon, and player-picker
sections — with no isolation of any data.

An earlier iteration of this decision made the club itself the community: a
club of kind `tenant`. That conflated two things. Communities hold matches
between **friends of the clubs** — people who play regularly but are not
formal members of any single club — and a community may run several clubs at
once. Community membership is not club membership, so the tenant is its own
entity.

## Decision

A **tenant** is a separate entity: a name, an optional display **icon** (a key
into the frontend's built-in icon set — the same pool club icons use, shown in
front of the tenant's name; phase 6), openness settings, and exactly one
main arena. A tenant **contains one or many clubs**; a club belongs to at most
one tenant, or to none (exactly today's grouping behavior). Clubs keep their
membership stint history — that history is the raw material from which tenant
membership is derived: a player is a member of the tenant at a given date iff
they had an active stint in **any** of the tenant's clubs at that date.

Roles and per-tenant permissions stay out of scope: the single
`users.allow_editing` permission is shared across all tenants.

The well-known tenant **«Синие люди»**
(`00000000-0000-0000-0000-000000000101`, `BlueMenTenantID` in
`pkg/elo/tenant_ids.go`) is created by the migration and contains the clubs
**«Синие люди»** (`00000000-0000-0000-0000-000000000001`, `BlueMenClubID` in
`pkg/elo/club_ids.go`) and **«Весёлые карточные игры»**
(`00000000-0000-0000-0000-000000000002`) — both seeded by migration 061, the
latter with its real production members.

### Main arena

Every tenant owns exactly one **main arena** — the tenant's global rating
space (`arenas.tenant_id`, unique). It is a new arena flavor: no match
filter, not a camp, no game/tournament anchor; membership is decided by
tenant rules (below), not by `arena_contains_match`.

The **existing global arena becomes «Синие люди»'s main arena** in the
migration — the row and all its settlements stay put. New tenants get a
fresh arena (newbie + amateur + elite leagues, starting rating =
`elo_settings.starting_rating`, name = tenant name), created when the tenant
is created.

`BlueMenTenantID` is a **backfill-only anchor**: it names the original
community for the one-time migration backfill (the global-arena anchor, and
the `tenant_id` of pre-tenancy tournaments and markets) and for scripts. It
is never a runtime default — every tournament/market/arena created after
tenancy gets its tenant explicitly, even when that tenant is «Синие люди».

### Openness settings

Tenant columns, NOT NULL — every tenant carries both:

- `arena_membership_mode` — which matches count into the main arena,
  evaluated **at the match date** against the membership stint history of
  the tenant's clubs:
  - `any_member` («Есть участник сообщества») — at least one participant was
    a member of any club of the tenant; friends playing along accumulate
    rating in the arena and are listed in its ranking;
  - `members_only` («Только участники сообщества») — all participants were
    members of (possibly different) clubs of the tenant. Former members keep
    their settlement history (player page, point-in-time ranks), but the
    arena lists and ranks only current members.
  - «Синие люди» is created with `any_member`: member-less historical
    matches deliberately leave the rating at the next recalculation.
- `tournaments_openness` — `members_only` (registration restricted to
  current members) or `open`; «Синие люди» starts with `open` (today's
  behavior).

The mode is a current setting applied over all history: changing it — or
changing the tenant's club composition, or the arena settings document —
queues the main arena for a full recalculation by the background worker
(phase 6): the save transaction only writes the settings and a full stale
mark, and the worker replays the arena's match rows and then re-chains every
market settlement via the epoch sweep (see below). Settings save and history
replay are decoupled; open views follow the queue via the `arenas-changed`
SSE signal (the arena's `stale_at` is the spinner). Decoupling is also what
makes the replay correct: the worker reads the freshly committed settings
document, where the old in-transaction sweep read the arena row through the
connection pool and re-derived the history against the *previous* settings.

### Membership

`player_club_membership` is stint history (a club-level concept, unchanged by
tenancy): `joined_at` (existing rows backfilled `-infinity` so all their
history counts) and `left_at` (NULL = active stint). PK
`(club_id, player_id, joined_at)`; a partial unique index allows at most one
active stint per (club, player); removing a member closes the stint,
re-joining opens a new one. This is what makes replay/recalc well-defined
for `members_only` arenas and for players who leave and return.

### Attribution and the membership function

Tenant-arena attribution cannot live in `arena_contains_match`: the function
must stay a pure inlinable expression (ADR-28), and membership-at-date needs
table probes. It is a dedicated STABLE function,
`tenant_arena_contains_match` (migration 069), and the arena queries
dispatch per flavor: `CASE WHEN a.tenant_id IS NOT NULL THEN
tenant_arena_contains_match(...) ELSE arena_contains_match(...) END`. This
is the explicit exception to the ADR-28 pure-expression rule — acceptable
because the branch only ever runs for tenant arenas, whose count is
proportional to the number of tenants.

The dispatch covers **every** main arena, including the converted global
one: from the attribution phase on its unconditional filter stays on the row
for mechanical reasons (schema flavor, the games-tab exclusion) but no
longer decides membership — tenant rules do, and member-less matches leave
its rating at the next recalculation (backdated edit, correction, market
replay, or an openness/composition change). A fresh tenant arena is
filter-less, so it is matched by the tenant predicate alone. The
transactional settlement path consults the same rule before settling a match
into the global arena (`TenantContainsPlayers` in matches/players; a
rejected match still records its score rows — it just settles no rating).

### Tournaments and markets

Every tournament and market belongs to a tenant (`tournaments.tenant_id`,
`markets.tenant_id`, NOT NULL since 070; pre-tenancy rows backfilled to
«Синие люди»). Creates are tenant-scoped resources — `POST
/tenants/{id}/tournaments` and `POST /tenants/{id}/markets` (the flat
`POST /tournaments` / `POST /markets` are gone); the path tenant must
exist, and the owner is immutable after create. The auto-created
tournament_winner market inherits the tournament's tenant.

Settlements go to the owning tenant's main arena: `SettleMarket` resolves
`markets.tenant_id` → main arena for the balance reads and the settlement
rows, and every unsettle path deletes per market in the same arena (the
epoch sweep in `RecalculateFrom` re-settles all tenants' markets; the
global-arena bulk delete covers «Синие люди»'s own). Arena replays delete
only `discriminator = 'match'` rows, so a main arena's market rows survive
them — their lifecycle is the market machinery's alone. Bets and guarantees
are restricted to current members iff the owning tenant's main arena is
`members_only` (403). Tournament registration is restricted to current
members iff `tournaments_openness` is `members_only` — on the organizer's
participant list and at self-registration (withdrawal stays open), 403.

`GET /tenants/{id}/feed` is the community's feed, **membership-scoped by
design, not arena-attribution-scoped**: match events go to any current
member's matches — of any club of the tenant (coop included), so friends'
matches appear through the member they play with; correction events to
corrections of current members; market events to the markets the tenant
OWNS (a member's bet on another tenant's market is that tenant's news). A
tournament match therefore appears in the tenant feed even when it does not
count into the main arena rating; a tournament's own arena keeps counting
all tournament matches regardless of openness. Match payloads carry
settlement columns from the tenant's main arena. Clubs carry no feed — the
community, not the club, is the feed's identity.

### Tenant lifecycle

Tenants are created with `POST /tenants` (name, openness settings, initial
club ids; the main arena is ensured in the same transaction). The club
composition is a plain set, replaced wholesale by `PUT /tenants/{id}/clubs`
(clubs must exist and belong to no other tenant). Composition and settings
changes recalculate the main arena in the same transaction (see above).
Tenants are load-bearing — there is no delete. Clubs attached to a tenant
cannot be deleted either (detach first); plain groups delete as before.

### Shared across tenants

Elo formula settings (`elo_settings`), the game catalog, the player catalog
and users stay global; the existing game/player search filters stay as they
are.

### UI contract (later phases)

The main page and the player page carry the current tenant in the URL
(`?tenant=<Base58ID>`). Default resolution: query param → last displayed
tenant (localStorage) → the signed-in user player's tenant (via their clubs) →
a single tenant auto-selected → a prompt. (The stored tenant outranks the
user-player default so an explicit switch survives navigation and reloads —
"preserves the tenant until the user switches it"; a player straddling several
tenants gets the first in list order and can switch.) The header shows the
current tenant's name with a switcher; every navigation preserves the tenant
until the user switches it. The main page renders the tenant's main arena and
the tenant's community feed (the club filter stays `?club=`). A player's page
is tenant-scoped: opened with `?tenant=`, its rating, chart and
Elo-per-game tables come from the tenant's main arena («Частые игры» counts
every stored match, tenant-independent), and a note names the community the
rating is from.

## Migration plan

Staged forward, each phase shippable:

1. **Data model**: 068 creates the `tenants` table, seeds «Синие люди»,
   attaches its clubs, adds stint history and the arena tenant flavor, and
   anchors the global arena; clubs/tenants API grows the new endpoints.
   Zero behavior change otherwise.
2. **Attribution & ranking**: the tenant-arena membership predicate (069),
   the display reads (matches, players, player ranks) parameterized by
   arena, mode/composition change → full recalculation, members-only
   listing.
3. **Tournaments & markets** (this phase): tenant-scoped creates (`POST
   /tenants/{id}/tournaments`, `POST /tenants/{id}/markets`; flat creates
   removed), `tenant_id` NOT NULL (070), per-tenant settlement arenas,
   registration/bet/guarantee members-only gates, `GET /tenants/{id}/feed`.
4. **Frontend shell**: `?tenant=`, switcher, defaults, the tenant-scoped
   player profile (`GET /players/{id}/stats?tenant=`; «Частые игры» becomes
   tenant-independent), the club filter on `GET /tenants/{id}/feed`.
5. **Admin UI**: tenant settings page (openness, member stints across its
   clubs, composition), main-arena settings editor. Plus the global-arena
   retirement: **corrections removed entirely** (feed loses the correction
   event kind; the rating is recalculated by history replay), **bet limits
   counted against the tenant's main arena**, and **`GlobalArenaID`
   dropped as a read default** — every read is tenant-scoped, and the
   frontend prompts for a tenant when none resolves (rare: links carry
   `?tenant=`).
6. **Background recalculation; the global-arena naming retired.** A main
   arena's settings, openness or composition change only marks the arena
   stale (the save returns immediately); the background worker drains main
   arenas by replaying the arena's match rows and then running the epoch
   settlement sweep — re-settling «Синие люди»'s own match settlements (per
   the tenant gate) and every tenant's market rows against the fresh chains
   — so no arena is excluded from the worker anymore. Boot replays every
   stale arena the same way (migrations mark arenas; the old boot-only
   global replay is gone). The `/debug` update replays **all** arenas and
   reports a per-arena diff across the whole recalculation (the old
   global-vs-rest report split is gone; `starting_rating_global_arena`
   became `starting_rating_default`). Tenant settings gains a display icon
   (the club-icon pool) and a structured `tenant-update` audit document in
   the match-edit style; the admin journal tab on `/admin/tenants` shows the
   tenant's own events, and the admin list links each tenant to its main
   page (`/?tenant=`).

## Consequences

- Clubs stay a pure display grouping (ADR-05) plus membership history;
  everything community-shaped — arena, feed, rating space, owned
  tournaments and markets — lives on the tenant.
- Main arenas are system-managed: arena PATCH/DELETE on them returns 409
  (a tenant main arena — «Синие люди»'s included — is managed through the
  tenant; phase 6 removed the separate global-arena guard and naming);
  settings are edited through the tenant (phase 5).
- The membership predicate lives in SQL fragments, not in the inlined
  function — the ADR-28 performance rule now has an explicit exception to
  point at.
- Markets settle into the owning tenant's main arena (their rows survive
  arena match-replays, which delete matches only). A main-arena mode or
  composition change replays the arena's match rows and then re-chains every
  market settlement via the epoch sweep, so the whole ledger is consistent
  with the new history.
- **Corrections were removed entirely (phase 5, migration 071).** They were a
  one-off proof of concept — tracing a new player's path up the rating ladder —
  and are no longer needed; the same insight is recoverable from a rating
  replay, and deleting them left a recalculation by history replay as the only
  settlement source. The migration deletes their settlement rows, drops the
  `corrections` table and marks the global arena stale; boot replays stale
  arenas in full (since phase 6 the background worker drains main arenas too —
  see the phase-6 notes). The admin
  correction endpoint and the feed's correction event kind are gone.
- **Bet limits count against the tenant's main arena (phase 5)**, replacing
  the single global-derived `players.bet_limit` column (dropped in migration
  071): the limit is derived at read time from the player's latest elo in the
  market's tenant main arena (fresh-tenant members fall back to the starting
  Elo until they play there — the per-tenant basis removes that quirk).
- **The `GlobalArenaID` fallback is retired (phase 5).** Reads stop
  defaulting to the global arena when no tenant is given: `?tenant=` is
  required on the match reads, the player stats and the player list, and a
  missing parameter is a 400. When the frontend cannot resolve the current
  tenant (no localStorage history — rare, since every link carries
  `?tenant=`, including a URL copied from the browser), it prompts for a
  tenant instead of silently showing the global arena.
- **Phase 5 shipped the admin UI** under `/admin/tenants`: the list with
  tenant creation, and the settings page — name, the openness pair, club
  composition, and the main-arena settings editor (starting rating and
  leagues, the arena form's editor reused; `PATCH /tenants/{id}` accepts the
  settings document; since phase 6 the recalculation it queues runs in the
  background). Settings sections render as cards, the audit-style journal on
  the page shows the tenant's own events with structured diffs.
  Member stints stay internal logic: the settings page does not show them;
  instead the admin club page renders the stint history as audit-style items
  (`GET /clubs/{id}/members/history`).
- The dev seed keeps its default club as the «Синие люди» tenant's club and
  seeds the tenant itself (with its `blue-figure` icon, phase 6).
