# Offline mode v2: local replica, field-level merge, queue management page

## Problem

ADR-16 made creates idempotent (client-final ids, upsert-on-id sync), but the
offline story still breaks down in five ways:

1. **Creates only.** Editing or deleting a saved player, game, or match is
   impossible without network. At a camp — the primary offline scenario —
   corrections happen after the fact, on the bus, on flaky Wi-Fi.
2. **Duplicate-name 409s strand items.** Several camp devices routinely add
   the same new player offline. `players_name_unique` is global; whoever
   syncs second gets a 409 and a stuck error badge; every match referencing
   that player then fails on the foreign key. The escape hatch (manual
   rename, ADR-16) is the wrong default — the entities are the same player.
3. **Name resolution depends on refetch timing.** After a sync, components
   that resolve names only from the live server list render `Unknown` until
   the players refetch lands. Pending-merge logic is scattered across five+
   components, each slightly different.
4. **Concurrent edits need merge, not last-write-wins.** Two users editing
   the same match (one fixes a date, another a score) must not silently
   override each other's entered values. The rule: a user's value applies
   only if they observed the value it overwrites — an optimistic lock at
   field granularity.
5. **No single place to see and repair the queue.** Errors surface as badges
   on scattered pages; the header indicator explains the network but cannot
   manage anything.

## Decision

