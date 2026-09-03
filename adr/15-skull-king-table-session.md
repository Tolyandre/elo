# Skull King table session: strict host / connected-player modes

## Problem

The live Skull King table had two failure modes reported on mobile:

1. **Frozen connected players** — a client that missed the one-shot `saved`
   broadcast (or hit a transient 5xx on SSE reconnect) stopped receiving
   updates forever: `useSSE` treated any non-200 as permanently fatal, and a
   `Hub.Broadcast` data race could crash the whole backend, dropping every
   client into that state at once.
2. **Silent promotion to host** — the page derived `isHost =
   !tableSession || tableSession.isHost`, so *any* loss of the persisted
   session (missed `saved`, the "Новая партия" exit, split-brain between the
   two localStorage keys) rendered the connected player as host of their stale
   local copy of the game — able to edit and save a match everyone else saw
   differently.

Root cause: the mode (host vs connected player) was an implicit consequence of
whichever localStorage keys happened to survive, instead of an enforced
policy.

## Decision

### The session is the single mode authority (`useSkullKingTableSession`)

One localStorage key (`skull-king-game/table-session`) holds
`{tableId, isHost, myPlayerIndex}`. The page never derives the mode from
anything else, and the hook enforces:

- **Host / local-only** (`session === null` or `isHost: true`): the game state
  is persisted to `skull-king-game/state` and pushed to the server table by
  the page's mutation wrappers. A reload restores the game.
- **Connected player** (`isHost: false`): the server is the *only* source of
  truth. State lives in memory; nothing is ever written to the state key, and
  hydration deletes any legacy copy. Until the first server snapshot arrives
  (SSE connect frame or join response), the page shows a "Подключение…"
  placeholder instead of a stale or empty table.
- **The only path into host mode is starting a game from the setup screen.**
  A connected player pressing "Новая партия" leaves the table — no
  confirmation (their state is on the server and cannot be lost) — and lands
  on setup.
- The optimistic pre-create placeholder (`tableId: ""`) is never persisted and
  is sanitized to local-only on load, so a crash during table creation can't
  leave a phantom session.

### Every terminal table state has an explicit exit

| Event | Source | Connected player reaction |
|---|---|---|
| `saved` (+match id) | host saves the match | redirect to the match view |
| `closed` | host resets without saving | toast, return to setup |
| table gone (recovery fetch 404) | missed both of the above, or expiry | toast, return to setup |
| table gone while hosting | deleted elsewhere / expired | toast, downgrade to local-only (state preserved) |

`DeleteTable` broadcasts `saved` (with a match id) or `closed` (without) before
tearing the row down, and the SSE layer (ADR-13) retries rejected connections
with backoff and probes via `onRecover` — so every client either sees the
event live or discovers the table's fate within one recovery cycle. Nobody is
ever stranded on a frozen screen.

## Consequences

- Connected players can no longer end up in host mode with a stale copy of
  the game: there is no local copy to promote.
- A reloaded connected player sees a brief placeholder instead of a flash of
  wrong-phase UI; the connect snapshot usually arrives within the retry hint
  (5s).
- Multi-tab in one browser remains unsupported (last session wins); the hook
  owns the only writers, so a wrong-role tab fails safe (host with own
  server-checks, or connected with server state).
- Wake lock preference (`wake-lock/enabled`) is also persisted now, restored
  best-effort on mount; browsers that reject `request()` without user
  activation simply wait for the next manual toggle.
