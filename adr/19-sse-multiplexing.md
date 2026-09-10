# SSE multiplexing: one connection for the app-global topics

## Problem

ADR-13 gave every stream a clean server and client implementation, but kept
the 1:1 mapping between *topic* and *HTTP connection*. A signed-in visitor
held three SSE connections on every page (`/data/events`, `/me/events`,
`/tables/lobby/events`) — four on `/matches`, where `RunningTables`
re-subscribed to the tables lobby the header's `TableIndicator` was already
listening to (two parallel connections for the same topic), and four on the
market/table pages. Each connection costs a server goroutine + ticker, its own
reconnect cycle, and budget against the browser's 6-connections-per-origin
HTTP/1.1 cap that ADR-13's consequences already flagged. The duplicated lobby
subscription also showed the flaw in the "components own connections" model:
deduplication was left to component-placement luck.

## Decision

### One multiplexed endpoint for the app-global topics

- **`GET /events?topics=…`** (auth optional via `OptionalDeserializeUser`)
  carries the topics every page needs anyway: `data`, `lobby:tables`,
  `lobby:markets`, `me`. The client picks topics with a comma-separated
  whitelist-validated query param (unknown topic → 400); `me` resolves to the
  caller's `user:<uuid>` hub topic and is **silently skipped for anonymous
  callers**, so a connection that raced a logout degrades to heartbeat-only
  instead of erroring into a reconnect loop. The frontend re-requests `me`
  only while authenticated, so login/logout toggles the topic set and thereby
  the URL.
- **Frames are tagged with the topic as the SSE *event name***
  (`event: lobby:tables\ndata: {"type":"tables-changed"}`) — the existing
  JSON envelope passes through untouched, and the browser dispatches per
  topic via `addEventListener(topic, …)`. The hub payloads never re-marshal.
- **`Hub.SubscribeMany`** fans several topics into one tagged channel (one
  per-topic channel + forwarder goroutine per subscription, closed `out` on
  cancel). Slow-client semantics are unchanged: `Broadcast` stays
  non-blocking per topic channel, so a stalled client drops frames and
  resyncs on recover.
- Per-entity streams (`/tables/:id/events`, `/markets/:id/events`) keep their
  dedicated connections: their initial-state snapshot on connect and
  page-local lifetime fit a private stream, and riding them on the shared
  connection would tear down every global topic on every navigation (the
  topic set would change per page).
- The four replaced endpoints (`/data/events`, `/me/events`,
  `/tables/lobby/events`, `/markets/lobby/events`) are **removed in the same
  change** — backend and frontend ship as one deployment unit. PWA-cached
  clients that still request them get a reconnect loop until the service
  worker picks up the new bundle; accepted because the window is short and
  the app degrades to normal refetch-on-navigation.

### Frontend: a refcounted mux singleton on a shared connection engine

- **`lib/sse-connection.ts`** extracts useSSE's entire self-healing machinery
  (45s liveness watchdog, rejected-connection backoff, reopen-after-error
  recover, visibility/online catch-up) into a framework-agnostic
  `createSSEConnection` supporting both default-message and named-event
  dispatch. `useSSE` becomes a thin React adapter — behavior unchanged.
- **`lib/sse-mux.ts`** is a module-level refcounted store (topic →
  subscribers) owning one connection to `/events?topics=<sorted active
  set>`: opens on the first subscription, closes on the last, reopens when
  the topic set changes. **`useSSETopic(topic, {onEvent, onRecover})`**
  mirrors the useSSE API so consumers migrate 1:1. A topic-set switch fans
  `onRecover` out to every subscriber — staying subscribers must catch up on
  the gap (the fresh engine never saw an error, so its own recover logic
  wouldn't fire).
- Migrated consumers: `LiveDataSubscriber` (`data`), `UserEventsSubscriber`
  (`me`), `useTablesLobbySSE` (`lobby:tables`), `useMarketsLobbySSE`
  (`lobby:markets`). The `/matches` duplicate disappears structurally — both
  components share one connection — and a signed-in visitor holds **one**
  stream app-wide (two on table/market pages).

## Consequences

- **Connection budget**: 1 per tab (2 with a table/market page open), from
  3–4. The HTTP/1.1 per-origin cap from ADR-13 is a non-issue again.
- The `me`-topic auth is resolved once per connection: a renewed session
  mid-stream doesn't change the subscription, and a login mid-connection
  re-subscribes with the new topic set (the URL gains `me`). Same model as
  before — `UserEventsSubscriber` gated its stream on auth state — just
  amortized over one connection instead of three.
- Topic-set switches (login/logout) refetch everything subscribed at that
  moment; they coincide with auth transitions that already invalidate user
  data, so no extra debounce was added.
- Adding an app-global topic is now a whitelist entry server-side + a
  `useSSETopic` call client-side; no new route, no new connection.