Evolve the existing engine (ADR-16's id model is kept whole); adopt Dexie
(IndexedDB) as its storage; add edit/delete ops with field-level merge; make
duplicate-name conflicts auto-adopt; and concentrate all queue repair in a
new `/offline` page.

### Storage: Dexie, not a sync framework

RxDB, ElectricSQL, PowerSync, Zero/Replicache were evaluated: all require a
server-side sync component alongside the Go+Postgres backend or a rewrite of
the push/pull protocol — and none provide what is actually hard here
(field-level merge UX, offline Elo chaining). The bespoke engine's tested
assets (id-finality, merge-over-live-store persistence, createdAt ordering)
are kept. Dexie (~30 KB) contributes the pieces genuinely worth borrowing:
IndexedDB storage (localStorage will not hold a future matches replica),
live queries (killing the `invalidate()` refetch sprawl), and cross-tab
consistency (replacing the `storage`-event adoption code).

Tables: `entities` (server mirror: players, games — matches later),
`pending` (creates, migrated from `offline-pending-v1`), `ops` (edits and
deletes of saved entities), `meta` (sync cursors, snapshots). One-time
migration on load; `sync.ts` stays a pure, DI'd engine.

### `/offline` page is the conflict surface

The crossed-cloud indicator links to `/offline`, which lists every pending
item (matches, players, games) with status badges, sync errors, and — for
conflicted items — per-field resolution: «Вы изменили: X → A · На сервере:
B» with keep-mine / keep-theirs. Sync never opens dialogs mid-UX; it marks
items `status: "conflict"` with display-ready details
(`PendingBase.conflict: {field, ours, theirs}[]`), and the user resolves
when ready. Resolving applies the chosen values and returns the item to
`pending`.

### Silent id adoption for duplicate names (players, games)

`POST /players` and `POST /games` return 409 with `existing_id` when the
unique-name index fires (server looks the entity up by name; no audit event
— nothing was created). On receiving it, the sync engine adopts the
canonical id: rewrites every pending reference (match `score` keys,
`gameId`, `playerIds` arrays, coop participants, and a blind deep-walk
through `calculator_data` — Base58 ids are unique strings, so string
replacement is safe), applies club memberships / game tags idempotently
against the canonical id, drops the create item, and continues. Matches
never need adoption: the match id is the only unique key it has. Matches
whose player/game references do not resolve are deferred to the next run
instead of being sent to a foreign-key failure.

### Field-level three-way merge for edits

An edit op stores `base` (the entity as the form rendered it when editing
began) and `patch` (what the user changed). At sync the engine merges
against the freshly pulled replica, per field, with the existing `threeWay`
util (the calculators' `merge.ts` precedent):

- user changed the field, server == base → apply the user's value;
- user did not touch the field, server changed → take the server's value;
- both changed the same field differently → conflict item on `/offline`.

No silent override in either direction. Matches merge at
participant/score-key granularity; participants merge as a set. The match
score patch carries the complete desired set, so a base key the patch omits
is a player the user removed — it drops from the merged map (guarded on the
patch carrying a score map at all, so a date-only op keeps the observed
set); a key the server added since the base stays — the user has not
observed it. Deletes are guarded the same way: deleting an entity that
changed since it was observed becomes a conflict; deleting an
already-deleted entity (404) is dropped silently. One op per entity id (a
later op replaces an earlier one).

### Every edit queues — online included

Edit writes have one path for online and offline alike (the create path's
precedent): the form queues an op with the observed base and walks to the
view page; when online the provider triggers `syncNow` immediately, so the
op lands within a round trip, and the merge rules above apply identically —
a server-side change since the form opened becomes a conflict **online
too**, where the old direct-PUT path silently overwrote it. A failed
request (network, validation) leaves the op on the device with an error
badge instead of a lost form. Calculator-backed saved matches queue the
same way (`calculator_data` merges as one whole field; the fresh match GET
carries it so the merge sees "theirs").

Two session rules keep the merge honest across re-edits:

- **The form prefills from the op-overlaid state, the merge base stays the
  op's original base.** One op per entity and a complete patch mean a
  re-edit accumulates: fields changed by the first edit still apply at sync
  even when the second edit leaves them alone.
- **The base freezes when the edit session opens.** The queued op may land
  mid-edit (the network returns, the sync drops it) and another user may
  then change the match; re-resolving the base at submit would read the
  post-landing state and silently let the other user's values win. Frozen,
  the submit merge flags exactly the fields altered server-side since the
  user last observed the match — a conflict, online and offline alike.

### The match is a client-side entity

`lib/offline/match-entity.ts` projects one match from its three possible
sources — the server read, a pending create, a queued edit op — into the
display state every surface renders (`MatchEntity.effective()`), plus the
audit-style change rows (`changes()`). The match view page, the feed and
`/offline` all build their cards through it, so a queued edit is visible
the moment it is made and disappears when the sync drops the op. The
display state is exactly what the merge will PUT. The name resolver layers
the ops in the same spirit (pending → **ops** → live lists → replica →
fallback), so a renamed player or game resolves to the queued name
everywhere.

### Deferred: client-side Elo preview and WASM parity

An offline settlement preview was built once as a TS mirror of the server
formulas fed from per-player rating histories; it was removed again — the
prior state it needs (each player's latest settlement strictly before the
match in `(date, match_id)` order, market settlements included) is not
reliably available offline, and a wrong preview is worse than none. Until
it returns, unsynced state renders no rating values at all: the card hides
the settlement columns until the server settles. The eventual shape is a
settlement-ledger replica — mirror the main arena's `arena_settlements`
rows into Dexie, so the preview reads the prior state exactly the way
`GetPlayerLatestArenaEloBeforeMatch` does. Compiling `pkg/elo` to
WebAssembly (standard Go `GOOS=js GOARCH=wasm`, JSON boundary) stays the
parity-guaranteed alternative — revisit when either is actually wanted.

**Resolved by ADR-38** (offline ratings): the ledger replica plus the
`pkg/settlement` WASM build both landed — pending cards and offline edits
fill their settlement columns from the local replay, and the arena view
renders offline-recomputed standings. The "no rating values until the
server settles" rule survives only where the client cannot evaluate an
arena precisely (stint-based tenant modes, camp/tournament arenas, tag
filters without tag data).

### Edit-during-sync races

Editing a pending item while the engine syncs it is safe by construction:
the entry's `clientId` is the final server id, so a save landing after the
create is rerouted to an update op against the same id — never a second
create. Forms perform a conditional save (apply only if the queued item
still holds the content the form loaded); per-item `syncing` status locks
only the item in flight, not the whole queue.

### Players and games become first-class client entities

The `entityPlayers`/`entityGames` tables mirror the two catalogs: written
through on every successful provider fetch and re-pulled by `syncNow` after
a successful push. One shared name resolver (`hooks/useNameResolver.ts`) —
pending → queued ops → live lists → replica → fallback — replaces the
scattered per-component resolution, so a just-synced id resolves from the
mirror immediately and a cold offline start resolves from the last session.
Providers keep their fetch pipelines (tenant-scoped ranks and list shapes
are consumed in too many places to swap); feeding provider lists from the
replica offline is a future refinement.

**Matches replica is future work** (not built here): needs an `updated_at`
column, a tenant-scoped incremental pull
(`GET /tenants/{id}/matches?updated_since=`), a `matches` table in Dexie,
and the feed reading it — which also brings offline feed search.

## Consequences

- All queue repair (rename, delete, retry, conflict resolution) lives on
  `/offline`; errored items no longer need to be hunted across admin pages.
- Providers stop refetching after sync to learn names; the replica is the
  name index.
- The residual GET→PUT window after a client-side merge is milliseconds and
  requires two devices syncing the same entity simultaneously; documented,
  server-side If-Match versioning is the future hardening.
- `players_name_unique` stays global: two genuinely different same-named
  players merge irreversibly. Accepted — the camp scenario dominates, and
  the merge is silent by design.

## References

- ADR-06 / ADR-12 — client-generated final ids (the foundation adoption
  and reroute rely on).
- ADR-16 — offline-first writes; superseded in parts: storage moves from
  localStorage to Dexie, duplicate names auto-adopt instead of manual
  repair, cross-tab consistency moves into Dexie.
