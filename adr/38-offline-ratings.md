# Offline ratings: wasm settlement engine + ledger replica

## Problem

Offline mode (ADR-37) covers writes — players, games, matches can be added
and edited offline with field-level merge — but shows no rating values for
any of it:

- unsynced matches render no settlement columns (the Elo preview was
  deliberately removed — ADR-37 §"Deferred: client-side Elo preview and WASM
  parity": the prior state it needs was not reliably available offline);
- the arena view is request-cache offline: a cold open waits for the service
  worker's NetworkFirst timeout before the cached players list appears, and
  medal stats were unavailable offline at all;
- ratings are the app's core output, so offline mode cannot be called
  first-class while they are absent.

## Decision

The client mirrors the **raw material** of the server's rating computation
and recomputes ratings locally through the **same Go code**, compiled to
WebAssembly. Three legs:

### 1. Pure settlement core → WASM (parity by construction)

`pkg/settlement` is a new DB-free leaf package holding the Elo math
(`WinExpectation`, `CalculateNewElo`), the dual-track arena settlement
(`BuildArenaResults`, catch-up scaling), league progression, and a
whole-arena replay (`ReplayArena`). `pkg/elo` links it and keeps thin
wrappers with the historical signatures — one source of truth, no drift by
construction.

`cmd/settlementwasm` compiles it to `GOOS=js GOARCH=wasm` behind a
JSON-in/JSON-out bridge (`eloSettlement.replayArena`). Build:
`make build-wasm` (writes `nextjs/public/wasm/`, gitignored) or
`nix build .#settlement-wasm` — the frontend derivation copies the artifact
into `public/wasm/` before `next build`, so the service worker precaches it
(explicit entries in `next.config.ts`; the public-dir glob is disabled there).
`pkg/id`'s pgtype-backed `Scan` is excluded from the wasm target by build
tag (the wasm build never scans from a database; this keeps the binary
~1.2 MB smaller). `math.Exp` is replaced by a vendored portable
implementation (`pkg/settlement/deterministic.go`) because the native
amd64 assembly `Exp` differs from the portable one by one ULP — enough to
break bit-parity on the catch-up scaling paths.

### 2. Ledger replica (mutable events + deterministic re-derivation)

The replay's inputs mirror into Dexie (version 4 tables):

- `arenaSettlements` — the arena's `arena_settlements` ledger rows via the
  new `GET /arenas/{id}/settlements` (ascending `(date, id)` keyset pages).
  Only the **market** rows feed the replay (frozen constants — markets stay
  online); the match rows serve future offline stats and validation.
- `matchReplica` — the tenant's match history (`GET /matches?tenant=`,
  paginated drain), slimmed to what replay and membership need.
- `arenaDocs` + `arenaPlayers` — per-view write-throughs of
  `GET /arenas/{id}` and its players listing (the offline first paint).
- `settingsHistory` — the full `elo_settings` time series
  (`GET /settings/all`, extended with the league parameters so the replay
  resolves K/D/starting_elo/league params **as-of the match date**, exactly
  like the server).

Hydration runs after every successful sync (`hydrateRatingsReplica`: the
tenant's main arena + every arena whose view was opened) and per-view on
browse. There is no immutability requirement on the inputs: events are
mutable documents, and a change invalidates derived state from the change
point — the same discipline the server's `recalculateEloFromDate(min(old,
new))` has always used. The client simply replays the whole arena from
epoch on every recompute (club-scale history is milliseconds in wasm), so
no checkpoint machinery is needed until history outgrows it.

The engine (`lib/offline/ratings/engine.ts`) assembles replay inputs from
the replica plus the pending queue: pending creates join the match set, and
pending edit ops overlay the replica rows through the same
`applyMatchOp`/`opToMatch` merge semantics the sync uses. Membership is
evaluated client-side exactly like the server's predicates: tenant main
arenas with mode `all` admit every competitive match; filter arenas
evaluate the MatchFilter (date window, game ids, tag ids when a game→tags
mapping is available). Coop matches settle nothing anywhere. Arena flavors
the client cannot evaluate precisely — stint-based tenant modes
(`any_member`/`members_only`), camp/tournament link-only arenas, tag
filters without tag data — **degrade to the mirrored server values** (a
wrong preview is worse than none, ADR-37).

`LocalRatingsProvider` (mounted inside `OfflineProvider`) owns the wasm
bridge, subscribes to the replica, memoizes per-arena replays, and exposes:

- `getMatchSettlement(matchId, tenantId)` — pending-match cards and the
  match-detail edit overlay fill their settlement columns from it
  (`withLocalSettlement` in `match-entity.ts`; `matchSettled()` then renders
  the widgets unchanged). Provisional by definition — the pending styling
  marks it.
- `getArenaOverlay(arenaId, resolveName)` — the locally recomputed
  standings (rating, league, rank, day/week deltas, medals, promotion
  hints) merged over the mirrored snapshot; the players and medals tabs
  render it with a «Предварительный расчёт» note. Without local events the
  overlay is null and the mirrored server rows render verbatim — the fast
  path never loads wasm at all.

After sync the server recalculates (unchanged), the existing invalidation +
re-mirror flow refreshes the replica, and every offline value is refined to
the server's.

### 3. First-class offline arena view

The arena view seeds `arena`/`players` from the replica before/regardless of
the network fetch (skeletons only on a cold start with an empty replica) —
the 4s NetworkFirst wait disappears for the players and medals tabs.

## Parity gates

- **Go** — `pkg/settlement/golden_test.go` pins the core against the
  committed fixtures; regenerating (`make golden`) after a deliberate math
  change must land together with the fixture file.
- **Wasm** — `__tests__/settlement-wasm.test.ts` replays every fixture
  through the actual binary and requires display-identical output (1e-9
  tolerance: the deterministic core removes the systematic arch gap; an
  isolated last-bit compiler disagreement on some `Pow` inputs remains and
  is invisible at the rendered precision). CI builds the artifact before
  the suite runs.
- **Integration** — `TestArena_SettlementsLedgerEndpoint` pins the ledger
  endpoint's ordering, cursor, and error contract.

## Consequences and scope

- Tenant main arenas (mode `all`) and filter arenas recalculate bit-accurately
  offline; stint-based tenants render replica values until club-membership
  stints are mirrored (future phase).
- Market settlements inside a replayed window are frozen constants —
  provisional, refined on sync.
- The precache grows by the wasm artifact (~4 MB stored, ~1 MB over the
  wire); it loads lazily and only when local events exist.
- Offline-created settlement ids are never minted client-side — only
  values; the server's ledger remains the sole source of persisted rows.
- Future: club-stint replication, a change-feed cursor for incremental
  re-mirroring (the audit log is the natural backbone), snapshot+tail
  partitioning if history grows, offline player stats pages.
