# Game tables: one live-table system for every game

## Problem

Live tables existed only for Skull King, and every artifact of the mechanism
was named after it: the `skull_king_tables` table, `/skull-king/tables*` API
paths, `SkullKingTableService`, the `lobby:skull-king` SSE topic, the
`skull-king-game/table-session` localStorage key. Adding a second live game
(It's a Wonderful World, ЭБМ) would have meant either duplicating all of it or
renaming it under pressure. The Skull King state blob was also stored raw with
no structural validation, and host writes were last-write-wins: a host editing
on two devices (or a host patch racing a player's submission) silently erased
the other writer's input.

## Decision

1. **One generic table system keyed by game.** `game_tables` (renamed from
   `skull_king_tables` in migration 044) carries `game_id` — the well-known
   `games.id` of the game being played — and every API/SSE/DB artifact is
   game-agnostic: `/tables*` paths, `TableService`, the `lobby:tables` /
   `table:<id>` topics, the `game-table/session` localStorage key.

2. **Well-known game ids pinned in code.** `pkg/elo/game_ids.go`
   (`GameIDSkullKing` = `00000000-0000-0000-0000-000000000188`, `GameIDIAWW` =
   `…0009`) and `nextjs/lib/game-apps.ts` (Base58 wire forms
   `111111111111117m` / `111111111111111A`) define the same constants; every
   environment's games table carries these rows (see `testdata/seed.sql`).
   The registry maps a table's `game_id` to its frontend app (route, icon,
   calculator kind) and pins `game_id` when saving the final match — no more
   name matching (`includes("эбм")`).

3. **Per-game behavior behind one interface.** The generic
   `TableService.Create/Get/Update/Join/Submit/Delete` delegates
   game-specific logic to a `tableGame` plugged in by `game_id`
   (`table_game_skull_king.go`, `table_game_iaww.go`): state normalization
   (every write re-marshals through the game's typed state — structural
   validation plus canonical wire-form ids), player-submission validation and
   merge, and invite fan-out. Adding a game app means registering a
   `tableGame` and a `GameApp`; nothing generic changes.

4. **Optimistic locking.** `game_tables.version` increments on every
   `game_state` write. Player submissions merge server-side under
   `SELECT … FOR UPDATE` (no lost updates between players). Host state patches
   carry the version they were based on; a mismatch returns **409 with the
   current table** instead of overwriting. The client then combines both
   sides' changes via the game's field-level three-way merge (per cell and
   direct VP in IAWW, per round/player slot in Skull King): fields only one
   side touched auto-merge, and a same-field race keeps the editor's value
   (last write wins). The informed "override?" choice happens in the edit
   dialog, which compares the value the user saw on open against the latest
   server value on save. The host's whole-state edit is never blindly
   re-applied over a player's concurrent submit
   (`useTableSession.syncHostState`).

5. **Player submissions are validated, incremental, and one-shot.** IAWW
   input is checked against the 22 known scoring rows (row known, no
   duplicates, count bounded, pair rows carry their fixed coefficient,
   `directVp ≥ 0`). Each cell edit syncs instantly (like the host's) as a
   partial submit that **merges** into the player's entry: carried cells
   upsert (count 0 clears a row), rows not carried keep their values —
   including values the host entered meanwhile. `done` closes the column;
   omitted behaves as true (legacy one-shot submits), and after it a second
   submission is a 409. Only the host can correct a posted entry afterwards
   — via the versioned state patch.

6. **Server-only tables.** Local-only play and localStorage game-state
   mirroring are gone (the Skull King page keeps no `skull-king-game/state`).
   The server is the single source of truth; a reload resumes from the SSE
   connect snapshot. Sessions persist only `{tableId, isHost, myPlayerIndex}`
   at `game-table/session`.

7. **Roles.** Host (creates the table, edits anything, saves the match),
   connected player (joins, submits their own input once, read-only
   afterwards), viewer (anyone opening the table; full read-only). Saving a
   match stores the calculator document in `matches.calculator_data`; any
   editor can later reopen and edit it (ADR-09) acting as host on the final
   state.

8. **Retention.** Tables expire after 1 day (`expires_at` default); the
   cleanup timer deletes expired rows for all games alike (ADR-13 pattern).

## Addenda

### Tables are never cached (offline behavior)

Live tables are online-only by design. Two guards keep an offline stretch
from *rolling the game back* instead of just freezing it:

- The service worker excludes `/tables*` reads from the NetworkFirst API
  cache (they fall through to NetworkOnly), and the backend answers the
  whole `/tables` group with `Cache-Control: no-store`. A table refetch can
   therefore never resurrect a stale snapshot.
- A failed catch-up refetch only means "table gone" on a definitive **404**;
   network failures and 5xx keep the session and the last known state on
   screen (`ApiError.status`). The SSE stream self-heals and resyncs when the
   connection returns; pages show a "no connection" hint while it is down.

### URLs bind a visit to a table (`?new=1` / `?table=`)

- `?table=<id>` is the game page's sticky, shareable binding: the param is
  **never cleared**, so a refresh, a shared link, or a reopened invite all
  open exactly that table. A stored session on the table resumes as-is (a
  host stays host); otherwise the table is joined as a connected player —
  entering never claims hosting. A visitor who cannot join (signed out, no
  linked player) watches read-only as an observer (`GET /tables/{id}` and its
  SSE stream are public). A link to another game's table redirects to that
  game's page keeping the param.
- `?new=1` — the "Создать стол" links on `/matches/new` — is the opposite: it
  discards any stored session once and shows the setup screen, so **a new
  table is always created** there, even when the same user (or the same
  browser) already has one for that game. Several tables per game may
  coexist — any host. On success the page swaps the URL to `?table=<id>`.
- The header shows one icon per table the user participates in (host,
  connected player, or picked into the roster) — not one per game; same-game
  icons carry a small ordinal badge. `?join=<id>` survives only as a legacy
  alias of `?table=`.

### Hosting is claimed per device, only via the explicit takeover

- `host_user_id` names the account that may manage the table, but **entering a
  table never claims hosting**. Every entry path — the invite toast, the
  header game icon, "Вернуться" in the matches lobby — deep-links into the
  game page (`?table=<id>`), which joins as a connected player (or viewer),
  even when the account hosts the table: another device of the same account
  may be driving, and an automatic claim would silently displace it mid-game.
- The only way hosting reaches a device without a stored host session is the
  explicit "Стать ведущим" button (`POST /tables/{id}/takeover`). The request
  carries the browser's `host_client_token` (minted once per browser,
  persisted in localStorage), stored with the claim and broadcast in every
  summary. The current host account may always re-claim — the idempotent path
  is how hosting deliberately moves between that account's devices; any other
  user needs edit permission (checked in the handler). No presence gate.
- A stored host session (reload, or navigating away and back on the same
  device) keeps hosting without any server call; the session persists per
  device at `game-table/session`.
- Hosting is therefore exclusive per account AND per device: a host session
  steps down to player/viewer mode when the summary shows a different
  `host_user_id` **or a different `host_client_token`** — so when the user
  claims hosting from a second device via the button, the first device
  downgrades ("Ведущий режим открыт на другом устройстве") instead of quietly
  running a second host. Empty token (legacy tables, unavailable
  localStorage) disables the client-side check only.
- After a takeover by another user the broadcast summary carries the new
  `host_user_id`: the taker's page enters host mode, and the old host's page
  steps down to a participant automatically (host-drift downgrade in
  `useTableSession`). In-flight state conflicts remain protected by the
  version lock.
- Leaving a table has no dedicated action: the user simply navigates away
  (the session persists per device and is resumed from the menu icon or the
  matches lobby); joining happens from `/matches`. The host tearing a table
  down uses the destructive "Удалить стол", which returns everyone to
  `/matches`.

## Consequences

- Tables are created from `/matches/new` (game picker); the `/calculators`
  page lists only standalone tools. Running tables appear at the top of
  `/matches`, and users hosting or connected to a table get a game-icon
  button in the header next to the offline-mode indicator.
- The generic submit endpoint `POST /tables/{id}/submit` carries a per-game
  payload (`oneOf`: skull-king bid / skull-king result / iaww score). The
  Skull King bid/result endpoints are gone; the same validations apply.
- The `table-invite` user event now carries `game_id`/`game` so the toast
  routes to the right game app.
- ADR-15's mode-safety guarantees carry over unchanged to the generic session
  key; its localStorage game-state persistence is superseded by point 6.
