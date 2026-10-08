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
  - `all` («Все партии», phase 7) — every rated match, membership
    irrelevant. «Синие люди»'s mode since migration 075 (before that
    `any_member`): the community counts everything it ever recorded — the
    historical behavior of the arena it inherited from the global one. The
    member-less exception disappears from its rating: previously recorded
    matches without members re-enter at the recalculation the migration
    queues. Coop matches stay out in every mode (ADR-33 — they settle no
    rating and are community news only). Under `all` the tenant feed widens
    to match the arena: it shows every match, not just current members'
    (the feed must not be narrower than the rating).
  - `any_member` («Есть участник сообщества») — at least one participant was
    a member of any club of the tenant; friends playing along accumulate
    rating in the arena and are listed in its ranking;
  - `members_only` («Только участники сообщества») — all participants were
    members of (possibly different) clubs of the tenant. Former members keep
    their settlement history (player page, point-in-time ranks), but the
    arena lists and ranks only current members.
  - New tenants are created with `any_member` (the conservative default —
    strangers do not enter the rating until the admin decides otherwise);
    «Все партии» is an explicit choice.
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
replay, or an openness/composition change; since phase 7 a member-less match
cannot even be created — see the settlement section below — so only
historical rows are affected). A fresh tenant arena is
filter-less, so it is matched by the tenant predicate alone. The
transactional settlement path consults the same rule before settling a match
into the tenant's arena (`TenantContainsPlayers` in matches/players; under
`all` it passes for everyone).

### Matches and tables: tenant-scoped creation and settlement (phase 7)

Matches have no `tenant_id` column — the read match set is not
arena-filtered, and arena attribution decides per arena. Creation, though,
names a tenant: **`POST /tenants/{id}/matches`** replaced the flat
`POST /matches` (phase 7 — the same move tournaments and markets made in
phase 3). The path tenant must exist (404) and the **participant rule of its
openness mode** applies (400 `ErrMatchOutsideTenant` / `ErrMatchMembersOnly`):
under `members_only` **every participant must be a current member** of the
tenant — a guest in the roster is rejected, matching the client form's rule;
under `any_member` and `all` at least one current member anchors the match to
the community. Edits apply the same rule (`PUT /matches/{id}?tenant=`), so a
members_only tenant never takes a guest-carrying roster at creation or on
edit. Offline-created matches capture the tenant at submit time
(`PendingMatch.tenantId`) and the sync engine posts under it; legacy pending
items without one fall back to the tenant in force at sync.

