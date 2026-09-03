# Offline-first writes: every create goes through the offline queue

## Problem

Creating a match, game, or player while online used to POST directly to the
server and only fall back to the offline queue on a network-level failure.
That split had two structural flaws:

1. **Two ids for one entity.** The online attempt minted its id inside the API
   helper (`createGamePromise` and friends), where the caller couldn't reuse
   it. When the network died mid-request and the handler fell back to
   `addPendingGame`/`addPendingPlayer`, a *second* id was queued. If the
   in-flight request had actually landed, the server held the entity under id
   A while the queue held id B: B then failed forever on the `games_name_unique`
   (or `players_name_unique`) index, and every match referencing B failed
   forever on the foreign key.
2. **Retries mint new ids.** `submitMatch` reused one id within a single call,
   but any failure that wasn't a network-level error (a proxy 5xx after the
   server committed, a page refresh while the request hung) surfaced as a form
   error. The user re-submitted, a fresh id was minted, and the server's
   id-upsert could not deduplicate — producing duplicate matches, each settled
   into Elo.

## Decision

All client-side creates — matches, games, players — flow through the offline
queue **even while online**. There is no direct POST path from the forms
anymore:

- The queue entry's `clientId` (ADR-06/ADR-12 UUIDv7, Base58 on the wire) is
  the entity's final server id. One entity, one id, minted exactly once, no
  matter how many times the sync replays it.
- Queueing changes `pendingCount`, which re-triggers the health probe → sync,
  so while online the item reaches the server within a round trip or two. The
  cost is that the match view briefly shows the pending card before flipping
  to the saved card with the Elo change — accepted in exchange for a
  guaranteed-idempotent single write path.
- Because everything is queued, the old "match references a still-pending
  game/player" special case disappears: the sync engine already sends games →
  players → matches, which resolves dependencies naturally.
- Forms no longer need per-failure branching (`offline`, `isNetworkFailure`):
  the submit always succeeds locally, and server rejections surface later as
  error badges on the queued item.
- Skull King table mode needs the match to exist server-side before teardown
  (`DeleteTable` broadcasts the match id to connected players), so the page
  waits for the sync to remove the item from the persisted store before
  deleting the table.

### Name conflicts remain a manual repair

When a queued game or player hits the unique-name 409 (someone else created
the same name while this device was offline, or a stale cache hid an existing
entity), the item stays queued with an error badge; the escape hatch is still
rename/delete in the admin lists. Renaming keeps the `clientId`, so matches
referencing the item heal automatically on the next sync run — error items are
retried every run.

### Multi-tab caveat

The whole store is persisted to `localStorage` per write, so two tabs writing
near-simultaneously resolve last-write-wins. A `storage` event listener makes
tabs adopt each other's writes while idle (not mid-sync), which closes the
common case; the residual simultaneous-write race is accepted for a
single-user PWA.

## Consequences

- `submitMatch`, `GameCombobox`, `AddPlayerForm`, and the admin create rows
  queue unconditionally; `createGamePromise`/`createPlayerPromise` were
  removed from `app/api.ts` (the sync engine's `SyncApi` impls, which take an
  explicit id, are the only remaining create callers).
- Online-only writes (saved-match edits, tournaments, clubs, markets, bets,
  corrections) are unchanged and still mint ids inside their API helpers.
- The sync engine (`lib/offline/sync.ts`) is untouched: it already assumes
  client ids are final and upserts make replays safe.

## References

- ADR-06 — client-generated ids: the id is the idempotency key.
- ADR-12 — typed ids (`Base58ID`), the wire form of the queue's `clientId`.
