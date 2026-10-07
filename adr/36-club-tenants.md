# Club tenants

Extends ADR-05 (clubs as player grouping) and ADR-24 (arena flavors).

## Problem

The app serves one community. Other communities want to use it, but see only
their own activity: their players, their matches, their rating. Today a club
(ADR-05) is pure display grouping — a fancy name, an icon, and player-picker
sections — with no isolation of any data.

## Decision

A club becomes either a **group** (exactly today's behavior) or a **tenant**.
Conversion group → tenant is one-way and adds the tenant entities: a main
arena, openness settings, and membership history. Roles and per-tenant
permissions stay out of scope: the single `users.allow_editing` permission is
shared across all tenants.

### Main arena

Every tenant club owns exactly one **main arena** — the club's global rating
space (`arenas.club_id`, unique). It is a new arena flavor: no match filter,
not a camp, no game/tournament anchor; membership is decided by club rules
(below), not by `arena_contains_match`.

The well-known tenant club **«Синие люди»** (`00000000-0000-0000-0000-000000000001`,
seeded by 061, `BlueMenTenantClubID` in `pkg/elo/club_ids.go`) converts in the
migration, and the **existing global arena becomes its main arena** — the row
and all its settlements stay put. New tenants get a fresh arena (newbie +
amateur + elite leagues, starting rating = `elo_settings.starting_rating`,
name = club name), created at conversion.

`BlueMenTenantClubID` is a **backfill-only anchor**: it names the original
community for the one-time migration backfill (global-arena anchor, and the
`club_id` of pre-tenancy tournaments and markets) and for scripts. It is never
a runtime default — every tournament/market/arena created after tenancy gets
its club explicitly, even when that club is «Синие люди».

### Openness settings

Tenant-only columns on `clubs`, CHECK-constrained to NULL for groups:

- `arena_membership_mode` — which matches count into the main arena,
  evaluated **at the match date** against membership history:
  - `any_member` («Есть участник клуба») — at least one participant was a
    member; guests accumulate rating in the arena and are listed in its
    ranking;
  - `members_only` («Только участники клуба») — all participants were members.
    Former members keep their settlement history (player page, point-in-time
    ranks), but the arena lists and ranks only current members.
  - «Синие люди» converts with `any_member`: member-less historical matches
    deliberately leave the rating at the next recalculation.
- `tournaments_openness` — `members_only` (registration restricted to current
  members) or `open`; «Синие люди» converts with `open` (today's behavior).

The mode is a current setting applied over all history: changing it
recalculates the main arena from scratch in the settings transaction — a
fresh arena via a full stale mark for the background updater, the converted
global arena via the full in-transaction replay (the worker never drains the
global arena: a match-only replay would lose its market and correction
settlements).

### Membership history

`player_club_membership` becomes stint history: `joined_at` (existing rows
backfilled `-infinity` so all their history counts) and `left_at` (NULL =
active stint). PK `(club_id, player_id, joined_at)`; a partial unique index
allows at most one active stint per (club, player); removing a member closes
the stint, re-joining opens a new one. This is what makes replay/recalc
well-defined for `members_only` arenas and for players who leave and return.

### Attribution and the membership function

Club-arena attribution cannot live in `arena_contains_match`: the function
must stay a pure inlinable expression (ADR-28), and membership-at-date needs
table probes. It is a dedicated STABLE function,
`club_arena_contains_match` (migration 069), and the arena queries dispatch
per flavor: `CASE WHEN a.club_id IS NOT NULL THEN club_arena_contains_match(...)
ELSE arena_contains_match(...) END`. This is the explicit exception to the
ADR-28 pure-expression rule — acceptable because the branch only ever runs
for club arenas, whose count is proportional to the number of tenants.

The dispatch covers **every** main arena, including the converted global one:
from the attribution phase on its unconditional filter stays on the row for
mechanical reasons (schema flavor, the games-tab exclusion) but no longer
decides membership — club rules do, and member-less matches leave its rating
at the next recalculation (backdated edit, correction, market replay, or an
openness change). A fresh club arena is filter-less, so it is matched by the
club predicate alone. The transactional settlement path consults the same
rule before settling a match into the global arena
(`ClubContainsPlayers` in matches/players; a rejected match still records
its score rows — it just settles no rating).

### Tournaments and markets

Every tournament and market belongs to a club (`tournaments.club_id`,
`markets.club_id`, NOT NULL since 070; pre-tenancy rows backfilled to
«Синие люди»). Creates are club-scoped resources — `POST
/clubs/{id}/tournaments` and `POST /clubs/{id}/markets` (the flat
`POST /tournaments` / `POST /markets` are gone); the path club must be an
existing tenant, and the club is immutable after create. The auto-created
tournament_winner market inherits the tournament's club.

Settlements go to the owning club's main arena: `SettleMarket` resolves
`markets.club_id` → main arena for the balance reads and the settlement rows,
and every unsettle path deletes per market in the same arena (the epoch sweep
in `RecalculateFrom` re-settles all clubs' markets; the global-arena bulk
delete covers «Синие люди»'s own). Arena replays delete only
`discriminator = 'match'` rows, so a main arena's market rows survive them —
their lifecycle is the market machinery's alone. Bets and guarantees are
restricted to current members iff the owning club's main arena is
`members_only` (403). Tournament registration is restricted to current
members iff `tournaments_openness` is `members_only` — on the organizer's
participant list and at self-registration (withdrawal stays open), 403.

`GET /clubs/{id}/feed` is the community's feed, **membership-scoped by
design, not arena-attribution-scoped**: match events go to any current
member's matches (coop included), correction events to corrections of current
members, market events to the markets the club OWNS (a member's bet on
another club's market is that club's news). A tournament match therefore
appears in the club feed even when it does not count into the main arena
rating; a tournament's own arena keeps counting all tournament matches
regardless of openness. Match payloads carry settlement columns from the
club's main arena; a group club has no feed (404 — no arena to read from).

### Shared across tenants

Elo formula settings (`elo_settings`), the game catalog, the player catalog
and users stay global; the existing game/player search filters stay as they
are.

### UI contract (later phases)

The main page and the player page carry the current tenant in the URL
(`?club=<Base58ID>`); the main-page feed's existing club **filter** parameter
renames to `?club_filter=` to free `?club=`. Default resolution: query param →
the signed-in user player's single tenant club → last displayed club
(localStorage) → a prompt. The header shows the current club (not the arena
name) with a switcher; every navigation preserves the club until the user
switches it. A player's page shows per-tenant-club stats tabs.

## Migration plan

Staged forward, each phase shippable:

1. **Data model**: 068 adds club tenancy columns, stint history, the arena
   club flavor, and converts «Синие люди»; clubs/arenas API grows the new
   fields and `POST /clubs/{id}/convert`. Zero behavior change
   otherwise.
2. **Attribution & ranking**: the club-arena membership predicate (069), the
   display reads (matches, players, player ranks) parameterized by arena,
   mode-change → full recalculation, members-only listing.
3. **Tournaments & markets** (this phase): club-scoped creates (`POST
   /clubs/{id}/tournaments`, `POST /clubs/{id}/markets`; flat creates
   removed), `club_id` NOT NULL (070), per-club settlement arenas,
   registration/bet/guarantee members-only gates, `GET /clubs/{id}/feed`.
4. **Frontend shell**: `?club=`, switcher, defaults, player-page club tabs,
   `GET /players/{id}/stats?club=`.
5. **Admin UI**: club settings page (kind, openness, member stints, convert),
   main-arena settings editor.

## Consequences

- Clubs stop being a pure display grouping: deleting a tenant club is
  refused (its arena and rating are load-bearing).
- Club main arenas are system-managed: arena PATCH/DELETE on them returns
  409 like the global arena; settings are edited through the club (phase 5).
- The membership predicate lives in SQL fragments, not in the inlined
  function — the ADR-28 performance rule now has an explicit exception to
  point at.
- Markets settle into the owning club's main arena (their rows survive arena
  match-replays, which delete matches only); **corrections stay on the
  global arena** — they have no club of their own, and that arena is «Синие
  люди»'s main arena since 068. Bet limits stay a single global column
  derived from the global arena (fresh-tenant members fall back to the
  starting Elo until they play there); revisitable if a per-tenant basis is
  ever needed. A main-arena mode change replays the arena's match rows and
  then re-chains every market settlement via the epoch sweep, so the whole
  ledger is consistent with the new history.
- The dev seed keeps its default club as the converted «Синие люди» tenant.