Settlement keeps one performance-critical fast path. The **sweep anchor** —
the arena whose settlement chain the transactional sweep
(`RecalculateFrom`, used by edits, backdated creates and market deletes)
re-settles — is the converted global arena («Синие люди»'s main arena). A
match created under the anchor's tenant settles into it transactionally, as
before. A match created under any **other** tenant writes its score rows,
runs the market side (resolution/expiry are arena-independent), and lets the
affected-arena drain replay that tenant's main arena from the match date in
the same transaction — exactly the treatment every other non-anchor arena
gets; the anchor itself, if the match counts into it (e.g. its mode is
`all`), is replay-driven too via the same drain. `BlueMenArenaID` remains
only the named anchor constant, not a runtime route: match settlement
resolves the creating tenant's main arena from the path tenant.

Game tables belong to a tenant too (`game_tables.tenant_id`, NOT NULL since
076; pre-tenancy rows backfilled to «Синие люди»). Creates are tenant-scoped
— **`POST /tenants/{id}/tables`** replaced the flat `POST /tables` — and the
**seating is validated server-side at creation** against the tenant's
openness rule (the same rule the match form applies client-side):
`members_only` seats members only, `any_member` demands at least one current
member, `all` accepts anyone. Later joins and submissions stay
host-token-guarded only — a live game must never break mid-play. The lobby
read is tenant-scoped: `GET /tables?tenant=` (required) lists only that
tenant's live tables; `TableSummary` carries `tenant_id`.

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
Under `members_only` the strictness extends to market creation (phase 7):
the market must be about the tenant's current members — its target players
(the match_winner targets, the win_streak subject, the tournament's
participants) are checked at create and a non-member target is a 400
(`ErrMarketTargetOutsideTenant`), so a members_only tenant's markets are
always about its own.

`GET /tenants/{id}/feed` is the community's feed, **membership-scoped by
design, not arena-attribution-scoped**: under `any_member` match events go to
any current member's matches — of any club of the tenant (coop included), so
friends' matches appear through the member they play with; market events to
the markets the tenant OWNS (a member's bet on another tenant's market is
that tenant's news). Under `members_only` the match branch tightens to the
openness rule itself: every participant must be a current member — the same
strictness the creation and edit guards enforce, so a guest-carrying
(historical) match stays out of the feed as well as the rating; under `all`
it widens to every match — the feed is never narrower than the rating. A
tournament match therefore appears in the tenant feed even
when it does not count into the main arena rating; a tournament's own arena
keeps counting all tournament matches regardless of openness. Match payloads
carry settlement columns from the tenant's main arena — null when the match
did not settle there (the openness rule keeps it out of the rating): clients
show no rating values for such a match, never zeros. Clubs carry no
feed — the community, not the club, is the feed's identity.

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
(`?tenant=<Base58ID>`). Resolution is **explicit only** (revised phase 7):
the query param, then the last displayed tenant (localStorage) — and it
stops there. The silent defaults of the original chain (the signed-in user
player's tenant via their clubs, the single-tenant auto-select) are gone: a
community is what the user picked, never what the site guessed. A fresh
visit resolves to nothing, and every tenant-dependent page renders the
**tenant chooser** in place of its content — a «Выберите сообщество» banner
listing all tenants as one-click options (the pick persists the choice and
carries `?tenant=` into the URL; on deep-linkable pages it survives refresh
and sharing). The original auto-popup dialog is gone with it — it could be
dismissed into a broken-looking page, and the banner cannot. The header
shows the current tenant's name with a switcher (a skeleton while the scope
resolves — never a global-arena fallback); every navigation preserves the
tenant until the user switches it. The main page renders the tenant's main
arena and the tenant's community feed (the club filter stays `?club=`). A
player's page is tenant-scoped: opened with `?tenant=`, its rating, chart
and Elo-per-game tables come from the tenant's main arena («Частые игры»
counts every stored match, tenant-independent), and a note names the
community the rating is from.

**The global-arena concept is retired from the UI (phase 7).** The main
page is the tenant's page, full stop: the nav item that used to say
«Главная» is the current community — its icon and name, with the switcher
beside it, and a quiet skeleton while the tenant scope resolves (never a
global-arena fallback; a resolved-but-tenantless session reads «Выберите
сообщество» and the chooser dialog opens). The arena view's page title falls
back to the tenant's name, not «Главная». What remains deliberately
**not** tenant-scoped: administration (`/admin`), the arena pages
(`/arenas` — per-game, tag-filtered and camp arenas are community-crossing
by design), the help pages, and — confirmed exceptions — the shared tools
and references: calculators, the game catalog, and personal settings
(«Мои настройки»). A market or tournament view opened by id belongs to its
owning tenant implicitly. The «Сейчас играют» lobby and the header table
icons render the current tenant's tables only (the feed-guard pattern:
nothing loads before the tenant scope resolves, and a tenant switch
refetches). A `/help/tenants` page documents communities, clubs and the
openness rules for users.

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
7. **Refinements (this phase).** The third openness mode `all` («Все
   партии») with «Синие люди» flipped to it (075 — the row is marked stale
   so the worker re-interprets the whole history). Match and table creation
   become tenant-scoped (`POST /tenants/{id}/matches`,
   `POST /tenants/{id}/tables`; the flat creates are gone) with the
   mode-dependent participant guard (members_only: all current members,
   otherwise ≥1) shared by creation and edits, and the
   settlement path resolving the creating tenant's main arena from the path
   tenant (the anchor-arena parameterization described above). Game tables
   gain `tenant_id` (076), the tenant-scoped lobby read, and the create-time
   seating rule. The frontend retires the last global-arena UI («Главная» →
   the tenant switcher item with a resolving skeleton), scopes the tables
   lobby and header icons, and gains the `/help/tenants` page.

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
- **Creation flows are tenant-scoped (phase 6).** `/new` renders its forms
  only under a resolved tenant and the scope writes `?tenant=` back into its
  URL (every inbound link carries it), so everything created there names its
  community explicitly instead of silently landing outside the feed. The
  match form validates the roster against the tenant's openness rule at
  creation (any_member: at least one member, else the match would never reach
  the feed; members_only: members only, enforced by restricting the player
  pickers to the member set; all: no restriction), the table form applies the
  same rules to its seating, and the market form takes its tenant from the
  URL — a members_only
  tenant's markets may target members only (the server already restricts
  their bets). (Phase 7 adds the server-side twins: the create endpoints
  enforce the rules these forms preview.) The main page's market cards render only the current tenant's
  markets, consistent with the feed. Arena responses carry `tenant_id` (the
  API mapping had omitted it), so the arena view's edit pencil correctly
  stays off the system-managed main arena. Match edits are tenant-scoped
  too: `PUT /matches/{id}` takes a required `?tenant=` and rejects (400) an
  edit that breaks the tenant's participant rule (originally: none of the
  participants is a current member; phase 7 made it mode-dependent — see the
  settlement section) — the feed predicate — while the tenant membership
  re-evaluation on replay stays the settling side's job; the edit page
  carries `?tenant=` in its URL and does not work tenantless.
- The dev seed keeps its default club as the «Синие люди» tenant's club and
  seeds the tenant itself (with its `blue-figure` icon, phase 6; with its
  `all` openness, phase 7).
- **Phase 7 makes creation and settlement tenant-generic.** A match can no
  longer exist outside a community: creation and edit apply the tenant's
  participant rule (members_only: all current members; any_member and all:
  at least one), and the settlement path settles into the creating tenant's
  main arena — transactionally when that arena is the sweep anchor, through
  the replay otherwise. The safety valve "recorded but settles nothing" now
  covers only history: under `members_only` nothing but all-member matches
  can be created, and a member-plus-guest match exists only as a recording
  made under another community — it settles nothing there and stays out of
  the members_only tenant's feed and rating. The member-less matches that
  the `any_member` era left unrated re-enter «Синие люди»'s rating when
  migration 075 flips the mode — that rewrite is the point of «Все партии»,
  and the audit trail records the settings change.
- **Phase 7 scopes the tables world.** The «Сейчас играют» lobby, the
  header table icons and the table create form all work against the current
  tenant; a table created under one community is invisible to another. The
  server rejects, at creation only, a seating that does not relate to the
  tenant (400) — the flow mirrors the match form's client rule, and live
  games stay unguarded after creation by design.
- **Phase 7 makes the player catalog tenant-optional.** The phase-5 rule
  "`?tenant=` required on the player list" narrows: the list without a
  tenant returns the global catalog without ranking columns (`rank` omitted)
  — the name lookups (tournament brackets, arena feeds, match cards) must
  resolve on entity pages opened by a direct link, and the frontend fetches
  the catalog immediately, refetching with ranks once a tenant is chosen.
  The ranking reads themselves stay tenant-scoped as before.
