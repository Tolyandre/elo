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
participant/score-key granularity; participants merge as a set. Deletes are
guarded the same way: deleting an entity that changed since it was observed
becomes a conflict; deleting an already-deleted entity (404) is dropped
silently. One op per entity id (a later op replaces an earlier one).

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
pending → live lists → replica → fallback — replaces the scattered
per-component resolution, so a just-synced id resolves from the mirror
immediately and a cold offline start resolves from the last session.
Providers keep their fetch pipelines (tenant-scoped ranks and list shapes
are consumed in too many places to swap); feeding provider lists from the
replica offline is a future refinement.

**Matches replica is future work** (not built here): needs an `updated_at`
column, a tenant-scoped incremental pull
(`GET /tenants/{id}/matches?updated_since=`), a `matches` table in Dexie,
and the feed reading it — which also brings offline feed search.

### Deferred: WASM Elo parity and offline Elo preview

Compiling `pkg/elo`'s pure math to WebAssembly (standard Go
`GOOS=js GOARCH=wasm`, JSON boundary) was designed to guarantee the TS Elo
port never drifts and to power an exact offline settlement preview. It is
deliberately skipped this iteration to keep it small; revisit when offline
Elo preview is actually wanted.

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
