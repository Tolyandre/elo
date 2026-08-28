# Realtime events: one SSE hub, data-change signals, transient invites

## Problem

Realtime updates grew as four independent copies: two in-memory hubs
(`MarketsHub`, `SkullKingHub` — byte-for-byte the same design), four SSE handlers
duplicating the same headers/heartbeat/pump loop, three identical event-envelope
structs, and four frontend hooks each hand-rolling the same EventSource
liveness/reconnect scaffolding. On top of the duplication, three product gaps:

1. the matches and players pages only refreshed on own mutations or navigation —
   another user adding a match was invisible until reload;
2. Skull King live tables were pull-only: the host picked players, but nobody
   told the users controlling those players a table was waiting for them;
3. `/ping` was suspected to be replaceable by SSE heartbeats.

## Decision

### One hub, one serving helper, one client hook

- **`pkg/elo/hub.go`** is the single in-process fan-out point. Subscribers join
  a *topic* string; producers broadcast marshalled `SSEEvent` payloads
  (`{"type":"...","data":...}`). Sends are non-blocking with cap-8 buffers —
  slow subscribers drop frames and resync on reconnect, so a stalled reader can
  never block a writer. Topic taxonomy:

  | Topic | Stream | Payload |
  |---|---|---|
  | `market:<uuid>` | `GET /markets/:id/events` | live LMSR prices |
  | `lobby:markets` | `GET /markets/lobby/events` | signal |
  | `skull-king-table:<uuid>` | `GET /skull-king/tables/:id/events` | full table state |
  | `lobby:skull-king` | `GET /skull-king/lobby/events` | signal |
  | `data` | `GET /data/events` | signal |
  | `user:<uuid>` | `GET /me/events` (session required) | invites / notifications |

- **`pkg/api/sse.go`** owns everything an SSE response needs: headers, optional
  initial frame, 15s heartbeat comment, and the pump loop. Handlers only pick a
  topic and an initial frame.
- **`nextjs/hooks/useSSE.ts`** is the only EventSource construction site
  client-side: JSON envelope dispatch, the 45s liveness timer that recreates
  silently-dead streams, recovery callbacks (reopen-after-error,
  visibility/online), and fatal-close handling — a stream the server rejected
  outright (404 table gone, 401 expired session leaves `readyState === CLOSED`)
  stops instead of retry-looping every 45s.

### Live data updates (signal-and-refetch)

Mutations that change derived data broadcast payload-less signals after commit:
`AddMatch`/`UpdateMatch`/corrections/recalculation → `matches-changed` +
`players-changed`; player CRUD → `players-changed`. The frontend keeps one
app-wide subscription (`LiveDataSubscriber` in the root layout) that
invalidates the Matches/Players contexts through a 500ms trailing debounce —
deliberate, because offline sync pushes a whole queue of matches and each
emits its own signals. Signal-and-refetch (not delta-push) keeps one source of
truth and a tiny server footprint at the cost of extra reads; fine at this
scale, revisit if the players query (3× `GetPlayersWithRank`) ever becomes hot.

### Skull King invites are transient

`CreateTable` resolves the user controlling each picked player
(`users.player_id` is unique — 1:1) and sends a `table-invite` event to their
`user:<uuid>` topic (never the host). The client pops a toast with a "Войти"
action deep-linking to `?join=<tableId>`, which auto-joins. **Users who had the
app closed miss the invite** and fall back to the "Активные столы" lobby list —
acceptable because tables are ephemeral (1-day expiry) and invites are only
useful live. When notifications must survive a closed app, the follow-up is
Web Push (VAPID + `push_subscriptions` + SW `push`/`notificationclick`
handlers; iOS requires an installed PWA, 16.4+), which rides the OS push
channel and costs no battery. The `user:` topic is exactly where a push fan-out
would hook in.

### `/ping` stays

The ping is *not* a periodic heartbeat: `OfflineContext` probes on
mount/navigation/focus/online/visibilitychange/queue-change and only polls with
30s→15min backoff while unreachable. It cannot be replaced by SSE liveness
because it must work logged-out and on pages without streams,
`EventSource.onerror` cannot distinguish "offline" from "server restarted",
and the offline sync trigger needs an authoritative probe. SSE heartbeats
handle per-stream health; `/ping` handles app-level reachability.

## Consequences

- **Single instance only** — the hub is in-process (no Redis). Already true for
  the live game and documented in code; if replicas ever happen, Postgres
  LISTEN/NOTIFY (or Redis pub/sub) replaces the hub internals without touching
  handlers.
- **Connection budget**: an app instance holds the `data` stream always, plus
  feature streams on their pages (≤3 per tab). Over HTTP/1.1 the browser caps
  at 6 connections per origin — two tabs × 3 streams would hit it. The reverse
  proxy should speak HTTP/2 (multiplexed, no per-connection cap); worth
  verifying on deployment.
- **Cost profile**: per subscriber one goroutine + one buffered channel + one
  15s ticker (~13 bytes/15s). Broadcasts are non-blocking map iterations. The
  real cost is the refetch fan-out each signal triggers, bounded by the client
  debounce.
- New SSE endpoints stay raw Gin handlers outside the OpenAPI spec (existing
  precedent); ids inside SSE frames are hand-encoded to the Base58 wire form at
  construction (ADR-12). Frontend paths must end in `/events` so the service
  worker's NetworkOnly exclusion keeps them uncached.
- Bonus correctness: market delete/betting-close now signal the markets lobby
  (they previously didn't), and the Skull King lobby recovery path no longer
  double-fetches the table list.
